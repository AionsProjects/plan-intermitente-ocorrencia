import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import {
  acharItensPorColuna,
  createItem,
  lerColunasSettings,
  uploadFileToColumn,
} from "../monday.js"
import { usuarioDaSessao } from "../session.js"
import { config } from "../config.js"
import { chapaAceitavelNoFiltro, paraDataBr } from "../domain/convocacaoRm.js"
import { temRmSoap } from "../clients/rmSoap.js"
import { confirmarEfeito, enfileirar, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import { TIPO_JOB_CONVOCACAO_RM, type PayloadConvocacaoRmPontual } from "../jobs/convocacaoRmPontual.js"
import { processarConvocacaoPontual, TIMEOUT_INLINE_MS } from "../services/convocacaoPontual.js"
import { unidadesRm } from "./rmLookups.js"
import { arquivarDrive } from "../services/driveArquivar.js"
import { abrirExecucao, comEtapa, type EstadoEtapa, type Execucao } from "../services/execucao.js"
import { calcularPrePagamentoConvocacao } from "../pontual/prePagamentoConvocacao.js"
import { anotarPastaDrive, reservarPrePagamento } from "../pontual/prepagamento.js"
import { codigoSecaoContrato } from "../mensal/calculo.js"

// Opções do form de convocação: labels das colunas status do board Entrada ATUAL
// (resolvido pelo registry, por nome — robusto à virada). unidadesPorContrato vem do RM
// (n8n-thin, F6) — por ora {} e o front usa OPCOES_CONVOCACAO_FALLBACK.
// Nomes canônicos (título) das colunas status no board Entrada:
const NOMES = {
  solicitantes: "Solicitante",
  contratos: "Op - Contrato",
  sabados: "OP - Sábado?",
  insalubridades: "Op - Insalubridade?",
  interiores: "OP - Interior?",
  justificativas: "OP - Justificativa",
} as const
const NOME_UNIDADE = "OP - Local/Unidade"

// Descarta labels corrompidas por encoding (contêm o replacement char U+FFFD "�").
// Sempre há a versão correta coexistindo (ex: "N�O" + "NÃO" → mantém só "NÃO").
const labelOk = (l: string | undefined): l is string => !!l && !l.includes("�")

function extrairLabels(settingsStr: string): string[] {
  try {
    const s = JSON.parse(settingsStr) as {
      labels?: unknown
      labels_positions_v2?: Record<string, number>
    }
    const labels = s.labels
    if (Array.isArray(labels)) {
      return labels
        .map((l) => (typeof l === "string" ? l : (l as { name?: string })?.name))
        .filter(labelOk)
    }
    if (labels && typeof labels === "object") {
      const mapa = labels as Record<string, string>
      // Índices ATIVOS (labels_positions_v2) na ordem; se vazio, todas as keys.
      const pos = s.labels_positions_v2
      const indices =
        pos && Object.keys(pos).length
          ? Object.keys(pos).sort((a, b) => pos[a] - pos[b])
          : Object.keys(mapa).sort((a, b) => Number(a) - Number(b))
      // Filtra labels corrompidas (�) — cobre Sábado/Insalubridade e quaisquer outras.
      return indices.map((i) => mapa[i]).filter(labelOk)
    }
  } catch { /* ignore */ }
  return []
}

// Títulos canônicos das colunas usadas na criação (resolvidos por nome via registry).
const COL = {
  nomeEmpregado: "Nome do Empregado",
  cpf: "CPF",
  chapa: "Funcionário",
  funcao: "Função",
  admissao: "Admissão",
  escala: "Escala",
  solicitante: "Solicitante",
  contrato: "Op - Contrato",
  localTexto: "Local/Unidade",
  localDropdown: "OP - Local/Unidade",
  sabado: "OP - Sábado?",
  insalubridade: "Op - Insalubridade?",
  interior: "OP - Interior?",
  tipoConvocacao: "OP - Tipo Convocação",
  dataInicio: "OP - Data/Inicio",
  dataFim: "OP - Data/Fim",
  justificativa: "OP - Justificativa",
  substituido: "OP - Empregado Substituído",
  statusConvocacao: "Status", // título no board Entrada (= Status Convocação, color_mm3a8ana)
  optanteVT: "Vale Transporte",
  vtSoVolta: "OP - VT só volta?",
  termoConvocacao: "Termo de Convocação",
  termoInsalubridade: "Termo de Insalubridade",
  /** Onde o C03S###### do RM é ecoado. Só o código real entra aqui. */
  codigoRm: "Código Convocação RM",
} as const
const CANCEL_INICIO_ID = "date_mm3b88ta" // Cancelamento Início (id estável)

// Resolve board do mês (registry) + mapa nome->column_id.
async function resolverBoard(papel: string) {
  const { rows: br } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel=$1 AND ativo=true LIMIT 1`,
    [papel],
  )
  const boardId = br[0]?.monday_board_id
  if (!boardId) return null
  const { rows: cols } = await query<{ nome: string; column_id: string }>(
    `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`,
    [boardId],
  )
  const { rows: grupos } = await query<{ group_id: string }>(
    `SELECT group_id FROM board_grupos WHERE monday_board_id=$1 AND upper(titulo)='PONTUAL' LIMIT 1`,
    [boardId],
  )
  return {
    boardId,
    idPorNome: new Map(cols.map((c) => [c.nome, c.column_id])),
    grupoPontual: grupos[0]?.group_id,
  }
}

function overlap(aIni: string, aFim: string, bIni: string, bFim: string): boolean {
  return aIni <= bFim && bIni <= aFim
}

function semAcento(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function normalizeVtLabel(v: string | undefined): string {
  const raw = semAcento(String(v ?? "").trim()).toUpperCase()
  if (raw === "SIM*") return "SIM*"
  if (raw === "SIM" || raw === "TRUE" || raw === "1") return "SIM"
  return "NÃO"
}

function normCode(v: string): string {
  return v.replace(/\D/g, "").replace(/^0+/, "") || v.trim().toUpperCase()
}

function normName(v: string): string {
  return semAcento(v).toUpperCase().replace(/\s+/g, " ").trim()
}

/**
 * Desfecho do lançamento no RM, como o front vê.
 *
 * `gravado` é o caso comum e traz o código. Os demais dizem POR QUE não há código ainda, e a
 * distinção importa: `conciliando` significa "pode ter gravado, estamos lendo pra saber" — nunca
 * pode ser apresentado como falha, nem levar ninguém a tentar de novo.
 */
type EstadoRmResposta =
  | { estado: "gravado"; codigos: string[] }
  | { estado: "enfileirado"; job_id: string; codigos?: string[]; motivo?: string }
  | { estado: "conciliando"; job_id: string; codigos?: string[] }
  | { estado: "coberto_por_ausencia" }
  | { estado: "invalido"; motivo: string }
  | { estado: "desligado" | "sem_chapa" | "rm_nao_configurado" }
  | { estado: "nao_enfileirado"; motivo: string }

/**
 * Lança a convocação no RM como parte da própria criação — o operador vê o `C03S######` na tela.
 *
 * Tenta AQUI, no request, com teto curto. Só cai pra fila quando o RM não fecha. A fila continua
 * existindo porque encurtar o timeout tem preço: timeout é `indeterminado` ("pode ter gravado"),
 * e nesse caso reenviar é o único jeito de duplicar um S-2260 — quem resolve é a conciliação por
 * leitura do passo 1 do job, não uma segunda tentativa.
 *
 * Recusas baratas (flag, chapa, RM não configurado) são decididas antes de qualquer I/O:
 * enfileirar o que já se sabe que não vai gravar só produz fila morta.
 */
async function lancarConvocacaoRm(p: {
  itemId: string
  boardId: string
  colCodRm: string | null
  campos: Record<string, string>
  dataInicio: string
  dataFim: string
  operador?: string | null
}): Promise<EstadoRmResposta> {
  if (!config.convocacaoRmHabilitada) return { estado: "desligado" }
  // `empregado_chapa` NÃO é campo obrigatório do form — e sem chapa não existe convocação no RM.
  if (!chapaAceitavelNoFiltro(p.campos.empregado_chapa ?? "")) return { estado: "sem_chapa" }
  if (!temRmSoap()) return { estado: "rm_nao_configurado" }

  const payload: PayloadConvocacaoRmPontual = {
    item_id: p.itemId,
    board_id: p.boardId,
    col_cod_rm: p.colCodRm,
    contrato: p.campos.contrato ?? "",
    chapa: p.campos.empregado_chapa ?? "",
    nome: p.campos.empregado_nome,
    data_inicio: p.dataInicio,
    data_fim: p.dataFim,
    // Vem do RM em `DD/MM/YYYY`; `paraDataIso` no domínio aceita os dois formatos.
    data_admissao: p.campos.empregado_admissao || null,
    operador: p.operador ?? null,
  }
  const paraFila = async (passo: 0 | 1): Promise<string> =>
    enfileirar(TIPO_JOB_CONVOCACAO_RM, payload as unknown as Record<string, unknown>, { passo })

  const dados = {
    itemId: p.itemId,
    boardId: p.boardId,
    colCodRm: p.colCodRm,
    contrato: payload.contrato,
    chapa: payload.chapa,
    dataInicio: p.dataInicio,
    dataFim: p.dataFim,
    dataAdmissao: payload.data_admissao,
    operador: payload.operador,
  }

  let r: Awaited<ReturnType<typeof processarConvocacaoPontual>>
  try {
    r = await processarConvocacaoPontual(dados, { timeoutMs: TIMEOUT_INLINE_MS })
  } catch (e) {
    // Estouro ANTES de qualquer gravação (leitura de atestado fechada, board fora do ar...).
    // Nada foi escrito no RM, então a fila pode tentar do zero.
    return { estado: "enfileirado", job_id: await paraFila(0), motivo: (e as Error).message.slice(0, 160) }
  }

  if (r.cobertoPorAusencia) return { estado: "coberto_por_ausencia" }
  // Mudo: pode ter gravado. Vai direto pro passo de CONCILIAÇÃO — nunca pro reenvio.
  if (r.precisaConciliar) return { estado: "conciliando", job_id: await paraFila(1), codigos: r.codigos }
  if (r.retryavel) return { estado: "enfileirado", job_id: await paraFila(0), codigos: r.codigos, motivo: r.retryavel }
  if (r.invalido) return { estado: "invalido", motivo: r.invalido }
  return { estado: "gravado", codigos: r.codigos }
}

export async function rotasConvocar(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/convocar/opcoes",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        // board atual + mapa nome->column_id do registry
        const { rows: br } = await query<{ monday_board_id: string }>(
          `SELECT monday_board_id FROM boards WHERE papel='atual' AND ativo=true LIMIT 1`,
        )
        const boardId = br[0]?.monday_board_id
        if (!boardId) return reply.code(404).send({ erro: "board_atual_nao_registrado" })
        const { rows: cols } = await query<{ nome: string; column_id: string }>(
          `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`, [boardId],
        )
        const idPorNome = new Map(cols.map((c) => [c.nome, c.column_id]))
        const idsParaLer = Object.values(NOMES)
          .map((n) => idPorNome.get(n)).filter((x): x is string => !!x)
        const colsSettings = await lerColunasSettings(boardId, idsParaLer)
        const settingsPorId = new Map(colsSettings.map((c) => [c.id, c.settings_str]))
        const labelsDe = (nome: string): string[] => {
          const id = idPorNome.get(nome)
          const ss = id ? settingsPorId.get(id) : undefined
          return ss ? extrairLabels(ss) : []
        }
        // Unidades vêm do RM (mesma fonte do ponto facultativo) via n8n-thin.
        // Best-effort: se falhar, front usa fallback local.
        let unidadesPorContrato: Record<string, string[]> = {}
        try {
          unidadesPorContrato = (await unidadesRm()).unidades_por_contrato
        } catch (e) {
          req.log.warn(e, "unidades RM falhou (usa fallback)")
        }
        return {
          ok: true,
          opcoes: {
            solicitantes: labelsDe(NOMES.solicitantes),
            contratos: labelsDe(NOMES.contratos),
            sabados: labelsDe(NOMES.sabados),
            insalubridades: labelsDe(NOMES.insalubridades),
            interiores: labelsDe(NOMES.interiores),
            justificativas: labelsDe(NOMES.justificativas),
            unidades_por_contrato: unidadesPorContrato,
            unidade_column_id: idPorNome.get(NOME_UNIDADE) ?? null,
          },
        }
      } catch (e) {
        req.log.error(e, "erro convocar-opcoes")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )

  // Cria convocação no board do mês (atual/proximo) — substitui WF7. Multipart
  // (campos + termos opcionais). Antifraude de período + create_item + upload.
  /**
   * Estado da convocação no RM, devolvido junto com a criação. O front usa a PRESENÇA deste
   * campo pra saber quem atendeu: sem ele, quem respondeu foi o n8n e o RM não foi acionado.
   */
  const criarConvocacaoHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    // Escrita no Monday -> exige sessão (operador logado).
    const usuario = await usuarioDaSessao(req)
    if (!usuario) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
    // Lê multipart: campos texto em `campos`, arquivos em `arquivos`.
    const campos: Record<string, string> = {}
    const arquivos: Record<string, { buffer: Buffer; filename: string; mime: string }> = {}
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer()
          arquivos[part.fieldname] = {
            buffer: buf,
            filename: part.filename || part.fieldname,
            mime: part.mimetype || "application/octet-stream",
          }
        } else {
          campos[part.fieldname] = String(part.value ?? "")
        }
      }
    } catch (e) {
      req.log.error(e, "erro parse multipart")
      return reply.code(400).send({ ok: false, erro: "multipart_invalido" })
    }

    const obrig = [
      "name",
      "empregado_nome",
      "escala",
      "solicitante",
      "contrato",
      "local_unidade",
      "sabado",
      "insalubridade",
      "interior",
      "data_inicio",
      "data_fim",
      "justificativa",
      "empregado_substituido",
    ]
    for (const k of obrig) {
      if (!campos[k]) return reply.code(400).send({ ok: false, erro: "campo_obrigatorio", campo: k })
    }
    const dataInicio = campos.data_inicio
    const dataFim = campos.data_fim
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      return reply.code(400).send({
        ok: false,
        erro: "data_invalida",
        mensagem: "Datas devem estar no formato YYYY-MM-DD.",
      })
    }
    if (dataInicio > dataFim) {
      return reply.code(400).send({
        ok: false,
        erro: "data_invalida",
        mensagem: "Data início > data fim.",
      })
    }
    const optanteVt = normalizeVtLabel(campos.optante_vt || campos.optanteVT || campos.vale_transporte)

    // papel/competência (seletor de mês). Default atual. "passado" = lançamento
    // retroativo no board do mês anterior (regra: SÓ o mês passado, nada antes).
    const papel = campos.papel === "proximo" ? "proximo"
      : campos.papel === "passado" ? "passado"
      : "atual"

    // IDEMPOTÊNCIA — chave sobre a INTENÇÃO (pessoa+período), não sobre o item.
    //
    // O furo que fecha é o duplo-clique: o form é multipart com upload, demora, e o operador
    // clica de novo. A antifraude não pega — ela pergunta ao Monday, e o item criado 300ms
    // antes ainda não está indexado. Dois itens = duas reservas da mesma dívida (o
    // uq_prepag_item_vivo não ajuda, porque cada item é "vivo" por conta própria).
    //
    // Chave por execucao_id não resolveria: cobre só o mesmo formulário; um retry com id novo
    // passa. Fica ANTES de abrirExecucao pra o 2º clique não escrever NADA no log do 1º.
    //
    // ⚠️ Cada clique tem execucao_id PRÓPRIO — `comAtividade` no front cunha um id novo por
    // chamada da mutation. A versão anterior deste comentário afirmava o contrário ("os dois
    // cliques compartilham o mesmo execucao_id") e por isso não fechava a execução do 2º
    // clique: sobrava uma linha `aberta`, sem fase nem artefato, ao lado da linha real.
    // Em 14/08 isso deu 4 linhas no /atividade para 2 convocações (MICHELE e MARCILENE) — e
    // fez o operador achar que uma delas não registrou. Fechar a do 2º clique é seguro
    // justamente porque o id é outro.
    const identidade = normCode(campos.empregado_chapa ?? "")
      || (campos.empregado_cpf ?? "").replace(/\D/g, "")
      || normName(campos.empregado_nome)
    const chaveIdem = `pontual:convocacao:${identidade}:${dataInicio}:${dataFim}`
    const estadoIdem = await reservarEfeito(chaveIdem, "convocacao_pontual", {
      chapa: campos.empregado_chapa ?? null, nome: campos.empregado_nome, papel,
    })
    /**
     * Fecha a execução DESTE clique (id próprio) como duplicata, pra ela não virar linha
     * fantasma `aberta` no /atividade. Best-effort: a resposta 409 é o que importa.
     */
    const fecharDuplicata = async (motivo: string): Promise<void> => {
      if (!campos.execucao_id) return
      try {
        const exDup = await abrirExecucao({
          id: campos.execucao_id,
          acao: "convocacao",
          motor: "backend",
          operador: { userId: usuario.id, email: usuario.email, nome: [usuario.nome, usuario.sobrenome].filter(Boolean).join(" ").trim() || usuario.email },
          pessoa: campos.empregado_nome,
          contrato: campos.contrato,
        })
        await exDup.etapa("idempotencia", "pulado", { mensagem: motivo })
        // `parcial`, não `erro`: nada quebrou — o clique anterior fez o trabalho. Marcar erro
        // acenderia alerta de WhatsApp para uma convocação que existe e está certa.
        await exDup.fechar("parcial", { resumo: { duplicata: motivo } })
      } catch (e) {
        req.log.warn(e, "fechar execucao duplicada falhou")
      }
    }

    if (estadoIdem === "pendente") {
      // 1ª chamada ainda em curso (ou morreu antes do create — o catch libera a chave; se
      // morreu SEM liberar, o retry destrava sozinho quando o operador reabrir o form, e o
      // caso é visível no /atividade).
      await fecharDuplicata("clique repetido: a 1ª chamada ainda está criando esta convocação")
      return reply.code(409).send({
        ok: false, erro: "convocacao_em_curso",
        mensagem: "Esta convocação já está sendo criada. Aguarde alguns segundos.",
      })
    }
    if (estadoIdem === "confirmado") {
      // Já criada antes — devolve o item existente em vez de erro seco: o front renderiza o
      // conflito com link, e o operador vê que o clique anterior funcionou.
      const ref = await query<{ ref_externa: string | null }>(
        `SELECT ref_externa FROM efeitos_externos WHERE chave = $1`, [chaveIdem],
      ).then((r) => r.rows[0]?.ref_externa ?? null).catch(() => null)
      const bIdem = await resolverBoard(papel).catch(() => null)
      await fecharDuplicata(
        ref ? `convocação já criada no item ${ref}` : "convocação já criada para esta pessoa neste período",
      )
      return reply.code(409).send({
        ok: false, erro: "convocacao_conflitante",
        mensagem: "Convocação já criada para esta pessoa neste período.",
        conflito: ref
          ? {
              item_id: ref,
              item_url: bIdem ? `https://contato-serv.monday.com/boards/${bIdem.boardId}/pulses/${ref}` : undefined,
              nome: campos.empregado_nome, chapa: campos.empregado_chapa,
              data_inicio: dataInicio, data_fim: dataFim,
            }
          : undefined,
      })
    }
    // Fora do try grande: entra na resposta mesmo se algo depois falhar.
    let rm: EstadoRmResposta = { estado: "nao_enfileirado", motivo: "nao_avaliado" }

    // Log de execução. Aberto DEPOIS da validação de payload (400 é erro de quem
    // chamou, não falha de automação) e ANTES de qualquer efeito — é o que faz a
    // convocação que quebra no meio deixar rastro em vez de sumir.
    //
    // `campos.execucao_id` vem do front, que já abriu a execução e cunhou o id; sem
    // ele nasce aqui. Em nenhum caso duas linhas são criadas (ON CONFLICT no id).
    const ex: Execucao = await abrirExecucao({
      id: campos.execucao_id || null,
      acao: "convocacao",
      motor: "backend",
      operador: {
        userId: usuario.id,
        email: usuario.email,
        nome: [usuario.nome, usuario.sobrenome].filter(Boolean).join(" ").trim() || usuario.email,
      },
      pessoa: campos.empregado_nome,
      contrato: campos.contrato,
      resumo: {
        chapa: campos.empregado_chapa || null,
        data_inicio: dataInicio,
        data_fim: dataFim,
        unidade: campos.local_unidade,
        papel,
        solicitante: campos.solicitante,
        optante_vt: optanteVt,
      },
    })

    const b = await resolverBoard(papel)
    if (!b) {
      await liberarEfeito(chaveIdem)
      await ex.fechar("erro", { erro: "board_nao_registrado", etapaErro: "resolver_board" })
      return reply.code(404).send({ ok: false, erro: "board_nao_registrado" })
    }
    const id = (nome: string) => b.idPorNome.get(nome)

    try {
      // ANTIFRAUDE: busca convocações da chapa no board, checa overlap de período efetivo.
      const temChapa = !!campos.empregado_chapa?.trim()
      const colIdentidade = temChapa ? id(COL.chapa) : id(COL.nomeEmpregado)
      const valorIdentidade = temChapa ? campos.empregado_chapa : campos.empregado_nome
      if (colIdentidade && valorIdentidade) {
        const existentes = await comEtapa(ex, "antifraude", () => acharItensPorColuna(
          b.boardId, colIdentidade, valorIdentidade,
          [id(COL.nomeEmpregado)!, id(COL.chapa)!, id(COL.dataInicio)!, id(COL.dataFim)!, id(COL.statusConvocacao)!, CANCEL_INICIO_ID].filter(Boolean) as string[],
          50,
        ))
        for (const it of existentes) {
          const m = new Map(it.column_values.map((c) => [c.id, c.text]))
          const atual = temChapa ? normCode(campos.empregado_chapa) : normName(campos.empregado_nome)
          const existente = temChapa
            ? normCode(String(m.get(id(COL.chapa) ?? "") ?? ""))
            : normName(String(m.get(id(COL.nomeEmpregado) ?? "") ?? it.name))
          if (!existente || existente !== atual) continue
          const statusConv = String(m.get(id(COL.statusConvocacao) ?? "") ?? "").toLowerCase()
          if (statusConv.includes("cancelada") && !statusConv.includes("parcial")) continue
          if (statusConv.includes("bloque")) continue
          const eIni = m.get(id(COL.dataInicio) ?? "") ?? ""
          let eFim = m.get(id(COL.dataFim) ?? "") ?? ""
          const cancelIni = m.get(CANCEL_INICIO_ID) ?? ""
          if (statusConv.includes("parcial") && cancelIni) {
            // fim efetivo = cancelamento_inicio - 1 dia
            const d = new Date(cancelIni + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1)
            eFim = d.toISOString().slice(0, 10)
          }
          if (eIni && eFim && overlap(dataInicio, dataFim, eIni, eFim)) {
            // Conflito é desfecho de NEGÓCIO, não crash: fecha 'recusado'. A convocação
            // não aconteceu (por isso não é 'ok'), mas nada quebrou — e 'erro' dispararia
            // o WhatsApp do grupo por comportamento correto da trava. `fechar` é
            // first-wins, então o 'ok' do fim do handler não sobrescreve isto.
            await liberarEfeito(chaveIdem)
            await ex.fechar("recusado", {
              erro: `convocacao_conflitante: item ${it.id} (${eIni} a ${eFim})`,
              etapaErro: "antifraude",
              resumo: {
                recusado: "convocacao_conflitante",
                item_conflitante: it.id,
                periodo_conflitante: `${eIni} a ${eFim}`,
              },
            })
            await ex.artefato({
              tipo: "monday_item",
              chave: it.id,
              rotulo: "Convocação conflitante",
              url: `https://contato-serv.monday.com/boards/${b.boardId}/pulses/${it.id}`,
            })
            return reply.code(409).send({
              ok: false, erro: "convocacao_conflitante",
              conflito: {
                item_id: it.id,
                item_url: `https://contato-serv.monday.com/boards/${b.boardId}/pulses/${it.id}`,
                nome: it.name, chapa: campos.empregado_chapa,
                data_inicio: eIni, data_fim: eFim, status_convocacao: statusConv,
                data_inicio_cancelamento: cancelIni || null,
              },
            })
          }
        }
      }

      // CREATE: monta column_values resolvendo cada campo por nome.
      const cv: Record<string, unknown> = {}
      const setTexto = (nome: string, val: string | undefined) => { const c = id(nome); if (c && val) cv[c] = val }
      const setStatus = (nome: string, label: string | undefined) => { const c = id(nome); if (c && label) cv[c] = { label } }
      const setDate = (nome: string, d: string | undefined) => { const c = id(nome); if (c && d) cv[c] = { date: d } }
      const setDropdown = (nome: string, label: string | undefined) => { const c = id(nome); if (c && label) cv[c] = { labels: [label] } }

      setDropdown(COL.nomeEmpregado, campos.empregado_nome)
      setTexto(COL.cpf, campos.empregado_cpf)
      setTexto(COL.chapa, campos.empregado_chapa)
      setTexto(COL.funcao, campos.empregado_funcao)
      // `DD/MM/YYYY`: a coluna é TEXT e o DP a preenche à mão em pt-BR desde sempre — o que a
      // automação escreve tem de ser indistinguível disso. Internamente tudo é ISO; a conversão
      // acontece aqui, na borda. (Quem lê depois — a convocação RM — usa `paraDataIso`, que
      // aceita os dois formatos, então nada quebra.)
      setTexto(COL.admissao, paraDataBr(campos.empregado_admissao) || campos.empregado_admissao)
      setTexto(COL.escala, campos.escala)
      setStatus(COL.solicitante, campos.solicitante)
      setStatus(COL.contrato, campos.contrato)
      setTexto(COL.localTexto, campos.local_unidade)
      setDropdown(COL.localDropdown, campos.local_unidade)
      setStatus(COL.sabado, campos.sabado)
      setStatus(COL.insalubridade, campos.insalubridade)
      setStatus(COL.interior, campos.interior)
      setStatus(COL.tipoConvocacao, "PONTUAL")
      setDate(COL.dataInicio, dataInicio)
      setDate(COL.dataFim, dataFim)
      setStatus(COL.justificativa, campos.justificativa)
      setTexto(COL.substituido, campos.empregado_substituido)
      setStatus(COL.statusConvocacao, "Válida")
      setStatus(COL.optanteVT, optanteVt)
      setStatus(COL.vtSoVolta, optanteVt === "SIM*" ? "SIM" : "NÃO")

      // PRÉ-PAGAMENTO (fase 1 da bifurcação). Calcula e devolve os 7 valores prontos, que
      // são fundidos no `cv` ANTES do create — o item nasce já calculado, e a felipeta só
      // paga. Nunca lança: falha volta em `motivoInvalido`, e convocar não pode ser
      // bloqueado por regra de valor ausente no board.
      //
      // ⚠️ `itemId: "novo"` porque o item ainda não existe. Nada no cálculo usa esse campo —
      // ele só viaja até o `planUpdate`, e o que importa dali são os valores.
      const prepag = config.pontualPrePagamentoHabilitado
        ? await comEtapa(ex, "pre_pagamento", () => calcularPrePagamentoConvocacao(
            {
              itemId: "novo",
              nome: campos.empregado_nome,
              chapa: campos.empregado_chapa ?? "",
              cpf: campos.empregado_cpf ?? "",
              contrato: campos.contrato,
              // A função importa: `resolverRegra` casa contrato+função no board de Valores
              // (é o que separa SEDUC ESCOLA de SEDUC INTERIOR).
              funcao: campos.empregado_funcao ?? "",
              interior: campos.interior ?? "NAO",
              inicio: dataInicio,
              fim: dataFim,
              trabalhaSabado: semAcento(String(campos.sabado ?? "")).trim().toUpperCase() === "SIM",
              optanteVT: optanteVt === "SIM" || optanteVt === "SIM*",
              vtSoVolta: optanteVt === "SIM*",
            },
            b.idPorNome,
          ))
        : null
      if (prepag?.motivoInvalido) {
        // 'aviso' e não 'erro': a convocação segue, e o motivo fica visível no log pra o DP
        // corrigir o board de Valores antes de a felipeta chegar.
        await ex.etapa("pre_pagamento", "aviso", { mensagem: prepag.motivoInvalido })
      }
      // Funde os valores calculados no payload do create. `Object.assign` e não spread pra
      // deixar explícito que o `cv` montado acima é a base e o cálculo só ACRESCENTA.
      if (prepag) Object.assign(cv, prepag.valoresColunas)

      const item = await comEtapa(ex, "criar_item_monday", () => createItem(
        b.boardId,
        campos.name || `INTERMITENTE - ${campos.empregado_nome}`,
        cv,
        b.grupoPontual,
      ))
      // Confirma a chave IMEDIATAMENTE: a partir daqui o item existe, e liberar a chave num
      // erro posterior seria convite pra duplicar. (`liberarEfeito` não deleta confirmado,
      // então o catch lá embaixo pode liberar sem medo — vira no-op neste ponto.)
      await confirmarEfeito(chaveIdem, item.id)
      // `uuid_alvo` de acao='convocacao' é o item_id do Monday — semântica que o
      // monitor de alteração de board depende (cascata resolverItemDoPlano). O front
      // pode ter aberto a execução antes de o item existir, então preenche aqui.
      await query(
        `UPDATE audit_lancamentos SET uuid_alvo = COALESCE(uuid_alvo, $2) WHERE id = $1`,
        [ex.id, item.id],
      ).catch((e) => req.log.warn(e, "gravar uuid_alvo da execucao falhou"))
      await ex.artefato({ tipo: "monday_item", chave: item.id, rotulo: "Item no Plano", url: item.url })

      // SNAPSHOT + RESERVA, e vêm ANTES do RM e do Drive de propósito.
      //
      // É a escrita mais barata (Postgres local, ms) e a única SEM rede de recuperação: o RM
      // tem `pi.jobs`, o Drive tem `ensurePath` idempotente, o snapshot não tem nada. Se a
      // função morrer no meio, o que sobra tem que ser o número que a felipeta vai pagar.
      //
      // E a RESERVA é o que tem corrida — duas convocações da mesma pessoa no mesmo minuto.
      // Tomá-la o quanto antes depois de o item existir é a diferença entre a corrida ser
      // vencida e ser empatada.
      let prepagId: string | null = null
      if (prepag) {
        const gravado = await comEtapa(ex, "reservar_prepagamento", () => reservarPrePagamento({
          itemOrigemId: item.id,
          mondayBoardId: b.boardId,
          chapa: campos.empregado_chapa ?? "",
          cpf: campos.empregado_cpf ?? null,
          nome: campos.empregado_nome,
          contrato: campos.contrato,
          // Seção da PESSOA vinda do RM (ex: 01.01.0085.01.0112); fallback = seção-base do
          // contrato. Sem isto a felipeta valida `codsecao_ausente` e recusa — foi a ausência
          // deste campo que produziu o pedido órfão da execução 157795 (MARIA AUGUSTA).
          codSecao: campos.empregado_secao?.trim() || codigoSecaoContrato(campos.contrato),
          dataInicio,
          dataFim,
          pessoa: prepag.pessoa,
          reservas: prepag.reservas,
          calculo: prepag.calculo,
          motivoInvalido: prepag.motivoInvalido ?? null,
        }))
        prepagId = gravado?.id ?? null
        if (gravado) {
          await ex.artefato({ tipo: "convocacao_uuid", chave: gravado.id, rotulo: "Pré-pagamento" })
          if (prepag.semSaldo) {
            // O FIFO consumiu o benefício inteiro. Registrado como aviso porque muda o que a
            // fase 2 faz: grava board e desconto, e NÃO chama Caju/RM.
            await ex.etapa("pre_pagamento", "aviso", {
              mensagem: "desconto consumiu o benefício inteiro — nada a pagar",
              metadados: { desconto_vr: prepag.pessoa?.descontoVR, desconto_vt: prepag.pessoa?.descontoVT },
            })
          }
        }
      }

      // Convocação no RM — enfileirada, nunca inline.
      //
      // Aqui e não antes: sem `item.id` não há a que amarrar o registro, e um `createItem` que
      // falhasse depois deixaria um evento eSocial S-2260 no RM sem contrapartida no board.
      // Aqui e não depois do Drive: `arquivarDrive` é awaited e custa segundos (6 níveis de
      // pasta, uploads, planilha) — se a função estourar ali, o que já foi persistido sobrevive,
      // e a linha em `pi.jobs` precisa estar entre esses "antes".
      //
      // try/catch PRÓPRIO: falhar aqui não pode virar 502. O item já existe no Monday; o
      // operador tentaria de novo e levaria 409 da própria antifraude.
      rm = await lancarConvocacaoRm({
        itemId: item.id,
        boardId: b.boardId,
        colCodRm: id(COL.codigoRm) ?? null,
        campos,
        dataInicio,
        dataFim,
        operador: usuario.email,
      }).catch((e) => {
        req.log.warn(e, "enfileirar convocacao RM falhou")
        return { estado: "nao_enfileirado" as const, motivo: (e as Error).message.slice(0, 120) }
      })

      // A fase do RM não é "ok ou erro": `conciliando` significa "pode ter gravado,
      // estamos lendo pra saber" e nunca pode ser apresentado como falha. Por isso a
      // fase é gravada à mão, com o estado escolhido por desfecho, em vez de sair de
      // um comEtapa que só conhece ok/erro.
      const estadoRm: EstadoEtapa =
        rm.estado === "gravado" ? "ok"
        : rm.estado === "invalido" ? "erro"
        : rm.estado === "coberto_por_ausencia" ? "pulado"
        : rm.estado === "desligado" || rm.estado === "sem_chapa" || rm.estado === "rm_nao_configurado" ? "pulado"
        : "aviso" // enfileirado | conciliando | nao_enfileirado — pendente, não falha
      await ex.etapa("convocacao_rm", estadoRm, {
        mensagem: "motivo" in rm ? rm.motivo : rm.estado,
        metadados: { estado: rm.estado, ...("job_id" in rm && rm.job_id ? { job_id: rm.job_id } : {}) },
      })
      for (const codigo of ("codigos" in rm ? rm.codigos ?? [] : [])) {
        await ex.artefato({ tipo: "rm_convocacao", chave: codigo, rotulo: "Convocação no RM" })
      }
      if ("job_id" in rm && rm.job_id) {
        // Amarra o job à execução: é o que faz o alerta de um job morto linkar pro log
        // desta convocação em vez de um uuid opaco de job.
        await ex.artefato({ tipo: "job", chave: rm.job_id, rotulo: "Fila do RM" })
        await query(`UPDATE jobs SET execucao_id = $2 WHERE id = $1`, [rm.job_id, ex.id])
          .catch((e) => req.log.warn(e, "amarrar job a execucao falhou"))
      }

      // UPLOAD termos (best-effort: não derruba a criação se falhar).
      const uploads: [string, string][] = [
        ["termo_convocacao", COL.termoConvocacao],
        ["termo_insalubridade", COL.termoInsalubridade],
      ]
      for (const [campo, colNome] of uploads) {
        const arq = arquivos[campo]
        const colId = id(colNome)
        if (arq && colId) {
          try {
            await uploadFileToColumn(item.id, colId, arq.buffer, arq.filename, arq.mime)
            await ex.artefato({ tipo: "monday_asset", chave: `${item.id}:${campo}`, rotulo: arq.filename })
          } catch (e) {
            req.log.warn(e, `upload ${campo} falhou`)
            // Upload é best-effort e não derruba a criação — mas some do log se não
            // for registrado, e "o termo não subiu" é justamente o tipo de coisa que
            // aparece depois como reclamação.
            await ex.etapa("upload_termo", "aviso", { mensagem: e as Error, metadados: { campo } })
          }
        }
      }

      const drive = await comEtapa(ex, "arquivar_drive", () => arquivarDrive({
        tipo: "convocacao",
        nome: campos.empregado_nome,
        chapa: campos.empregado_chapa,
        cpf: campos.empregado_cpf,
        contrato: campos.contrato,
        data_inicio: dataInicio,
        data_fim: dataFim,
        item_entrada_id: item.id,
        board_entrada_id: b.boardId,
        atualizar_monday: true,
        gerar_planilha_conferencia: true,
        // As três pastas (CAJU/CONFERENCIA/OUTROS) nascem AQUI, mesmo vazias. É a pasta que o DP
        // vai abrir pra soltar a nota de débito, e sob demanda ele encontrava só `CONFERENCIA`.
        garantir_subpastas: true,
        arquivos: uploads
          .map(([campo]) => arquivos[campo])
          .filter((a): a is { buffer: Buffer; filename: string; mime: string } => !!a),
      })).catch((e) => {
        // Segue best-effort: Drive fora do ar não invalida a convocação já criada.
        // O comEtapa acima já gravou a fase como 'erro' antes de re-lançar.
        req.log.warn(e, "drive convocacao falhou")
        return null
      })
      if (drive) {
        await ex.artefato({
          tipo: "drive_pasta",
          chave: drive.pasta_convocacao_drive_id,
          rotulo: "Pasta da convocação",
          url: drive.pasta_convocacao_drive_url,
        })
        // Anota a pasta no snapshot — é o "caminho completo e o link pra pegar no pagamento".
        // Segunda escrita, minúscula: se falhar, o board já tem o link e a fase 2 re-resolve
        // (idempotente); o custo é ~7 `findFolder` desperdiçados lá.
        if (prepagId) {
          await anotarPastaDrive(prepagId, {
            pastaPessoaId: drive.pasta_pessoa_drive_id,
            pastaConvocacaoId: drive.pasta_convocacao_drive_id,
            nome: drive.pasta_convocacao_nome,
            caminho: drive.pasta_caminho,
          })
        }
        if (drive.planilha) {
          await ex.artefato({
            tipo: "drive_arquivo",
            chave: drive.planilha.id,
            rotulo: drive.planilha.name,
            url: drive.planilha.url ?? null,
          })
        }
      }

      // 'parcial' e não 'ok' quando algo best-effort ficou pendente: a convocação
      // existe, mas o operador precisa saber que o Drive ou o RM não fecharam.
      const pendenteRm = rm.estado === "enfileirado" || rm.estado === "conciliando" || rm.estado === "nao_enfileirado"
      // `invalido` também fecha parcial: o item existe, mas sem número a felipeta vai ter que
      // recalcular — e isso precisa ficar visível, não escondido atrás de "ok".
      const prepagPendente = !!prepag && (!prepagId || !!prepag.motivoInvalido)
      await ex.fechar(!drive || pendenteRm || prepagPendente ? "parcial" : "ok")
      return {
        ok: true,
        item_id: item.id,
        item_url: item.url,
        rm,
        // O cálculo volta na resposta pra a tela de sucesso mostrar o que vai ser pago —
        // é o que substitui a conferência manual item a item que o DP faz hoje.
        prepagamento: prepag
          ? {
              estado: prepag.motivoInvalido ? "invalido" : prepagId ? "reservado" : "nao_gravado",
              motivo_invalido: prepag.motivoInvalido ?? null,
              sem_saldo: prepag.semSaldo,
              dias_vr: prepag.pessoa?.diasVR ?? null,
              dias_vt: prepag.pessoa?.diasVT ?? null,
              vr_dia: prepag.pessoa?.vrDia ?? null,
              vt_dia: prepag.pessoa?.vtDia ?? null,
              bruto_vr: prepag.pessoa?.brutoVR ?? null,
              bruto_vt: prepag.pessoa?.brutoVT ?? null,
              desconto_vr: prepag.pessoa?.descontoVR ?? null,
              desconto_vt: prepag.pessoa?.descontoVT ?? null,
              liquido_vr: prepag.pessoa?.liquidoVR ?? null,
              liquido_vt: prepag.pessoa?.liquidoVT ?? null,
              credito_vr: prepag.pessoa?.creditoVR ?? null,
              credito_vt: prepag.pessoa?.creditoVT ?? null,
              pix_vr: prepag.pessoa?.pixVR ?? null,
              pix_vt: prepag.pessoa?.pixVT ?? null,
              pasta_url: drive?.pasta_convocacao_drive_url ?? null,
            }
          : null,
      }
    } catch (e) {
      req.log.error(e, "erro criar convocacao")
      // Solta a chave de idempotência pro retry passar limpo. No-op se o item já foi criado
      // (chave confirmada) — nesse caso o retry toma 409 devolvendo o item, que é o certo.
      await liberarEfeito(chaveIdem).catch(() => {})
      await ex.fechar("erro", { erro: e })
      return reply.code(502).send({ ok: false, erro: "erro_monday" })
    }
  }
  app.post("/api/convocar/criar", criarConvocacaoHandler)
  app.post("/api/intermitente-convocar", criarConvocacaoHandler)
}
