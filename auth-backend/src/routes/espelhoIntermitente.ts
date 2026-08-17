import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { abrirExecucao, comEtapa, type Execucao } from "../services/execucao.js"
import { liberarPrePagamento } from "../pontual/prepagamento.js"
import { diasUteis } from "../domain/diasUteis.js"
import { calcularDesconto, jaConsumido, norm as normTxt, type DiaDesconto } from "../domain/desconto.js"
import { resolverValores } from "../domain/desconto.js"
import { derivarDescontosPorDia, agregados, type RespostaDia } from "../domain/descontoDia.js"
import {
  reconstruirLedger,
  rangeCancelamento,
  aplicarCancelamento,
  type Ledger,
} from "../domain/ledgerBeneficios.js"
import { lerValores } from "../repo/valores.js"
import { lerFeriados } from "../repo/feriados.js"
import { upsertDesconto, descontoExistente } from "../repo/descontos.js"
import {
  BOARD_HISTORICO,
  buscarHistoricoPorUuid,
  parseItemOrigem,
  textoCol,
  jsonCol,
  atualizarHistorico,
  mudarColunaSimples,
  COL_HIST,
} from "../repo/historico.js"
import {
  buscarDescontoPorPeriodo,
  gravarDescontoBoard,
  zerarDescontoBoard,
  BOARD_DESCONTOS,
} from "../repo/boardDescontos.js"
import { lerItem, lerItemComSubitems, criarSubitem, mudarColunas, moverParaGrupo } from "../clients/monday.js"
import {
  particionarSplit, splitValido, nomeSubitem, colunasSubitem, acharSubitemExistente, COL_PAI_PROPAGA,
} from "../split/subitems.js"
import { changeColumnValues } from "../monday.js"
import { config } from "../config.js"
import { temRmSoap } from "../clients/rmSoap.js"
import { somarDias } from "../domain/convocacaoRm.js"
import { encurtarConvocacoesDoItem, removerConvocacoesDoItem, TIMEOUT_REMOCAO_MS } from "../services/convocacaoRemover.js"
import {
  bifurcacaoRmHabilitada,
  bifurcarConvocacoesDoItem,
  reverterBifurcacaoDoItem,
  type ResultadoBifurcacao,
} from "../services/convocacaoBifurcar.js"
import { ecoCodigosDoItem } from "../services/convocacaoPontual.js"
import { enfileirar } from "../jobs/repo.js"
import { montarPedidoSabados, ehErroSabados } from "../sabados/calculo.js"
import { TIPO_JOB_SABADO_EXTRA } from "../jobs/sabadoExtra.js"
import { TIPO_JOB_CONVOCACAO_RM_REMOVER } from "../jobs/convocacaoRmRemover.js"
import { TIPO_JOB_CONVOCACAO_RM_SUBSTITUIR } from "../jobs/convocacaoRmSubstituir.js"

// Colunas do board ENTRADA (ids preservados na duplicação mensal — WF Cancelar).
const COL_ENTRADA_STATUS = "color_mm3a8ana"
const COL_ENTRADA_DATA_CANCEL = "date_mm3b88ta"

/**
 * Campos que o frontend injeta em toda escrita: `operador` (src/lib/http.ts
 * `comOperador`) e `execucao_id` (o id que ele cunhou ao abrir a execução).
 *
 * Estas rotas NÃO exigem sessão — `/preencher/:uuid` é pública por UUID —, então o
 * operador vem do corpo, não de `usuarioDaSessao`.
 */
interface CorpoInstrumentado {
  execucao_id?: string
  operador?: { email?: string; nome?: string }
}

function operadorDoCorpo(b: unknown): { userId: null; email: string | null; nome: string | null } {
  const o = (b as CorpoInstrumentado | undefined)?.operador
  return { userId: null, email: o?.email ?? null, nome: o?.nome ?? null }
}

/**
 * Recusa de negócio: fecha a execução como erro E devolve a resposta.
 *
 * Os dois passos sempre andam juntos, e separá-los é como se perde metade dos casos —
 * um `return reply.code(409)` sem o `fechar` deixaria a execução 'aberta' até a
 * varredura de abandonadas alcançá-la, com o motivo real perdido.
 */
async function recusar(
  ex: Execucao,
  reply: FastifyReply,
  status: number,
  corpo: { erro: string } & Record<string, unknown>,
  etapa?: string,
): Promise<never> {
  await ex.fechar("erro", { erro: corpo.erro, etapaErro: etapa })
  return reply.code(status).send({ ok: false, ...corpo }) as never
}

/**
 * Amarra um job à execução que o enfileirou.
 *
 * É o que faz o alerta de job morto (jobs/repo.ts `falhar`) linkar pro log DESTE
 * cancelamento, com pessoa e contrato, em vez de um uuid opaco de job — que é a
 * diferença entre uma mensagem em que o DP age e uma que ele ignora.
 */
async function amarrarJob(ex: Execucao, jobId: string, req: FastifyRequest): Promise<void> {
  await ex.artefato({ tipo: "job", chave: jobId, rotulo: "Fila do RM" })
  await query(`UPDATE jobs SET execucao_id = $2 WHERE id = $1`, [jobId, ex.id])
    .catch((e) => req.log.warn(e, "amarrar job a execucao falhou"))
}

// Rotas de leitura do fluxo intermitente — substituem os webhooks n8n
// (WF2 Ler, WF4 Buscar Protocolo, Buscar Convocações). Servidas sob /api/*
// (nginx já proxia /api) com os MESMOS nomes de path dos webhooks, pra o
// cutover do front ser só trocar VITE_N8N_BASE_URL -> backend /api.
//
// PÚBLICAS (sem auth): seguras pelo UUID longo, igual aos webhooks atuais.

interface LinhaConvocacao {
  uuid: string
  nome?: string | null
  chapa: string
  contrato: string | null
  data_inicio: string | null
  data_fim: string | null
  protocolo: string | null
  status: string | null
  status_cancelamento: string | null
  data_inicio_cancelamento: string | null
  optante_vt: boolean | null
  trabalha_sabado: boolean | null
  respostas: unknown
  dias_desativados: unknown
  atestados: unknown
  split: unknown
  sabados_extras: string[] | null
  concluido_em: string | null
  editado: boolean | null
  editado_em: string | null
}

// Status do board (texto) -> enum do front.
function statusFront(s: string | null): "aguardando" | "concluido" | "expirado" {
  const n = String(s ?? "").toLowerCase()
  if (n.includes("conclu")) return "concluido"
  if (n.includes("expir")) return "expirado"
  return "aguardando"
}

function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function soData(s: string | null): string | null {
  return s ? String(s).slice(0, 10) : null
}

/**
 * Valor de coluna `date` do Monday COM hora — o formato `{date, time}` (UTC).
 *
 * ⚠️ Aceita `Date` além de string porque `timestamptz` volta do pg como objeto Date
 * (só a coluna `date`/OID 1082 tem parser pra string — ver db.ts). Um `.slice()` direto
 * em `concluido_em` quebraria exatamente na reedição, que é quando o campo está
 * preenchido — e passaria batido em qualquer teste que só finalize uma vez.
 */
function dataHoraMonday(v: string | Date | null | undefined): { date: string; time: string } | null {
  if (!v) return null
  const iso = v instanceof Date ? v.toISOString() : String(v)
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  if (m) return { date: m[1]!, time: m[2]! }
  const soDia = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return soDia ? { date: soDia[1]!, time: "00:00:00" } : null
}

// --- Readers do espelho Postgres (exportados: usados pelas rotas espelho E como
// fallback das rotas Monday-backed em intermitente.ts quando o Monday cai) ---

export async function lerConvocacaoPg(uuid: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query<LinhaConvocacao>(`SELECT * FROM convocacoes WHERE uuid = $1`, [uuid])
  const c = rows[0]
  if (!c) return null
  const di = soData(c.data_inicio)
  const df = soData(c.data_fim)
  const sabExtras = c.sabados_extras ?? []
  const dias = di && df ? diasUteis(di, df, c.trabalha_sabado === true, sabExtras) : []
  return {
    uuid: c.uuid,
    nome: c.nome ?? null,
    contrato: c.contrato ?? null,
    data_inicio: di,
    data_fim: df,
    dias,
    status: statusFront(c.status),
    concluido_em: c.concluido_em ?? null,
    protocolo: c.protocolo || null,
    editado: !!c.editado,
    editado_em: c.editado_em ?? null,
    respostas: arr(c.respostas),
    dias_extras: [], // não há coluna dedicada hoje (board legacy long_text_mm2x73w6)
    dias_desativados: arr(c.dias_desativados),
    trabalha_sabado: c.trabalha_sabado === true ? "SIM" : "NAO",
    sabados_extras: sabExtras,
    atestados: arr(c.atestados),
    pontos_facultativos: [],
    data_inicio_cancelamento: soData(c.data_inicio_cancelamento),
    status_cancelamento: c.status_cancelamento ?? null,
    split: c.split ?? null,
  }
}

export async function protocoloPg(protocolo: string): Promise<{ uuid: string; nome: string } | null> {
  const { rows } = await query<{ uuid: string; nome: string | null }>(
    `SELECT uuid, nome FROM convocacoes WHERE protocolo = $1 LIMIT 1`,
    [protocolo],
  )
  if (!rows[0]) return null
  return { uuid: rows[0].uuid, nome: rows[0].nome ?? "" }
}

export async function convocacoesEmpregadoPg(
  chapa: string,
  mes: string,
): Promise<Record<string, unknown>[]> {
  const params: unknown[] = [chapa]
  let filtroMes = ""
  if (/^\d{4}-\d{2}$/.test(mes)) {
    params.push(mes + "-01")
    filtroMes = ` AND data_inicio <= (($${params.length}::date) + interval '1 month' - interval '1 day')
                  AND data_fim >= ($${params.length}::date)`
  }
  const { rows } = await query<LinhaConvocacao>(
    `SELECT * FROM convocacoes
      WHERE chapa = $1${filtroMes}
        AND COALESCE(status_cancelamento,'') NOT ILIKE '%cancelad%'
      ORDER BY data_inicio DESC LIMIT 200`,
    params,
  )
  return rows.map((c) => ({
    uuid: c.uuid,
    nome: c.nome ?? null,
    contrato: c.contrato ?? null,
    data_inicio: soData(c.data_inicio),
    data_fim: soData(c.data_fim),
    status: statusFront(c.status),
    trabalha_sabado: c.trabalha_sabado === true,
    optante_vt: c.optante_vt === true,
    documentos_existentes: arr(c.atestados),
  }))
}

/** `Código Convocação RM` no board da vez. Resolvido por TÍTULO: o board do mês é cópia. */
async function colunaCodigoRm(boardId: string): Promise<string | null> {
  const { rows } = await query<{ column_id: string }>(
    `SELECT column_id FROM board_colunas
      WHERE monday_board_id = $1 AND nome = 'Código Convocação RM' LIMIT 1`,
    [boardId],
  )
  return rows[0]?.column_id ?? null
}

/**
 * Efeito do split no RM (G3): apaga o registro que cruza o corte e grava dois. `split=null` =
 * reverter, que volta as peças pra um.
 *
 * Roda DEPOIS da escrita no Monday e ANTES do espelho PG, mesma ordem do cancelamento: se o RM
 * cair, o board já mostra o split (que é o que o operador vê) e a pendência vai pra fila. Nunca
 * derruba a resposta — `.catch` próprio.
 *
 * ⚠️ Que o split precise mexer no RM é decisão registrada, não consequência técnica: o
 * `FopConvocacaoData` não guarda contrato, então o S-2260 continua correto sem isto. Ver o
 * cabeçalho de `services/convocacaoBifurcar.ts` e `docs/rm/plano-bifurcacao.md`.
 */
async function efeitoSplitNoRm(
  req: FastifyRequest,
  item: Parameters<typeof parseItemOrigem>[0],
  split: { data_inicio_parte2: string; contrato_parte1: string; contrato_parte2: string } | null,
  operador: string,
): Promise<Record<string, unknown> | undefined> {
  const origem = parseItemOrigem(item)
  if (!bifurcacaoRmHabilitada() || !temRmSoap() || !origem.itemId) return undefined

  const r: ResultadoBifurcacao = await (split
    ? bifurcarConvocacoesDoItem(origem.itemId, {
        corte: split.data_inicio_parte2,
        contratoParte1: split.contrato_parte1,
        contratoParte2: split.contrato_parte2,
        operador,
        timeoutMs: TIMEOUT_REMOCAO_MS,
      })
    : reverterBifurcacaoDoItem(origem.itemId, { operador, timeoutMs: TIMEOUT_REMOCAO_MS })
  ).catch((e) => {
    req.log.warn(e, "split: bifurcacao no RM falhou")
    return { remocoes: [], gravacoes: [], intactos: [], temPendencia: true } as ResultadoBifurcacao
  })

  // A célula do board mostrava o código que acabou de ser apagado — reescreve com o que vive.
  const colCodRm = origem.boardId ? await colunaCodigoRm(String(origem.boardId)) : null
  if (colCodRm && origem.boardId) {
    await ecoCodigosDoItem(
      { itemId: String(origem.itemId), boardId: String(origem.boardId), colCodRm },
      { mudarColunas: changeColumnValues },
    ).catch((e) => req.log.warn(e, "split: eco do codigo RM falhou"))
  }

  if (r.temPendencia) {
    await enfileirar(TIPO_JOB_CONVOCACAO_RM_SUBSTITUIR, {
      item_id: String(origem.itemId),
      tipo: split ? "aplicar" : "reverter",
      corte: split?.data_inicio_parte2 ?? null,
      contrato_parte1: split?.contrato_parte1 ?? null,
      contrato_parte2: split?.contrato_parte2 ?? null,
      board_id: origem.boardId ? String(origem.boardId) : null,
      operador,
    }).catch((e) => req.log.warn(e, "split: enfileirar substituicao RM falhou"))
  }

  return {
    removidos: r.remocoes.filter((x) => x.estado === "removido" || x.estado === "ja_ausente").length,
    criados: r.gravacoes.filter((g) => g.estado === "gravado").length,
    intactos: r.intactos.length,
    pendencia: r.temPendencia,
    nota: r.nota,
    detalhe: [...r.remocoes, ...r.gravacoes].filter((x) => x.erro).map((x) => `${x.lancamentoId ?? "?"}: ${x.erro}`),
  }
}

export async function rotasEspelhoIntermitente(app: FastifyInstance): Promise<void> {
  // WF2 Ler — GET /api/intermitente-ler?uuid=
  app.get(
    "/api/intermitente-ler",
    async (req: FastifyRequest<{ Querystring: { uuid?: string } }>, reply) => {
      const uuid = (req.query.uuid ?? "").trim()
      if (!uuid) return reply.code(400).send({ erro: "uuid_obrigatorio" })
      const payload = await lerConvocacaoPg(uuid)
      if (!payload) return reply.code(404).send({ erro: "nao_encontrado", mensagem: "Link inválido ou expirado." })
      return payload
    },
  )

  // WF4 Buscar Protocolo — GET /api/intermitente-buscar-protocolo?protocolo=
  app.get(
    "/api/intermitente-buscar-protocolo",
    async (req: FastifyRequest<{ Querystring: { protocolo?: string } }>, reply) => {
      const protocolo = (req.query.protocolo ?? "").trim().toUpperCase()
      if (!protocolo) return reply.code(400).send({ erro: "protocolo_obrigatorio" })
      const r = await protocoloPg(protocolo)
      if (!r) return reply.code(404).send({ erro: "nao_encontrado" })
      return r
    },
  )

  // Buscar Convocações Empregado — GET /api/intermitente-convocacoes-empregado?chapa=&mes=
  app.get(
    "/api/intermitente-convocacoes-empregado",
    async (req: FastifyRequest<{ Querystring: { chapa?: string; mes?: string } }>, reply) => {
      const chapa = (req.query.chapa ?? "").trim()
      if (!chapa) return reply.code(400).send({ erro: "chapa_obrigatoria" })
      const mes = (req.query.mes ?? "").trim()
      const convocacoes = await convocacoesEmpregadoPg(chapa, mes)
      return { convocacoes }
    },
  )

  // Feriados — GET /api/intermitente-feriados (lê board Feriados, híbrido).
  app.get("/api/intermitente-feriados", async (_req, reply) => {
    try {
      const feriados = await lerFeriados()
      return { feriados }
    } catch (e) {
      return reply.code(502).send({ erro: "feriados_indisponivel", mensagem: (e as Error).message, feriados: [] })
    }
  })

  // Finalizar — POST /api/intermitente-finalizar?uuid= (WF3). Calcula desconto falta/
  // atraso, grava convocação (status/respostas/agregados/ledger/dias_descontados) + ledger PG.
  app.post(
    "/api/intermitente-finalizar",
    async (
      req: FastifyRequest<{
        Querystring: { uuid?: string }
        Body: {
          uuid?: string
          respostas?: RespostaDia[]
          protocolo?: string
          dias_extras?: string[]
          dias_desativados?: string[]
          sabados_extras?: string[]
          eh_correcao?: boolean
        }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      const uuid = (req.query.uuid || b.uuid || "").trim()
      const respostas = Array.isArray(b.respostas) ? b.respostas : []
      const protocolo = (b.protocolo || "").trim()
      const ehCorrecao = !!b.eh_correcao
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_ausente" })
      if (!protocolo || !/^PROT-[A-Z0-9-]+$/i.test(protocolo))
        return reply.code(400).send({ ok: false, erro: "protocolo_invalido" })

      const { rows } = await query<LinhaConvocacao>(`SELECT * FROM convocacoes WHERE uuid = $1`, [uuid])
      const c = rows[0]
      if (!c) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })

      // Execução aberta com a ficha já em mão (pessoa/contrato preenchem o cabeçalho) e
      // ANTES de qualquer gravação. `uuid_alvo` = UUID da convocação, que é a semântica
      // que a cascata resolverItemDoPlano do monitor de board espera pra `registro`.
      const ex = await abrirExecucao({
        id: (b as CorpoInstrumentado).execucao_id || null,
        acao: "registro",
        motor: "backend",
        operador: operadorDoCorpo(b),
        alvo: uuid,
        pessoa: c.nome,
        contrato: c.contrato,
        resumo: {
          protocolo,
          chapa: c.chapa,
          data_inicio: soData(c.data_inicio),
          data_fim: soData(c.data_fim),
          eh_correcao: ehCorrecao,
          respostas: respostas.length,
        },
      })
      await ex.artefato({ tipo: "convocacao_uuid", chave: uuid, rotulo: "Convocação" })
      await ex.artefato({ tipo: "protocolo", chave: protocolo })

      if (String(c.status_cancelamento ?? "").toLowerCase().includes("cancelad"))
        return recusar(ex, reply, 409, { erro: "convocacao_cancelada" }, "validacao")
      const jaConcluido = statusFront(c.status) === "concluido"
      if (jaConcluido && !ehCorrecao)
        return recusar(ex, reply, 409, { erro: "ja_concluido" }, "validacao")

      // bloqueio desconto_em_consumo (correção sobre desconto já abatido)
      const exist = await descontoExistente(uuid)
      if (exist && jaConsumido(exist) && !ehCorrecao)
        return recusar(ex, reply, 409, { erro: "desconto_em_consumo" }, "validacao")

      const di = soData(c.data_inicio)!
      const df = soData(c.data_fim)!
      const ledger = derivarDescontosPorDia({
        dataInicio: di, dataFim: df, trabalhaSabado: c.trabalha_sabado === true,
        sabadosExtras: c.sabados_extras ?? [], diasExtras: b.dias_extras ?? [],
        diasDesativados: b.dias_desativados ?? [], respostas,
      })
      const ag = agregados(respostas, ledger)
      await ex.etapa("ledger", "ok", {
        metadados: {
          qtd_faltas: ag.qtd_faltas, qtd_atrasos: ag.qtd_atrasos,
          total_minutos: ag.total_minutos, dias_no_ledger: ledger.length,
        },
      })

      const linhas = await lerValores()
      const v = resolverValores(linhas, { contrato: c.contrato ?? "", funcao: "" })
      const vrDia = "vrDia" in v ? v.vrDia : 0
      const vtDia = "vtDia" in v ? v.vtDia : 0
      const porDia: DiaDesconto[] = ledger.map((e) => ({
        vr: e.vr, vt: e.vt, vr_tipo: e.vr_tipo ?? undefined,
        vr_percentual: e.vr_percentual, minutos_atraso: e.minutos_atraso,
      }))
      const desc = calcularDesconto({
        vrDia, vtDia, optanteVT: c.optante_vt === true, contrato: c.contrato ?? "",
        descontosPorDia: porDia,
      })

      // ledger_beneficios (por data) + dias_descontados (incremento idempotente)
      const ledgerObj: Record<string, unknown> = {}
      const diasDesc: Record<string, { vr: boolean; vt: boolean }> = {}
      for (const e of ledger) {
        ledgerObj[e.data] = {
          vr: e.vr, vt: e.vt, vr_percentual: e.vr_percentual, vt_percentual: e.vt_percentual,
          vr_tipo: e.vr_tipo, minutos_atraso: e.minutos_atraso, origens: e.origens,
        }
        if (e.vr || e.vt) diasDesc[e.data] = { vr: e.vr, vt: e.vt }
      }
      const agoraIso = new Date().toISOString()
      const editado = jaConcluido || ehCorrecao
      await comEtapa(ex, "gravar_convocacao", () => query(
        `UPDATE convocacoes SET
           status='Concluido', protocolo=$2, respostas=$3::jsonb,
           ledger_beneficios=$4::jsonb,
           dias_descontados = COALESCE(dias_descontados,'{}'::jsonb) || $5::jsonb,
           qtd_faltas=$6, qtd_atrasos=$7, total_minutos=$8, dias_perde_vr=$9, dias_perde_vt=$10,
           concluido_em = COALESCE(concluido_em, $11), editado=$12,
           editado_em = CASE WHEN $12 THEN $11 ELSE editado_em END,
           atualizado_em=now()
         WHERE uuid=$1`,
        [
          uuid, protocolo, JSON.stringify(respostas), JSON.stringify(ledgerObj),
          JSON.stringify(diasDesc), ag.qtd_faltas, ag.qtd_atrasos, ag.total_minutos,
          ag.dias_perde_vr, ag.dias_perde_vt, agoraIso, editado,
        ],
      ))
      if (desc.descontoVR > 0 || desc.descontoVT > 0) {
        await comEtapa(ex, "desconto", () => upsertDesconto({
          uuid_convocacao: uuid, protocolo, nome: c.nome, chapa: c.chapa, contrato: c.contrato,
          data_inicio: di, data_fim: df, dias_perde_vr: ag.dias_perde_vr, dias_perde_vt: ag.dias_perde_vt,
          qtd_atrasos: ag.total_minutos, desconto_vr: desc.descontoVR, desconto_vt: desc.descontoVT,
          status: "PENDENTE",
        }), { metadados: { desconto_vr: desc.descontoVR, desconto_vt: desc.descontoVT } })
      } else {
        // 'pulado' e não silêncio: "não gerou desconto" é informação, e a ausência da
        // fase faria parecer que a etapa foi esquecida.
        await ex.etapa("desconto", "pulado", { mensagem: "sem falta nem atraso a descontar" })
      }

      // ── Escritas Monday (paridade com o WF3) ─────────────────────────────────────
      //
      // Depois do Postgres de propósito. O PG é a fonte da contingência e nunca falha por
      // rede; o Monday é a VISTA do DP e depende de três chamadas externas. Se o board
      // ficar pra trás, o registro existe e re-finalizar reconcilia (as escritas são
      // idempotentes: `change_multiple_column_values` sobrescreve, o desconto casa por
      // chapa+período). O inverso — board gravado e ledger não — deixaria o DP vendo
      // desconto que o pagamento não conhece.
      //
      // Falha aqui NÃO derruba o registro: fecha 'parcial', que aparece no /atividade sem
      // disparar alerta, e o operador refinaliza.
      const mondayFalhas: string[] = []
      const item = await buscarHistoricoPorUuid(uuid).catch(() => null)
      if (!item) {
        mondayFalhas.push("historico_nao_encontrado")
        await ex.etapa("monday_historico", "aviso", {
          mensagem: "item do Histórico não localizado por uuid — board não atualizado",
        })
      } else {
        const origem = parseItemOrigem(item)
        await ex.artefato({
          tipo: "monday_item",
          chave: item.id,
          rotulo: "Item no Histórico",
          url: `https://contato-serv.monday.com/boards/${BOARD_HISTORICO}/pulses/${item.id}`,
        })

        // 1) Histórico — as 20 colunas do `columnValuesUpdate` do WF3.
        const colsHist: Record<string, unknown> = {
          [COL_HIST.status]: { label: "Concluído" },
          [COL_HIST.protocolo]: protocolo,
          [COL_HIST.concluidoEm]: dataHoraMonday(c.concluido_em ?? agoraIso),
          [COL_HIST.editado]: { checked: editado ? "true" : "false" },
          [COL_HIST.qtdFaltas]: String(ag.qtd_faltas),
          [COL_HIST.qtdAtrasos]: String(ag.qtd_atrasos),
          [COL_HIST.totalMin]: String(ag.total_minutos),
          [COL_HIST.totalMinDevidos]: String(ag.total_min_devidos),
          [COL_HIST.diasPerdeVr]: String(ag.dias_perde_vr),
          [COL_HIST.diasPerdeVt]: String(ag.dias_perde_vt),
          [COL_HIST.diasExtras]: { text: JSON.stringify(b.dias_extras ?? []) },
          [COL_HIST.diasDesativados]: { text: JSON.stringify(b.dias_desativados ?? []) },
          [COL_HIST.respostas]: { text: JSON.stringify(respostas) },
          [COL_HIST.qtdSabadosExtras]: String((c.sabados_extras ?? []).length),
          [COL_HIST.sabadosExtras]: (c.sabados_extras ?? []).join(", "),
          [COL_HIST.ledgerBeneficios]: { text: JSON.stringify(ledgerObj) },
        }
        // Só em reedição, como o WF3: `Editado Em` numa primeira finalização mentiria.
        if (editado) colsHist[COL_HIST.editadoEm] = dataHoraMonday(agoraIso)
        await comEtapa(ex, "monday_historico", () => atualizarHistorico(item.id, colsHist))
          .catch((e) => {
            mondayFalhas.push("historico")
            req.log.warn(e, "finalizar: update historico falhou")
          })

        // 2) Base de Desconto. CPF vem do item da Entrada — o Histórico não tem a coluna,
        //    e criar a linha financeira sem CPF quebra a conferência do DP.
        let cpf = ""
        if (origem.itemId) {
          const oi = await lerItem(Number(origem.itemId)).catch(() => null)
          if (oi) cpf = oi.cv["dup__of_matr_cula"]?.text ?? ""
        }
        const existenteBoard = await buscarDescontoPorPeriodo(c.chapa ?? "", di, df).catch(() => null)
        if (desc.descontoVR > 0 || desc.descontoVT > 0) {
          await comEtapa(ex, "desconto_board", () => gravarDescontoBoard(
            {
              nome: c.nome ?? null, chapa: c.chapa ?? "", cpf,
              dataInicio: di, dataFim: df,
              diasPerdeVT: ag.dias_perde_vt, diasPerdeVR: ag.dias_perde_vr,
              // MINUTOS, não contagem — é o que o WF3 grava em COL_D_QTD_ATRASOS.
              qtdAtrasos: ag.total_minutos,
              descontoVR: desc.descontoVR, descontoVT: desc.descontoVT,
              protocolo,
            },
            existenteBoard,
          )).catch((e) => {
            mondayFalhas.push("desconto_board")
            req.log.warn(e, "finalizar: desconto board falhou")
          })
        } else if (existenteBoard) {
          // `zerar_divida` do WF3. Correção que apaga a ocorrência tem que apagar a dívida:
          // sem isto o item antigo segue PENDENTE com o valor velho e o próximo pagamento
          // abate uma dívida que não existe mais.
          await comEtapa(ex, "desconto_board", () => zerarDescontoBoard(existenteBoard, protocolo))
            .catch((e) => {
              mondayFalhas.push("desconto_board_zerar")
              req.log.warn(e, "finalizar: zerar desconto board falhou")
            })
        }
        if (existenteBoard) {
          await ex.artefato({
            tipo: "desconto_item",
            chave: existenteBoard.id,
            rotulo: "Base de Desconto",
            url: `https://contato-serv.monday.com/boards/${BOARD_DESCONTOS}/pulses/${existenteBoard.id}`,
          })
        }

        // 2.5) Subitems do split — uma metade por contrato no item da Entrada.
        //
        // Lê o split do PRÓPRIO Histórico, não do payload: o front pode mandar `split: null`
        // por race condition (é o mesmo fallback que o WF3 faz). Idempotente por prefixo
        // `Parte N` — refinalizar atualiza os dois subitems em vez de criar mais.
        const split = jsonCol<unknown>(item, COL_HIST.split, null)
        if (origem.itemId && splitValido(split)) {
          try {
            const pai = await lerItemComSubitems(Number(origem.itemId))
            const partes = particionarSplit({
              dataInicio: di, dataFim: df, split,
              respostas, diasExtras: b.dias_extras ?? [],
              diasDesativados: b.dias_desativados ?? [], sabadosExtras: c.sabados_extras ?? [],
            })
            const propaga = {
              empregadoSubstituido: pai?.item.cv[COL_PAI_PROPAGA.empregadoSubstituido]?.text ?? null,
              insalubridade: pai?.item.cv[COL_PAI_PROPAGA.insalubridade]?.text ?? null,
            }
            const subitems = pai?.subitems ?? []
            for (const p of partes) {
              const existente = acharSubitemExistente(subitems, p.parte)
              const cols = colunasSubitem(p, propaga)
              if (existente?.boardId) {
                await mudarColunas(Number(existente.boardId), Number(existente.id), cols)
              } else {
                // `create_subitem` não recebe board — o Monday resolve pelo item pai. Foi o
                // board chumbado no WF (18413180938, de junho) que virou lixo na virada.
                await criarSubitem(Number(origem.itemId), nomeSubitem(p), cols)
              }
            }
            await ex.etapa("subitems_split", "ok", {
              metadados: {
                corte: split.data_inicio_parte2,
                parte1: { contrato: partes[0].contrato, faltas: partes[0].qtdFaltas, minutos: partes[0].totalMin },
                parte2: { contrato: partes[1].contrato, faltas: partes[1].qtdFaltas, minutos: partes[1].totalMin },
              },
            })
          } catch (e) {
            mondayFalhas.push("subitems_split")
            req.log.warn(e, "finalizar: subitems do split falharam")
            await ex.etapa("subitems_split", "erro", { mensagem: e instanceof Error ? e.message : e })
          }
        }

        // 3) Espelho no item do Plano — faltas, minutos e protocolo (WF3 "Atualizar Plan
        //    Falta/Atraso"). SOBRESCREVE com o total calculado; nunca incrementa.
        if (origem.itemId && origem.boardId) {
          await comEtapa(ex, "monday_plano", () => mudarColunas(Number(origem.boardId), Number(origem.itemId), {
            numeric: String(ag.qtd_faltas),
            texto5: String(ag.total_minutos),
            text_mm3zezw: protocolo,
          })).catch((e) => {
            mondayFalhas.push("plano")
            req.log.warn(e, "finalizar: espelho no Plano falhou")
          })
        }
      }

      // ── Sábado extra: boleto VT + lançamento no RM (job) ─────────────────────────
      //
      // Enfileira, não executa: o operador não espera a Caju, e função serverless que morre
      // no meio de um pagamento não deixa retomada — a fila deixa. Idempotência real é a
      // chave por conjunto de sábados (`chaveEfeitoSabados`), então job duplicado por
      // refinalização encontra 'confirmado' e não paga de novo.
      const sabados = c.sabados_extras ?? []
      if (sabados.length > 0) {
        // cpf e cod_secao vêm do snapshot do pré-pagamento, criado pelo /convocar. É a única
        // fonte que já tem os dois; `convocacoes` não guarda seção, e sem seção o lançamento
        // financeiro do RM não tem onde cair.
        const { rows: pre } = await query<{ cpf: string | null; cod_secao: string | null }>(
          `SELECT cpf, cod_secao FROM pontual_prepagamento
            WHERE uuid_convocacao = $1 AND cod_secao IS NOT NULL
            ORDER BY criado_em DESC LIMIT 1`,
          [uuid],
        )
        const cpf = pre[0]?.cpf ?? ""
        const codSecao = pre[0]?.cod_secao ?? ""
        const pedido = montarPedidoSabados(
          {
            uuid, nome: c.nome ?? "", chapa: c.chapa ?? "", contrato: c.contrato ?? "",
            sabados, optanteVT: c.optante_vt === true,
            anoComp: Number(di.slice(0, 4)), mesComp: Number(di.slice(5, 7)),
          },
          linhas,
        )
        if (ehErroSabados(pedido)) {
          // Recusa de regra (não optante, VT/dia zero) não é falha: é informação. O registro
          // já está concluído — o que não acontece é o boleto.
          await ex.etapa("sabado_extra", "pulado", { mensagem: pedido.mensagem, metadados: { erro: pedido.erro } })
        } else if (!cpf || !codSecao) {
          // Não enfileira job condenado. Fica visível e o DP lança à mão.
          await ex.etapa("sabado_extra", "aviso", {
            mensagem: "sem cpf/cod_secao no pre-pagamento — boleto de VT nao enfileirado",
            metadados: { tem_cpf: !!cpf, tem_cod_secao: !!codSecao, sabados: sabados.length },
          })
        } else {
          const jobId = await enfileirar(TIPO_JOB_SABADO_EXTRA, {
            pedido, cpf, codSecao, dataImport: agoraIso.slice(0, 10),
            item_origem_id: item ? parseItemOrigem(item).itemId : null,
          }).catch((e) => { req.log.warn(e, "finalizar: enfileirar sabado extra falhou"); return null })
          await ex.etapa("sabado_extra", jobId ? "ok" : "erro", {
            metadados: {
              job: jobId, qtd_sabados: pedido.qtdSabados, vt_dia: pedido.vtDia,
              valor_total: pedido.valorTotal, habilitado: config.sabadoExtraHabilitado,
            },
          })
          if (jobId) await ex.artefato({ tipo: "job", chave: jobId, rotulo: `Sábado extra — R$ ${pedido.valorTotal}` })
        }
      }

      await ex.fechar(mondayFalhas.length ? "parcial" : "ok", {
        resumo: {
          protocolo, chapa: c.chapa, eh_correcao: ehCorrecao,
          qtd_faltas: ag.qtd_faltas, qtd_atrasos: ag.qtd_atrasos,
          desconto_vr: desc.descontoVR, desconto_vt: desc.descontoVT,
          sabados_extras: sabados.length || undefined,
          monday_falhas: mondayFalhas.length ? mondayFalhas : undefined,
        },
      })
      return {
        ok: true, uuid, protocolo, editado, concluido_em: c.concluido_em ?? agoraIso,
        descontoVR: desc.descontoVR, descontoVT: desc.descontoVT, dias_perde_vr: ag.dias_perde_vr,
        monday_falhas: mondayFalhas,
      }
    },
  )

  // Aplicar Split — POST /api/intermitente-aplicar-split?uuid= (WF ZagUa).
  // CÓDIGO-PRINCIPAL (03/07): grava o split JSON no Histórico do Monday
  // (long_text, formato snake_case do WF — o WF3 lê de lá pra criar os
  // subitems no finalizar) + espelho PG (camelCase, shape do front).
  app.post(
    "/api/intermitente-aplicar-split",
    async (
      req: FastifyRequest<{
        Querystring: { uuid?: string }
        Body: { uuid?: string; tipo?: string; data_inicio_parte2?: string; contrato_parte1?: string; contrato_parte2?: string }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      const uuid = (req.query.uuid || b.uuid || "").trim()
      const tipo = String(b.tipo || "aplicar")
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_ausente" })
      if (!["aplicar", "reverter"].includes(tipo))
        return reply.code(400).send({ ok: false, erro: "tipo_invalido" })

      const item = await buscarHistoricoPorUuid(uuid)
      if (!item) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })

      const operador = String((b as { operador?: { email?: string } })?.operador?.email ?? "split")

      const ex = await abrirExecucao({
        id: (b as CorpoInstrumentado).execucao_id || null,
        acao: "split",
        motor: "backend",
        operador: operadorDoCorpo(b),
        alvo: uuid,
        pessoa: item.name,
        contrato: textoCol(item, COL_HIST.contrato),
        resumo: {
          tipo,
          data_inicio_parte2: b.data_inicio_parte2 ?? null,
          contrato_parte1: b.contrato_parte1 ?? null,
          contrato_parte2: b.contrato_parte2 ?? null,
        },
      })
      await ex.artefato({ tipo: "convocacao_uuid", chave: uuid, rotulo: "Convocação" })
      await ex.artefato({ tipo: "monday_item", chave: item.id, rotulo: "Item no Histórico" })

      if (tipo === "reverter") {
        await comEtapa(ex, "split_board", () =>
          mudarColunaSimples(BOARD_HISTORICO, item.id, COL_HIST.split, ""))
        const rmRev = await comEtapa(ex, "split_rm", () => efeitoSplitNoRm(req, item, null, operador))
        await comEtapa(ex, "espelho_pg", () =>
          query(`UPDATE convocacoes SET split=NULL, atualizado_em=now() WHERE uuid=$1`, [uuid]))
          .catch((e) => req.log.warn(e, "split: espelho PG falhou"))
        // `pendencia` do RM = job na fila, não conclusão limpa: 'parcial' evita dizer
        // "ok" pra algo que ainda vai ser reconciliado.
        await ex.fechar(rmRev?.pendencia ? "parcial" : "ok")
        return { ok: true, split: null, rm: rmRev }
      }
      const data = String(b.data_inicio_parte2 || "").trim()
      const c1 = String(b.contrato_parte1 || "").trim()
      const c2 = String(b.contrato_parte2 || "").trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !c1 || !c2)
        return recusar(ex, reply, 400, { erro: "split_invalido" }, "validacao")
      if (c1 === c2) return recusar(ex, reply, 400, { erro: "contratos_iguais" }, "validacao")

      // Corte fora do período não é split: uma das partes nasceria vazia. O WF não validava e
      // gravava o JSON assim mesmo — agora que isso vira efeito no RM (G3), recusa.
      const di = textoCol(item, COL_HIST.dataInicio)
      const df = textoCol(item, COL_HIST.dataFim)
      if (di && df && !(data > di && data <= df))
        return recusar(
          ex, reply, 400,
          { erro: "corte_fora_periodo", mensagem: `O corte precisa cair depois de ${di} e até ${df}.` },
          "validacao",
        )

      // Board: snake_case (contrato do WF; o WF3 finalizar parseia esse formato).
      const splitBoard = { data_inicio_parte2: data, contrato_parte1: c1, contrato_parte2: c2 }
      await comEtapa(ex, "split_board", () =>
        mudarColunaSimples(BOARD_HISTORICO, item.id, COL_HIST.split, JSON.stringify(splitBoard)))

      const rm = await comEtapa(ex, "split_rm", () => efeitoSplitNoRm(req, item, splitBoard, operador),
        { metadados: { corte: data, contrato_parte1: c1, contrato_parte2: c2 } })

      const split = { dataInicioParte2: data, contratoParte1: c1, contratoParte2: c2 }
      await comEtapa(ex, "espelho_pg", () =>
        query(`UPDATE convocacoes SET split=$2::jsonb, atualizado_em=now() WHERE uuid=$1`, [uuid, JSON.stringify(split)]))
        .catch((e) => req.log.warn(e, "split: espelho PG falhou"))
      await ex.fechar(rm?.pendencia ? "parcial" : "ok", {
        resumo: { tipo, corte: data, contrato_parte1: c1, contrato_parte2: c2 },
      })
      return { ok: true, split, rm }
    },
  )

  // Cancelar Convocação — POST /api/intermitente-cancelar-convocacao?uuid=
  // CÓDIGO-PRINCIPAL (03/07): porta fiel do WF sbKoeewb. Fonte = board Monday
  // (Histórico por uuid); escreve Histórico + Entrada + board Descontos + move
  // grupo, e espelha no PG. Cancelamento DESCONTA SEMPRE (inclusive DETRAN/TRE/SEDUC).
  app.post(
    "/api/intermitente-cancelar-convocacao",
    async (
      req: FastifyRequest<{
        Querystring: { uuid?: string }
        Body: { uuid?: string; tipo?: string; data_inicio_cancelamento?: string | null }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      const uuid = (req.query.uuid || b.uuid || "").trim()
      const tipo = String(b.tipo || "").trim()
      const dataCancel = b.data_inicio_cancelamento || null
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_ausente" })
      if (!["total", "parcial", "reverter"].includes(tipo))
        return reply.code(400).send({ ok: false, erro: "tipo_invalido" })

      // REVERTER NÃO EXISTE mais como operação persistida (decisão do Isaac, 11/08).
      //
      // Reverter só faz sentido enquanto o cancelamento é rascunho na tela — e isso o frontend
      // resolve sozinho, sem rede. Depois de enviado não há volta possível: cancelar apaga a
      // convocação no RM (evento eSocial S-2260) e delete não se desfaz. O que o app conseguiria
      // fazer é criar OUTRA convocação, com C03S###### novo e um segundo evento pro mesmo
      // período — o oposto de "reverter". A trava fica aqui e não só na tela porque o board, o
      // ledger e o RM ficariam divergentes se alguém chamasse a rota direto.
      if (tipo === "reverter") {
        return reply.code(400).send({
          ok: false,
          erro: "cancelamento_irreversivel",
          mensagem:
            "Cancelamento registrado não pode ser revertido. Para retomar o período, crie uma nova convocação.",
        })
      }

      const item = await buscarHistoricoPorUuid(uuid)
      if (!item) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })

      // Cancelamento é IRREVERSÍVEL (apaga o S-2260 no RM). A execução abre antes de
      // qualquer escrita justamente pra que uma falha no meio deixe rastro de onde parou.
      const ex = await abrirExecucao({
        id: (b as CorpoInstrumentado).execucao_id || null,
        acao: "cancelamento",
        motor: "backend",
        operador: operadorDoCorpo(b),
        alvo: uuid,
        pessoa: item.name,
        contrato: textoCol(item, COL_HIST.contrato),
        resumo: {
          tipo,
          data_inicio_cancelamento: dataCancel,
          chapa: (textoCol(item, COL_HIST.chapa) || "").trim() || null,
        },
      })
      await ex.artefato({ tipo: "convocacao_uuid", chave: uuid, rotulo: "Convocação" })
      await ex.artefato({ tipo: "monday_item", chave: item.id, rotulo: "Item no Histórico" })

      const di = textoCol(item, COL_HIST.dataInicio)
      const df = textoCol(item, COL_HIST.dataFim)
      if (!di || !df) return recusar(ex, reply, 400, { erro: "periodo_invalido" }, "validacao")
      if (tipo === "parcial") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataCancel || "")))
          return recusar(ex, reply, 400, { erro: "data_cancelamento_invalida" }, "validacao")
        if (dataCancel! < di || dataCancel! > df)
          return recusar(ex, reply, 400, { erro: "data_fora_periodo" }, "validacao")
      }

      // Bloqueios (paridade com o WF pós-fix 30/06): CANCELADA total bloqueia
      // tudo; parcial-sobre-parcial bloqueia; TOTAL sobre parcial permite e
      // cancela só os dias que faltavam (via ledger origem cancelamento:*).
      const statusCancelAtual = normTxt(textoCol(item, COL_HIST.statusCancel))
      const eraParcial = statusCancelAtual === "CANCELADA PARCIALMENTE"
      if (statusCancelAtual === "CANCELADA")
        return recusar(ex, reply, 409, { erro: "convocacao_ja_cancelada" }, "validacao")
      if (eraParcial && tipo === "parcial")
        return recusar(ex, reply, 409, { erro: "convocacao_ja_cancelada" }, "validacao")

      const origem = parseItemOrigem(item)
      if (!origem.itemId)
        return recusar(ex, reply, 400, { erro: "item_origem_ausente" }, "validacao")

      const trabalhaSabado = normTxt(textoCol(item, COL_HIST.trabalhaSabado)) === "SIM"
      const sabadosExtras = (textoCol(item, COL_HIST.sabadosExtras) || "")
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
      const contrato = textoCol(item, COL_HIST.contrato) || ""
      const chapa = (textoCol(item, COL_HIST.chapa) || "").trim()

      // Ledger vigente (ou reconstruído das respostas/desativados/atestados).
      let ledger = jsonCol<Ledger>(item, COL_HIST.ledgerBeneficios, {})
      if (!ledger || Object.keys(ledger).length === 0) {
        ledger = reconstruirLedger({
          respostas: jsonCol(item, COL_HIST.respostas, []),
          diasDesativados: jsonCol(item, COL_HIST.diasDesativados, []),
          atestados: jsonCol(item, COL_HIST.atestados, []),
          trabalhaSabado,
          sabadosExtras,
        })
      }

      const range = rangeCancelamento({
        tipo: tipo as "total" | "parcial",
        eraParcial,
        ledger,
        dataInicio: di,
        dataFim: df,
        dataCancel,
        trabalhaSabado,
        sabadosExtras,
      })

      // Item origem (Entrada): cpf/função/optante — mais atual que o Histórico.
      const origemItem = await lerItem(Number(origem.itemId))
      const cpf = (origemItem?.cv["dup__of_matr_cula"]?.text || "").trim()
      const funcao = normTxt(origemItem?.cv["texto0"]?.text || "")
      const optanteRaw = normTxt(origemItem?.cv["optante___vt"]?.text || textoCol(item, COL_HIST.optanteVt) || "NAO")
      const optanteVT = optanteRaw === "SIM" || optanteRaw === "SIM*"
      const vtSoVolta = optanteRaw === "SIM*"

      // Valores do board (por contrato+função) — mesma resolução do WF.
      const linhas = await lerValores()
      const v = resolverValores(linhas, { contrato, funcao })
      if ("erro" in v)
        return recusar(ex, reply, 502, { erro: v.erro, mensagem: v.mensagem }, "valores")
      const vrDia = v.vrDia
      let vtDia = optanteVT ? v.vtDia : 0
      if (vtSoVolta && vtDia > 0) vtDia = Math.round((vtDia / 2) * 100) / 100

      // Antifraude: desconto do MESMO período já em consumo bloqueia (board + PG).
      const existenteBoard = await buscarDescontoPorPeriodo(chapa, range.inicio, range.fim)
      if (existenteBoard && ["PARCIAL", "FINALIZADO"].includes(existenteBoard.status))
        return recusar(ex, reply, 409, { erro: "desconto_em_consumo" }, "antifraude")
      const existPg = await descontoExistente(uuid)
      if (existPg && jaConsumido(existPg))
        return recusar(ex, reply, 409, { erro: "desconto_em_consumo" }, "antifraude")

      const calc = aplicarCancelamento({
        ledger,
        diasCancelados: range.dias,
        tipo: tipo as "total" | "parcial",
        vrDia,
        vtDia,
        optanteVT,
        trabalhaSabado,
        sabadosExtras,
      })

      const label = tipo === "total" ? "Cancelada" : "Cancelada parcialmente"
      await ex.etapa("calculo", "ok", {
        metadados: {
          dias_cancelados: range.dias.length,
          desconto_vr: calc.descontoVR, desconto_vt: calc.descontoVT,
          vr_dia: vrDia, vt_dia: vtDia,
        },
      })

      // ── Escritas Monday (na ordem do WF) ──
      await comEtapa(ex, "monday_historico", () => atualizarHistorico(item.id, {
        [COL_HIST.statusCancel]: { label },
        [COL_HIST.ledgerBeneficios]: { text: JSON.stringify(calc.ledger) },
      }))
      const updateEntrada: Record<string, unknown> = { [COL_ENTRADA_STATUS]: { label } }
      if (tipo === "parcial") updateEntrada[COL_ENTRADA_DATA_CANCEL] = { date: dataCancel }
      const boardOrigem = Number(origem.boardId || 0)
      if (boardOrigem) {
        await ex.artefato({
          tipo: "monday_item",
          chave: String(origem.itemId),
          rotulo: "Item no Plano",
          url: `https://contato-serv.monday.com/boards/${boardOrigem}/pulses/${origem.itemId}`,
        })
        await comEtapa(ex, "monday_entrada", () =>
          mudarColunas(boardOrigem, Number(origem.itemId), updateEntrada),
        ).catch((e) => req.log.warn(e, "cancelar: update entrada falhou"))
        // Move o item da Entrada pro grupo CANCELADOS / CANCELADOS PARCIAL do board de origem.
        const { rows: grps } = await query<{ titulo: string; group_id: string }>(
          `SELECT titulo, group_id FROM board_grupos WHERE monday_board_id = $1`,
          [String(boardOrigem)],
        )
        const alvo = tipo === "total" ? "CANCELADOS" : "CANCELADOS PARCIAL"
        const grupo = grps.find((g) => normTxt(g.titulo) === alvo)?.group_id
        if (grupo)
          await moverParaGrupo(Number(origem.itemId), grupo).catch((e) =>
            req.log.warn(e, "cancelar: mover grupo falhou"),
          )
      }
      if (calc.descontoVR > 0 || calc.descontoVT > 0) {
        await comEtapa(ex, "desconto_board", () => gravarDescontoBoard(
          {
            nome: item.name,
            chapa,
            cpf,
            dataInicio: range.inicio,
            dataFim: range.fim,
            diasPerdeVT: calc.diasPerdeVT,
            diasPerdeVR: calc.diasPerdeVR,
            qtdAtrasos: 0,
            descontoVR: calc.descontoVR,
            descontoVT: calc.descontoVT,
          },
          existenteBoard,
        ), { metadados: { acao: existenteBoard ? "update" : "create" } })
      } else {
        await ex.etapa("desconto_board", "pulado", { mensagem: "nada a descontar no período cancelado" })
      }

      // ── RM: apagar a convocação (S-2260) ──
      //
      // Só no cancelamento TOTAL. No parcial a convocação continua existindo com período menor —
      // isso é edição (G2), não remoção, e o RM já provou aceitar UPDATE (11/08, chapa 006534).
      //
      // Depois das escritas Monday e ANTES do espelho PG de propósito: se o RM cair, o board já
      // reflete o cancelamento (que é o que o operador vê) e a pendência fica registrada. Nunca
      // derruba o cancelamento — `.catch` próprio: o item já foi movido de grupo, e falhar aqui
      // faria o operador tentar de novo e bater no 409 da própria antifraude.
      let rmRemocao: Awaited<ReturnType<typeof removerConvocacoesDoItem>> | null = null
      let rmEncurta: Awaited<ReturnType<typeof encurtarConvocacoesDoItem>> | null = null

      // PARCIAL: a convocação continua existindo, com o fim em `dataCancel - 1`. Editar (e não
      // apagar+recriar) preserva o C03S###### e o ato — recriar emitiria um segundo S-2260.
      if (tipo === "parcial" && config.convocacaoRmHabilitada && temRmSoap() && origem.itemId && dataCancel) {
        const novoFim = somarDias(String(dataCancel), -1)
        rmEncurta = await encurtarConvocacoesDoItem(origem.itemId, {
          novoFim,
          removidoPor: String((b as { operador?: { email?: string } })?.operador?.email ?? "cancelamento"),
          timeoutMs: TIMEOUT_REMOCAO_MS,
        }).catch((e) => {
          req.log.warn(e, "cancelar parcial: encurtar no RM falhou")
          return { edicoes: [], remocoes: [], temPendencia: true }
        })
        // 'aviso' e não 'erro' quando há pendência: o job vai reconciliar, então não é
        // falha — mas também não é 'ok', e o operador precisa ver a diferença.
        await ex.etapa("encurtar_rm", rmEncurta.temPendencia ? "aviso" : "ok", {
          metadados: {
            novo_fim: novoFim,
            editados: rmEncurta.edicoes.filter((e) => e.estado === "editado").length,
            pendencia: rmEncurta.temPendencia,
          },
        })
        if (rmEncurta.temPendencia) {
          // Mesma fila da remoção: o job relê o rastro e conclui o que ficou. Aqui ele resolve
          // os pedaços que viraram remoção; a edição pendente fica visível na resposta.
          const jobId = await enfileirar(TIPO_JOB_CONVOCACAO_RM_REMOVER, {
            item_id: String(origem.itemId),
            motivo: "cancelamento_parcial",
            removido_por: String((b as { operador?: { email?: string } })?.operador?.email ?? "cancelamento"),
          }).catch((e) => {
            req.log.warn(e, "cancelar parcial: enfileirar RM falhou")
            return null
          })
          if (jobId) await amarrarJob(ex, jobId, req)
        }
      }

      if (tipo === "total" && config.convocacaoRmHabilitada && temRmSoap() && origem.itemId) {
        rmRemocao = await removerConvocacoesDoItem(origem.itemId, {
          motivo: "cancelamento_total",
          removidoPor: String((b as { operador?: { email?: string } })?.operador?.email ?? "cancelamento"),
          timeoutMs: TIMEOUT_REMOCAO_MS,
        }).catch((e) => {
          req.log.warn(e, "cancelar: remocao no RM falhou")
          return { removidos: [], temPendencia: true }
        })
        // Pendência (RM mudo ou erro) vai pra fila: registro vivo no RM com board cancelado é o
        // desfecho mais caro, então insiste até sumir. Enfileirar não pode derrubar a resposta.
        await ex.etapa("cancelar_rm", rmRemocao.temPendencia ? "aviso" : "ok", {
          metadados: {
            removidos: rmRemocao.removidos.filter((r) => r.estado === "removido").length,
            ja_ausentes: rmRemocao.removidos.filter((r) => r.estado === "ja_ausente").length,
            pendencia: rmRemocao.temPendencia,
          },
        })
        for (const r of rmRemocao.removidos) {
          // O código apagado vira artefato: é o rastro de qual S-2260 saiu do RM, e é a
          // pergunta que ninguém consegue responder depois se não ficar gravado.
          if (r.pk) await ex.artefato({ tipo: "rm_convocacao", chave: String(r.pk), rotulo: `removido (${r.estado})` })
        }
        if (rmRemocao.temPendencia) {
          const jobId = await enfileirar(TIPO_JOB_CONVOCACAO_RM_REMOVER, {
            item_id: String(origem.itemId),
            motivo: "cancelamento_total",
            removido_por: String((b as { operador?: { email?: string } })?.operador?.email ?? "cancelamento"),
          }).catch((e) => {
            req.log.warn(e, "cancelar: enfileirar remocao RM falhou")
            return null
          })
          if (jobId) await amarrarJob(ex, jobId, req)
        }
        // Código de convocação apagada não pode continuar no board afirmando um registro que não
        // existe mais. Só limpa se TODOS saíram — com pendência, o que sobrou ainda está no RM.
        const colCodRm = boardOrigem ? await colunaCodigoRm(String(boardOrigem)) : null
        if (colCodRm && !rmRemocao.temPendencia && rmRemocao.removidos.length) {
          await mudarColunas(boardOrigem, Number(origem.itemId), { [colCodRm]: "" }).catch((e) =>
            req.log.warn(e, "cancelar: limpar codigo RM no board falhou"),
          )
        }
      }

      // ── Espelho PG ──
      await comEtapa(ex, "espelho_pg", () => query(
        `UPDATE convocacoes SET status_cancelamento = $2, data_inicio_cancelamento = $3,
           ledger_beneficios = $4::jsonb, atualizado_em = now() WHERE uuid = $1`,
        [uuid, label, tipo === "parcial" ? dataCancel : null, JSON.stringify(calc.ledger)],
      )).catch((e) => req.log.warn(e, "cancelar: espelho PG falhou"))
      if (calc.descontoVR > 0 || calc.descontoVT > 0) {
        await upsertDesconto({
          uuid_convocacao: uuid, protocolo: null, nome: item.name, chapa,
          contrato, data_inicio: range.inicio, data_fim: range.fim,
          dias_perde_vr: calc.diasPerdeVR, dias_perde_vt: calc.diasPerdeVT,
          desconto_vr: calc.descontoVR, desconto_vt: calc.descontoVT, status: "PENDENTE",
        }).catch((e) => req.log.warn(e, "cancelar: desconto PG falhou"))
      }

      // Solta a reserva do pré-pagamento pontual, se houver.
      //
      // Convocação cancelada não vai pagar, então a dívida que ela prendeu tem que voltar ao
      // FIFO na hora — senão o fechamento mensal abate menos do que devia e ninguém percebe,
      // que é o modo de falha silencioso que a reserva introduz se não for soltada.
      //
      // No cancelamento PARCIAL a dívida também volta inteira: o período encurtou, então o
      // benefício mudou, e o número velho não vale mais. A felipeta recalcula.
      if (origem.itemId) {
        const soltas = await liberarPrePagamento(String(origem.itemId), `cancelamento_${tipo}`)
          .catch((e) => {
            req.log.warn(e, "cancelar: liberar pre-pagamento falhou")
            return 0
          })
        if (soltas > 0) {
          await ex.etapa("liberar_prepagamento", "ok", {
            mensagem: "reserva de desconto devolvida ao FIFO",
          })
        }
      }

      // 'parcial' quando o RM ficou pendente: o board já mostra cancelado, mas pode
      // haver convocação viva no RM até o job reconciliar. Chamar isso de 'ok' esconderia
      // exatamente o desfecho mais caro — e é o que a resposta já expõe em `rm.pendencia`.
      const rmPendente = !!rmRemocao?.temPendencia || !!rmEncurta?.temPendencia
      await ex.fechar(rmPendente ? "parcial" : "ok", {
        resumo: {
          tipo,
          data_inicio_cancelamento: tipo === "parcial" ? dataCancel : null,
          dias_cancelados: range.dias.length,
          desconto_vr: calc.descontoVR,
          desconto_vt: calc.descontoVT,
          rm_pendencia: rmPendente,
        },
      })

      return {
        ok: true,
        tipo,
        data_inicio_cancelamento: tipo === "parcial" ? dataCancel : null,
        // Visível na resposta pra quem cancelou saber que o RM ficou pendente — sem isso, "ok"
        // esconderia convocação viva no RM com o board já cancelado.
        rm: rmRemocao
          ? {
              removidos: rmRemocao.removidos.filter((r) => r.estado === "removido").length,
              ja_ausentes: rmRemocao.removidos.filter((r) => r.estado === "ja_ausente").length,
              pendencia: rmRemocao.temPendencia,
              detalhe: rmRemocao.removidos.filter((r) => r.erro).map((r) => `${r.pk ?? r.lancamentoId}: ${r.erro}`),
            }
          : rmEncurta
            ? {
                editados: rmEncurta.edicoes.filter((e) => e.estado === "editado").length,
                removidos: rmEncurta.remocoes.filter((r) => r.estado === "removido").length,
                pendencia: rmEncurta.temPendencia,
                detalhe: [...rmEncurta.edicoes, ...rmEncurta.remocoes]
                  .filter((r) => r.erro)
                  .map((r) => `${r.pk ?? r.lancamentoId}: ${r.erro}`),
              }
            : undefined,
        dias_cancelados: range.dias,
        dias_ignorados_duplicidade: calc.diasIgnoradosDuplicidade,
        desconto: {
          acao: calc.descontoVR === 0 && calc.descontoVT === 0 ? "skip" : existenteBoard ? "update" : "create",
          descontoVR: calc.descontoVR,
          descontoVT: calc.descontoVT,
          vrDia,
          vtDia,
        },
      }
    },
  )

}
