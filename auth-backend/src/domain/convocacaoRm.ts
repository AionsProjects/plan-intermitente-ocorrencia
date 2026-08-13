// Convocação de intermitente no RM — builder puro do XML do DataServer `FopConvocacaoData`
// e as regras que cercam a gravação. SEM I/O: o executor (SaveRecord/ReadView) vive em
// services/convocacaoRm.ts, e este módulo é 100% testável sem RM e sem env.
//
// Schema levantado read-only em 2026-08-08 (GetSchema + ReadView + ReadRecord, coligada 3):
// docs/rm/FopConvocacaoData.md. O que os dados do DP mostraram e virou regra aqui:
//   - `INDLOCALPRESTACTRAB=0` em 1279/1279 -> sem bloco de endereço no XML;
//   - `ESTADOCONVOCACAO=4` (Concluída) é o estado que o DP usa e que ficou decidido para nós;
//   - `DTRESPOSTA` está preenchida em 3746/3746 -> sempre enviar (default = DTCONVOCACAO);
//   - a tabela filha `PFCONVOCACAOPFPERFF` NÃO aparece em nenhum registro do DP -> fora do v1;
//   - `DESCESTADOCONVOCACAO`/`DESCINDLOCALPRESTACTRAB` são derivados (só a view devolve) ->
//     mandar no save seria ruído.

export const RM_DATA_SERVER_CONVOCACAO = "FopConvocacaoData"
export const RM_COLIGADA_CONVOCACAO = 3

/** Situação da convocação. `4` = Concluída — decisão do DP (08/08/2026). */
export const ESTADO_CONVOCACAO_CONCLUIDA = 4

/**
 * O registro existente no RM conta como convocação VÁLIDA?
 *
 * Medido em produção (10/08/2026): o DP usa `4` = Concluída (1278×) e `3` = Em progresso (1×).
 * Qualquer outro estado (cancelada, recusada, o que for) NÃO vale como "já convocado" — mas
 * também não é regravado por cima em silêncio: vira `requer_decisao_dp` no mensal (decisão do
 * Isaac em 10/08). Erra pro lado que pergunta, nunca pro que esconde.
 */
export function estadoConvocacaoValido(estado: string | number | undefined | null): boolean {
  const e = String(estado ?? "").trim()
  return e === "3" || e === "4"
}
/** `0` = "No mesmo endereço do estabelecimento" — 100% da base do DP. */
export const LOCAL_PRESTACAO_MESMO_ESTABELECIMENTO = 0

/** Antecedência mínima da convocação (art. 452-A da CLT), em dias CORRIDOS. */
export const ANTECEDENCIA_MINIMA_DIAS = 3

/**
 * Espelho de `chapa6` de mensal/rmEfeitos.ts. Copiado de propósito: importar de lá arrastaria
 * `clients/rm.js` -> `config.ts`, e este módulo (e seus testes) precisa rodar sem env.
 */
export function chapaRm(chapa: string): string {
  return String(chapa || "").replace(/\D/g, "").padStart(6, "0")
}

const escapeXml = (s: string): string =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)

/** `YYYY-MM-DD` (aceita ISO com hora) -> Date em UTC. Evita o fuso mexer no dia. */
function diaUtc(iso: string): number {
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number)
  return Date.UTC(a, (m ?? 1) - 1, d ?? 1)
}

export function ehDataIso(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v) && !Number.isNaN(diaUtc(v))
}

/**
 * Normaliza data pra `YYYY-MM-DD`, aceitando também `DD/MM/YYYY`.
 *
 * O board mistura os dois: `OP - Data/Inicio` e `OP - Data/Fim` são colunas **date** (Monday
 * devolve ISO), mas `Admissão` é coluna **text** preenchida à mão em pt-BR. Tratar tudo como ISO
 * reprovava 13 de 13 pessoas do DETRAN com `data_admissao_invalida` — e, pior, se a admissão fosse
 * apenas ignorada, a regra dos 3 dias perderia o piso e a data do ato cairia antes da admissão.
 *
 * Devolve `""` no que não for data — quem chama decide se isso é erro.
 */
export function paraDataIso(v: unknown): string {
  const s = String(v ?? "").trim()
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return ""
}

/**
 * `DD/MM/YYYY` — o formato da coluna `Admissão` no board.
 *
 * Ela é **text**, e o DP a preenche à mão em pt-BR desde sempre; o que a automação escreve tem de
 * ser indistinguível disso, senão a coluna vira duas convenções misturadas e quem lê não sabe qual
 * é a certa. Internamente tudo continua ISO — a conversão acontece só na borda de escrita.
 *
 * Devolve `""` no que não for data, igual a `paraDataIso`.
 */
export function paraDataBr(v: unknown): string {
  const iso = paraDataIso(v)
  if (!iso) return ""
  const [ano, mes, dia] = iso.split("-")
  return `${dia}/${mes}/${ano}`
}

/** Formato dateTime que o RM devolve e aceita: `YYYY-MM-DDTHH:mm:ss` (sem fuso). */
export function dataHoraRm(iso: string, hora = "00:00:00"): string {
  const dia = String(iso).slice(0, 10)
  const horaVinda = /T(\d{2}:\d{2}:\d{2})/.exec(String(iso))?.[1]
  return `${dia}T${horaVinda ?? hora}`
}

export function diasCorridos(de: string, ate: string): number {
  return Math.round((diaUtc(ate) - diaUtc(de)) / 86_400_000)
}

/**
 * Antecedência da convocação. NÃO bloqueia: o próprio DP lança com menos de 3 dias
 * (643 de 3746 registros, sendo 514 no mesmo dia). Serve pra avisar, não pra impedir —
 * decidir por conta própria que a convocação do DP é ilegal seria passar por cima dele.
 */
export function antecedencia(p: { dataConvocacao: string; dataInicio: string }): {
  dias: number
  suficiente: boolean
} {
  const dias = diasCorridos(p.dataConvocacao, p.dataInicio)
  return { dias, suficiente: dias >= ANTECEDENCIA_MINIMA_DIAS }
}

export interface DataConvocacaoCalculada {
  data: string
  antecedenciaDias: number
  motivo: "informada" | "antecedencia_padrao" | "admissao_recente" | "sem_admissao"
  /** RM pede confirmação quando a antecedência fica abaixo de 3 dias corridos. */
  exigeConfirmacaoRm: boolean
  /** Admissão depois do início da prestação = dado inconsistente (board ou RM). */
  admissaoAposInicio: boolean
}

/**
 * Data do ATO de convocar (`DTCONVOCACAO`).
 *
 * Regra do DP: **3 dias corridos antes do início** da prestação — é o art. 452-A da CLT, e é o que
 * 2538 dos 3746 registros mostram. NÃO é "hoje": o DP data o documento pela regra, mesmo lançando
 * depois.
 *
 * Exceção da admissão: se a pessoa foi admitida a menos de 3 dias do início (mesmo dia, 1 ou 2
 * dias antes), 3-dias-antes cairia ANTES da admissão — no RM isso não existe. Nesses casos a data
 * do ato vira o **próprio início da prestação** (é o que produz os 514 registros com antecedência
 * zero). Aí o RM aceita, mas devolve uma mensagem de confirmação.
 */
export function calcularDataConvocacao(p: {
  dataInicio: string
  dataAdmissao?: string
  /** Override explícito — quem informa assume a data. */
  dataConvocacao?: string
}): DataConvocacaoCalculada {
  const inicio = paraDataIso(p.dataInicio)
  const admissao = paraDataIso(p.dataAdmissao)
  const admissaoAposInicio = !!admissao && diasCorridos(admissao, inicio) < 0

  const fechar = (data: string, motivo: DataConvocacaoCalculada["motivo"]): DataConvocacaoCalculada => {
    const dias = diasCorridos(data, inicio)
    return {
      data,
      antecedenciaDias: dias,
      motivo,
      exigeConfirmacaoRm: dias < ANTECEDENCIA_MINIMA_DIAS,
      admissaoAposInicio,
    }
  }

  if (p.dataConvocacao) return fechar(paraDataIso(p.dataConvocacao), "informada")

  const padrao = somarDias(inicio, -ANTECEDENCIA_MINIMA_DIAS)
  if (!admissao) return fechar(padrao, "sem_admissao")
  // Admitida a 0/1/2 dias do início: 3-dias-antes é anterior à admissão -> usa o próprio início.
  if (diasCorridos(admissao, padrao) < 0) return fechar(inicio, "admissao_recente")
  return fechar(padrao, "antecedencia_padrao")
}

/** Soma dias corridos a uma data `YYYY-MM-DD` (via UTC — o fuso não muda o dia). */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(diaUtc(iso) + dias * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Dia 5 do mês seguinte ao fim da prestação — padrão observado em 6/6 registros amostrados
 * via ReadRecord (`DTPREVPGTO`).
 *
 * ⚠️ Não é usado por default: como `DTPREVPGTO` não vem na view, não sabemos se o DP digita ou
 * se o RM deriva do período de folha no save. Enviar um valor que o RM ia calcular sozinho é
 * pior que omitir. Ligar só depois do teste de gravação.
 */
export function dataPrevistaPagamentoPadrao(dataFim: string): string {
  const [ano, mes] = String(dataFim).slice(0, 10).split("-").map(Number)
  const proxMes = mes === 12 ? 1 : mes + 1
  const proxAno = mes === 12 ? ano + 1 : ano
  return `${proxAno}-${String(proxMes).padStart(2, "0")}-05`
}

export interface ConvocacaoRmEntrada {
  chapa: string
  /** Início da prestação de serviço (`YYYY-MM-DD`) — `OP - Data/Inicio` do board Entrada. */
  dataInicio: string
  /** Fim da prestação (`YYYY-MM-DD`) — `OP - Data/Fim`. */
  dataFim: string
  /**
   * Admissão da pessoa (`Admissão` no board / `Data de Admissão` na BEN 2). Entra no cálculo da
   * data do ato: sem ela não há como saber se 3-dias-antes cai antes da admissão.
   */
  dataAdmissao?: string
  /** Override da data do ATO. Sem isso, `calcularDataConvocacao` decide (3 dias antes do início). */
  dataConvocacao?: string
  /** Default = `dataConvocacao` — estado 4 (Concluída) pressupõe já respondida. */
  dataResposta?: string
  /** Só enviar depois de provar que o RM não deriva. Ver `dataPrevistaPagamentoPadrao`. */
  dataPrevistaPagamento?: string
  /**
   * ⚠️ **O RM IGNORA este valor** (comprovado em 08/08/2026: enviei `ZZ-TESTE-AUTOMACAO-1` e ele
   * gravou `C03S003755`). O contador automático da coligada sempre vence.
   *
   * A tag, porém, **não pode faltar**: sem ela o SaveRecord estoura em `ReadRowPrimaryKey`
   * ("Column 'CODCONVOCACAO' does not belong to table PFCONVOCACAO") antes de persistir. Por isso
   * o default é mandar a tag VAZIA — ver `codigoVazioExplicito` em `montarConvocacaoRm`.
   *
   * Fica aqui só para o caso de o DP desligar o código automático no RM.
   */
  codConvocacao?: string
  coligada?: number
  estadoConvocacao?: number
}

export interface ConvocacaoRmMontada {
  chapa: string
  coligada: number
  codConvocacao: string
  dataInicio: string
  dataFim: string
  dataConvocacao: string
  dadosXml: string
  antecedenciaDias: number
  antecedenciaSuficiente: boolean
  /** Por que a data do ato ficou nesse valor — vai no relatório do lote. */
  motivoDataConvocacao: DataConvocacaoCalculada["motivo"]
  /** O RM vai devolver mensagem de confirmação neste registro. */
  exigeConfirmacaoRm: boolean
}

export function validarConvocacaoRm(e: ConvocacaoRmEntrada): string[] {
  const erros: string[] = []
  // Aceita ISO e DD/MM/YYYY — o board usa os dois (ver `paraDataIso`).
  const ini = paraDataIso(e.dataInicio)
  const fim = paraDataIso(e.dataFim)
  const adm = e.dataAdmissao === undefined ? undefined : paraDataIso(e.dataAdmissao)

  if (!chapaRm(e.chapa) || chapaRm(e.chapa) === "000000") erros.push("chapa_invalida")
  if (!ini) erros.push("data_inicio_invalida")
  if (!fim) erros.push("data_fim_invalida")
  if (ini && fim && diasCorridos(ini, fim) < 0) erros.push("periodo_invertido")
  if (e.dataConvocacao !== undefined && !paraDataIso(e.dataConvocacao)) erros.push("data_convocacao_invalida")
  if (e.dataResposta !== undefined && !paraDataIso(e.dataResposta)) erros.push("data_resposta_invalida")
  if (adm !== undefined && !adm) erros.push("data_admissao_invalida")
  // Convocar antes de admitir não existe no RM: é erro de dado, e gravar seria criar um S-2260
  // impossível. Falha alto pra pessoa aparecer no relatório do lote em vez de virar registro torto.
  if (adm && ini && diasCorridos(adm, ini) < 0) erros.push("admissao_apos_inicio")
  if (e.codConvocacao !== undefined && e.codConvocacao.length > 60) erros.push("cod_convocacao_longo")
  return erros
}

/**
 * XML do SaveRecord. Raiz = `FopConvocacao` (nome do dataset no XSD), tabela = `PFCONVOCACAO`.
 * Campos opcionais nulos ficam FORA (o RM também os omite na leitura; tag vazia em campo de data é
 * pedido de erro de conversão) — mas `CODCONVOCACAO` é exceção obrigatória, ver abaixo.
 *
 * `<CODCONVOCACAO></CODCONVOCACAO>` **vazia e sempre presente** é o formato certo, provado em
 * 08/08/2026 contra o RM: com a tag vazia o contador automático numerou (`C03S003754`); **sem** a
 * tag o SaveRecord estoura em `ReadRowPrimaryKey` ("Column 'CODCONVOCACAO' does not belong to
 * table PFCONVOCACAO") antes de persistir, porque o RM lê a PK de volta da linha enviada.
 *
 * @param opts.omitirCodigo só para diagnóstico — reproduz a falha acima. Nunca em produção.
 */
export function montarConvocacaoRm(
  e: ConvocacaoRmEntrada,
  opts: { omitirCodigo?: boolean } = {},
): ConvocacaoRmMontada {
  const erros = validarConvocacaoRm(e)
  if (erros.length) throw new Error(`convocacao_rm_invalida: ${erros.join(",")}`)

  const chapa = chapaRm(e.chapa)
  const coligada = e.coligada ?? RM_COLIGADA_CONVOCACAO
  const cod = (e.codConvocacao ?? "").trim()
  const ato = calcularDataConvocacao(e)
  const dataConvocacao = ato.data
  // 00:00:00 como o DP grava. Sem hora de "agora": a data do ato vem da regra (3 dias antes do
  // início), não do relógio — carimbar 14:32 num documento datado por regra seria invenção.
  const horaAto = "00:00:00"
  const dataResposta = e.dataResposta ?? dataConvocacao
  const estado = e.estadoConvocacao ?? ESTADO_CONVOCACAO_CONCLUIDA

  const linhas = [
    `    <CODCOLIGADA>${coligada}</CODCOLIGADA>`,
    `    <CHAPA>${escapeXml(chapa)}</CHAPA>`,
  ]
  if (!opts.omitirCodigo) linhas.push(`    <CODCONVOCACAO>${escapeXml(cod)}</CODCONVOCACAO>`)
  linhas.push(
    `    <DTCONVOCACAO>${dataHoraRm(dataConvocacao, horaAto)}</DTCONVOCACAO>`,
    `    <DTINIPRESTSERV>${dataHoraRm(e.dataInicio)}</DTINIPRESTSERV>`,
    `    <DTFIMPRESTSERV>${dataHoraRm(e.dataFim)}</DTFIMPRESTSERV>`,
    `    <INDLOCALPRESTACTRAB>${LOCAL_PRESTACAO_MESMO_ESTABELECIMENTO}</INDLOCALPRESTACTRAB>`,
    `    <ESTADOCONVOCACAO>${estado}</ESTADOCONVOCACAO>`,
    `    <DTRESPOSTA>${dataHoraRm(dataResposta, horaAto)}</DTRESPOSTA>`,
  )
  if (e.dataPrevistaPagamento) {
    linhas.push(`    <DTPREVPGTO>${dataHoraRm(e.dataPrevistaPagamento)}</DTPREVPGTO>`)
  }

  return {
    chapa,
    coligada,
    codConvocacao: cod,
    dataInicio: String(e.dataInicio).slice(0, 10),
    dataFim: String(e.dataFim).slice(0, 10),
    dataConvocacao,
    antecedenciaDias: ato.antecedenciaDias,
    antecedenciaSuficiente: !ato.exigeConfirmacaoRm,
    motivoDataConvocacao: ato.motivo,
    exigeConfirmacaoRm: ato.exigeConfirmacaoRm,
    dadosXml: `<FopConvocacao>\n  <PFCONVOCACAO>\n${linhas.join("\n")}\n  </PFCONVOCACAO>\n</FopConvocacao>`,
  }
}

/** PK composta pra ReadRecord/DeleteRecordByKey, na ordem do XSD. */
export function pkConvocacaoRm(p: { coligada?: number; chapa: string; codConvocacao: string }): string {
  return [p.coligada ?? RM_COLIGADA_CONVOCACAO, chapaRm(p.chapa), p.codConvocacao].join(";")
}

/**
 * Chave de idempotência do EFEITO EXTERNO — uma por CHAMADA ao RM, ancorada no id da linha de
 * `pi.convocacoes_rm` (uuid gerado por nós antes da chamada).
 *
 * A chave anterior era `convocacao_rm:<CONTRATO>:<chapa>:<dataInicio>` e QUEBRAVA: o pedaço 1 da
 * quebra por atestado e a parte1 da bifurcação herdam o início (e o contrato) do registro que
 * estão substituindo. A chave batia como `confirmado`, o pedaço era pulado em silêncio, e a
 * pessoa terminava com menos dias no eSocial — com o lote aparecendo verde.
 *
 * Regra que ficou: chave de idempotência é IMUTÁVEL e ÚNICA por chamada real. Chave montada de
 * atributos de negócio que podem legitimamente se repetir no tempo é armadilha. O de-dup DE
 * NEGÓCIO mudou de lugar: virou o índice parcial `uq_convocacoes_rm_vivo`, que pode ser liberado
 * quando o registro é legitimamente superado.
 */
export function chaveEfeitoConvocacaoRm(lancamentoId: string): string {
  return `convocacao_rm:${lancamentoId}`
}

/** Chave da REMOÇÃO. Namespace próprio: apagar é outro efeito, e re-executar não pode redisparar. */
export function chaveEfeitoRemocaoConvocacaoRm(lancamentoId: string): string {
  return `convocacao_rm_remover:${lancamentoId}`
}

/**
 * Chave da EDIÇÃO de período (cancelamento parcial encurta a data fim).
 *
 * Inclui o novo fim de propósito, e aqui isso é seguro — diferente da criação, onde chave
 * derivada de atributo de negócio quebrou. Editar duas vezes para o MESMO fim é idempotente por
 * natureza: o registro acaba igual. Chaves diferentes para fins diferentes é o comportamento
 * desejado — é outra operação.
 */
export function chaveEfeitoEdicaoConvocacaoRm(lancamentoId: string, novoFim: string): string {
  return `convocacao_rm_editar:${lancamentoId}:${novoFim}`
}

/**
 * XML de EDIÇÃO do fim da prestação — só a chave + o campo que muda.
 *
 * Mínimo de propósito. Medido em 2099 (11/08): o RM faz MERGE, não substituição — um SaveRecord
 * com `CODCONVOCACAO` preenchido e só `DTFIMPRESTSERV` preservou os outros 8 campos, incluindo
 * `DTCONVOCACAO` e `DTRESPOSTA`. Mandar o registro inteiro seria pior: reescreveria a data do
 * ato (o convite, que não mudou) e apagaria campos que não emitimos, como o `DTPREVPGTO` que
 * aparece nos registros lançados à mão pelo DP.
 */
export function montarEdicaoFimConvocacaoRm(p: {
  coligada?: number
  chapa: string
  codConvocacao: string
  dataFim: string
}): { dadosXml: string; dataFim: string } {
  const fim = paraDataIso(p.dataFim)
  if (!fim) throw new Error(`convocacao_rm_invalida: data_fim_invalida (${p.dataFim})`)
  if (!p.codConvocacao) throw new Error("convocacao_rm_invalida: codigo_ausente")
  const dadosXml = [
    "<FopConvocacao>",
    "  <PFCONVOCACAO>",
    `    <CODCOLIGADA>${p.coligada ?? RM_COLIGADA_CONVOCACAO}</CODCOLIGADA>`,
    `    <CHAPA>${chapaRm(p.chapa)}</CHAPA>`,
    `    <CODCONVOCACAO>${p.codConvocacao}</CODCONVOCACAO>`,
    `    <DTFIMPRESTSERV>${fim}T00:00:00</DTFIMPRESTSERV>`,
    "  </PFCONVOCACAO>",
    "</FopConvocacao>",
  ].join("\n")
  return { dadosXml, dataFim: fim }
}


// ---------------------------------------------------------------------------
// Pré-voo: o que já existe no RM.
// ---------------------------------------------------------------------------

export interface ConvocacaoExistenteRm {
  chapa: string
  codConvocacao: string
  dataConvocacao: string
  dataInicio: string
  dataFim: string
  estado: string
  estadoDescricao: string
}

/**
 * Lê o resultado do ReadView. Cuidado: o ReadView devolve só as colunas da VIEW
 * (sem DTPREVPGTO/CODHORARIO, com as duas DESC* derivadas) e vem HTML-escapado — quem chama
 * desescapa antes.
 */
export function parseConvocacoesReadView(xml: string): ConvocacaoExistenteRm[] {
  const campo = (bloco: string, tag: string): string =>
    (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(bloco) ?? [, ""])[1]!.trim()
  return [...String(xml).matchAll(/<PFCONVOCACAO>([\s\S]*?)<\/PFCONVOCACAO>/g)].map((m) => ({
    chapa: campo(m[1], "CHAPA"),
    codConvocacao: campo(m[1], "CODCONVOCACAO"),
    dataConvocacao: campo(m[1], "DTCONVOCACAO").slice(0, 10),
    dataInicio: campo(m[1], "DTINIPRESTSERV").slice(0, 10),
    dataFim: campo(m[1], "DTFIMPRESTSERV").slice(0, 10),
    estado: campo(m[1], "ESTADOCONVOCACAO"),
    estadoDescricao: campo(m[1], "DESCESTADOCONVOCACAO"),
  }))
}

export interface PeriodoConvocacao {
  inicio: string
  fim: string
}

/**
 * Quebra o período da convocação nos pedaços que sobram fora das ausências.
 *
 * Regra do DP: dia coberto por atestado não é pago, então não pode estar dentro de uma convocação.
 * Convocação 05→20 com atestado 10→11 vira DUAS convocações: 05→09 e 12→20.
 *
 * Casos que a regra tem que aguentar (todos com teste): ausência na ponta inicial (só encurta o
 * começo), na ponta final (só encurta o fim), cobrindo tudo (não sobra convocação nenhuma),
 * ausências grudadas/sobrepostas (não geram pedaço de 1 dia fantasma no meio) e ausência fora do
 * período (ignorada).
 *
 * PURA: quem descobre as ausências é outro problema — ver docs/rm/FopConvocacaoData.md.
 */
export function quebrarPeriodoPorAusencias(
  inicio: string,
  fim: string,
  ausencias: { inicio: string; fim: string }[],
): PeriodoConvocacao[] {
  const ini = paraDataIso(inicio)
  const end = paraDataIso(fim)
  if (!ini || !end || diasCorridos(ini, end) < 0) return []

  // Só as ausências que tocam o período, normalizadas e em ordem. Ordenar é o que permite varrer
  // uma vez; sem isso, ausência fora de ordem "reabriria" um trecho já cortado.
  const cortes = ausencias
    .map((a) => ({ inicio: paraDataIso(a.inicio), fim: paraDataIso(a.fim) }))
    .filter((a) => a.inicio && a.fim && diasCorridos(a.inicio, a.fim) >= 0)
    .filter((a) => periodosCruzam(a.inicio, a.fim, ini, end))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))

  const pedacos: PeriodoConvocacao[] = []
  let cursor = ini
  for (const c of cortes) {
    // Trecho livre antes da ausência. `< 0` cobre ausência que começa antes/no cursor.
    if (diasCorridos(cursor, c.inicio) > 0) {
      pedacos.push({ inicio: cursor, fim: somarDias(c.inicio, -1) })
    }
    const retoma = somarDias(c.fim, 1)
    // Ausências sobrepostas: o cursor nunca anda pra trás.
    if (diasCorridos(cursor, retoma) > 0) cursor = retoma
  }
  if (diasCorridos(cursor, end) >= 0) pedacos.push({ inicio: cursor, fim: end })
  return pedacos
}

/** Períodos [a1,a2] e [b1,b2] se cruzam (inclusive nas pontas). */
export function periodosCruzam(a1: string, a2: string, b1: string, b2: string): boolean {
  return diaUtc(a1) <= diaUtc(b2) && diaUtc(b1) <= diaUtc(a2)
}

/**
 * Convocação que já cobre o período desta pessoa. O DP lança na mão hoje: sem este pré-voo, o
 * lote por contrato duplica o que um humano gravou minutos antes — e duplicata de convocação é
 * evento eSocial S-2260 duplicado, não sujeira de tabela.
 */
export function convocacaoJaNoRm(
  existentes: ConvocacaoExistenteRm[],
  alvo: { chapa: string; dataInicio: string; dataFim: string },
): ConvocacaoExistenteRm | null {
  const chapa = chapaRm(alvo.chapa)
  return (
    existentes.find(
      (c) =>
        chapaRm(c.chapa) === chapa &&
        periodosCruzam(c.dataInicio, c.dataFim, alvo.dataInicio, alvo.dataFim),
    ) ?? null
  )
}

/**
 * Chapa aceitável no PRÉ-VOO: só dígitos (aceita espaço em volta).
 *
 * `chapaRm` é leniente de propósito — ela só tira ruído e zera à esquerda. No filtro isso é
 * perigoso: `"3330' OR 1=1 --"` viraria `333011`, que é a chapa de OUTRA pessoa. A consulta
 * voltaria vazia, o pré-voo diria "não existe" e a gravação duplicaria a convocação. Aqui a
 * entrada suja tem que falhar alto, não virar outra pessoa em silêncio.
 */
export function chapaAceitavelNoFiltro(chapa: string): boolean {
  return /^\d+$/.test(String(chapa ?? "").trim())
}

/**
 * Filtro SQL do ReadView pra janela de chapas/datas.
 *
 * O filtro entra CRU no XML do DataServer: as datas passam por validação e as chapas têm que ser
 * numéricas (ver `chapaAceitavelNoFiltro`) — nada aqui aceita string livre de fora.
 */
export function filtroReadViewConvocacao(p: {
  chapas: string[]
  dataInicio: string
  dataFim: string
  coligada?: number
}): string {
  if (!ehDataIso(p.dataInicio) || !ehDataIso(p.dataFim)) throw new Error("filtro_datas_invalidas")
  const suja = p.chapas.find((c) => !chapaAceitavelNoFiltro(c))
  if (suja !== undefined) throw new Error(`filtro_chapa_invalida: ${JSON.stringify(String(suja).slice(0, 40))}`)
  const chapas = [...new Set(p.chapas.map(chapaRm).filter((c) => c && c !== "000000"))]
  if (!chapas.length) throw new Error("filtro_sem_chapas")
  const lista = chapas.map((c) => `'${c}'`).join(",")
  // Overlap: início do que existe <= fim da janela E fim do que existe >= início da janela.
  return (
    `CODCOLIGADA=${p.coligada ?? RM_COLIGADA_CONVOCACAO}` +
    ` AND CHAPA IN (${lista})` +
    ` AND DTINIPRESTSERV <= '${String(p.dataFim).slice(0, 10)}'` +
    ` AND DTFIMPRESTSERV >= '${String(p.dataInicio).slice(0, 10)}'`
  )
}

/**
 * Fatia a lista de chapas: filtro do DataServer vai cru numa string, não convém esticar sem fim.
 *
 * Rejeita chapa não-numérica pelo mesmo motivo do filtro — e aqui é obrigatório: quem chama
 * normaliza ANTES de montar o filtro, então deixar passar sujo aqui esconderia o problema da
 * validação de lá (o filtro já receberia dígitos).
 */
export function lotesDeChapas(chapas: string[], tamanho = 100): string[][] {
  const suja = chapas.find((c) => !chapaAceitavelNoFiltro(c))
  if (suja !== undefined) throw new Error(`filtro_chapa_invalida: ${JSON.stringify(String(suja).slice(0, 40))}`)
  const limpas = [...new Set(chapas.map(chapaRm).filter((c) => c && c !== "000000"))]
  const out: string[][] = []
  for (let i = 0; i < limpas.length; i += tamanho) out.push(limpas.slice(i, i + tamanho))
  return out
}
