import { changeColumnValues, mondayGraphql, type ItemMonday } from "../monday.js"
import {
  ensureFolder,
  ensurePath,
  rootFolderId,
  sanitizeName,
  uploadBuffer,
  webViewUrl,
  type DriveFile,
} from "../clients/drive.js"
import { criarXlsx } from "../clients/xlsx.js"

const COL_LINK_PESSOA = "link_mm3tscvv"
const COL_ID_PESSOA = "text_mm3t9g0p"
const COL_LINK_CONVOCACAO = "link_mm3tzmz0"
const COL_ID_CONVOCACAO = "text_mm3t3fdq"
const COL_CONTROLE_LINK_ATESTADOS = "link_mm3k6ya3"
const COL_CONTROLE_LINK_ARQUIVO = "link_mm3k4xrp"
const COL_CONTROLE_ID_ARQUIVO = "text_mm3kyz27"
const COL_SOLICITACAO_LINK_CONVOCACAO = "link_mkref9et"
const BOARD_CONTROLE_ATESTADOS = "18298015951"
const BOARD_SOLICITACAO_PGTO = "18393673859"

const MESES = [
  "JANEIRO",
  "FEVEREIRO",
  "MARCO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
]

/**
 * Nome da pasta de contrato no Drive. Conferido contra a árvore REAL em 14/08 — não é palpite.
 *
 * `DETRAN` e `SEDUC SEDE` estavam SEM o prefixo numérico e isso já rachou produção: em
 * 12/08 21:12 o código criou `CONTATO/DETRAN` ao lado do `CONTATO/04 - DETRAN` que existe desde
 * março, e a convocação do HARLISSON foi para a pasta nova enquanto AMANDA, ANA CAROLINE e ALMIRA
 * ficaram na antiga. SEDUC SEDE tinha a mesma bomba armada, só não havia estourado.
 *
 * Contrato que não estiver aqui cai no nome normalizado (`URUGUAIANA`), que é o comportamento
 * antigo — e o mesmo risco. Quando algum deles virar contrato de intermitente, o nome tem de ser
 * conferido no Drive antes, não deduzido.
 */
const CONTRATO_DRIVE_MAP: Record<string, string> = {
  SEMSA: "85 - SEMSA",
  CETAM: "74 - CETAM",
  "TRE PB": "79 - TRE PB",
  "SEDUC SEDE": "10 - SEDUC SEDE",
  "SEDUC ESCOLA": "11.01 - SEDUC ESCOLA",
  "SEDUC INTERIOR": "11.02 - SEDUC INTERIOR",
  "BARCO CONTATO": "15 - BARCO CONTATO",
  DETRAN: "04 - DETRAN",
  ADMINISTRATIVO: "ADMINISTRATIVO",
}

/** Nome da pasta de contrato no Drive. Pura, pra ter teste — é onde o DETRAN rachou. */
export function nomePastaContrato(contrato: unknown): string {
  const norm = normDrive(contrato)
  return CONTRATO_DRIVE_MAP[norm] || norm
}

interface ArquivoEntrada {
  buffer: Buffer
  filename: string
  mime: string
  /**
   * Subpasta de destino DESTE arquivo (`caju_boleto`, `relatorio`, `termo`…). Ausente = usa o
   * `tipo` do input. É o que permite arquivar o pacote inteiro do pagamento numa só chamada.
   */
  tipo?: string
}

export interface ArquivarInput {
  tipo?: string
  nome: string
  chapa?: string
  cpf?: string
  contrato: string
  data_inicio: string
  data_fim?: string
  item_entrada_id?: string
  board_entrada_id?: string
  item_controle_id?: string
  item_solicitacao_id?: string
  board_solicitacao_id?: string
  gerar_planilha_conferencia?: boolean
  atualizar_monday?: boolean
  arquivos?: ArquivoEntrada[]
  /**
   * Segmento da NATUREZA na árvore do Drive: `ano/mês/CONTATO/<contrato>/<natureza>/<pessoa>`.
   *
   * Default é PONTUAL porque foi quem nasceu aqui, mas o mensal chama esta mesma função — e sem
   * este parâmetro os arquivos dele iam parar dentro de "INTERMITENTE - PONTUAL", misturados com
   * os do pontual.
   */
  natureza?: string
  /**
   * Pastas JÁ resolvidas (do pré-pagamento pontual, gravadas em `pi.pontual_prepagamento`).
   *
   * Quando vêm, `ensurePath` + `ensureFolder(periodo)` são PULADOS. Fecha duas coisas:
   *
   *  - custo: derivar a árvore são ~7 `findFolder` sequenciais por chamada, repetidos em
   *    cada upload da fase 2 (boleto, QR, comprovante);
   *  - correção: o nome da pasta é derivado das DATAS. Se o período mudou e a pasta foi
   *    renomeada no recálculo, derivar de novo pelas datas do board criaria uma SEGUNDA
   *    pasta e os arquivos do pagamento cairiam separados dos termos. Passar o id é o que
   *    torna isso impossível.
   *
   * ⚠️ As duas juntas ou nenhuma: as subpastas (`CAJU/BOLETOS`, `TERMOS`) penduram na
   * convocação, e `ATESTADOS` pendura na pessoa.
   */
  pastas_resolvidas?: { pastaPessoaId: string; pastaConvocacaoId: string }
  /**
   * Cria o nível do PERÍODO (`13 A 19 08 2026`) dentro da pasta do dono. Default `true`.
   *
   * O pontual precisa dele: a mesma pessoa tem várias convocações no mesmo mês, e sem o período
   * os pacotes se sobrescreveriam. O MENSAL passa `false` — lá o dono é o contrato, existe um
   * pagamento por competência, e a competência já está no `08 - AGOSTO` do caminho: o período
   * seria uma pasta a mais dizendo o que o avô já diz.
   */
  agrupar_por_periodo?: boolean
}

/** Natureza default — mantém intacto o caminho que o pontual já usa em produção. */
const NATUREZA_PADRAO = "INTERMITENTE - PONTUAL"

/**
 * TRÊS pastas dentro da pasta do período, e só três (pedido do Isaac, 13/08):
 *
 *   CAJU        — boleto (TXT + QR PNG) e o comprovante técnico
 *   CONFERENCIA — planilha de conferência
 *   OUTROS      — lado do CRÉDITO: nota de débito e Relatório-de-pedidos da Caju (subidos à mão),
 *                 o relatório da automação, e os termos de convocação/insalubridade
 *
 * Sem acento em `CONFERENCIA` de propósito: é o nome que já existe em produção, com a planilha
 * dentro. `findFolder` casa por nome EXATO — trocar por `CONFERÊNCIA` criaria uma segunda pasta
 * e racharia os arquivos entre as duas.
 *
 * O DEFAULT é OUTROS, não a raiz do período: `/convocar` manda `tipo: "convocacao"` nos termos, e
 * antes disso eles caíam soltos ao lado das pastas. Nada mais fica solto.
 */
const SUBPASTA_POR_TIPO: Record<string, string> = {
  caju_boleto: "CAJU",
  caju_comprovante: "CAJU",
  relatorio: "OUTROS",
  termo: "OUTROS",
  outro: "OUTROS",
  convocacao: "OUTROS",
}
const SUBPASTA_PADRAO = "OUTROS"
/** Onde a planilha de conferência é gerada. */
const SUBPASTA_CONFERENCIA = "CONFERENCIA"

/**
 * Subpasta do PERÍODO para um tipo de arquivo. `null` = não mora no período (só o atestado, que
 * pendura na pessoa). Exportada pura porque é a regra que o pedido do Isaac fixou — dentro de
 * `arquivarDrive`, que faz I/O, ela não teria teste.
 */
export function subpastaDoTipo(tipo: unknown): string | null {
  const t = normDrive(tipo || "convocacao").toLowerCase()
  if (t === "atestado") return null
  return SUBPASTA_POR_TIPO[t] ?? SUBPASTA_PADRAO
}

export interface ArquivarResultado {
  ok: true
  pasta_pessoa_drive_id: string
  pasta_pessoa_drive_url: string
  pasta_convocacao_drive_id: string
  pasta_convocacao_drive_url: string
  /**
   * Nome APLICADO na pasta do período ("01 A 05/08/2026") e o caminho completo resolvido.
   *
   * Guardados no snapshot do pré-pagamento pra o recálculo decidir "preciso renomear?" com
   * uma comparação de string, sem ida ao Drive. E o caminho é o único registro de QUAL
   * mapeamento de contrato/natureza foi aplicado — `CONTRATO_DRIVE_MAP` muda, e a pasta de
   * dezembro não pode ser reinterpretada com o mapa de março.
   */
  pasta_convocacao_nome: string
  pasta_caminho: string
  uploads: Array<{ id: string; name: string; url?: string }>
  planilha?: { id: string; name: string; url?: string }
}

function parseIso(iso: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = String(iso || "").slice(0, 10).split("-").map(Number)
  return { ano, mes, dia }
}

function normDrive(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

function mesNome(iso: string): string {
  const { mes } = parseIso(iso)
  return `${String(mes).padStart(2, "0")} - ${MESES[mes - 1] ?? "MES"}`
}

function periodoNome(di: string, df?: string): string {
  const ini = parseIso(di)
  const fim = parseIso(df || di)
  return `${String(ini.dia).padStart(2, "0")} A ${String(fim.dia || ini.dia).padStart(2, "0")}/${String(fim.mes || ini.mes).padStart(2, "0")}/${fim.ano || ini.ano}`
}

async function itemComBoard(itemId: string): Promise<(ItemMonday & { board?: { id: string } }) | null> {
  const d = await mondayGraphql<{ items: Array<ItemMonday & { board?: { id: string } }> }>(
    `query($ids:[ID!]){ items(ids:$ids){ id name board{ id } column_values{ id text value column{ title type } } } }`,
    { ids: [itemId] },
  )
  return d.items?.[0] ?? null
}

function linhasItem(item: ItemMonday): unknown[][] {
  const rows: unknown[][] = [
    ["Item", item.name],
    ["Item ID", item.id],
    [],
    ["Coluna", "Texto", "Valor bruto"],
  ]
  for (const c of item.column_values as Array<{ id: string; text: string | null; value: string | null; column?: { title?: string } }>) {
    rows.push([c.column?.title || c.id, c.text ?? "", c.value ?? ""])
  }
  return rows
}

export async function gerarPlanilhaConferencia(input: {
  item_entrada_id: string
  pasta_convocacao_drive_id: string
}): Promise<DriveFile> {
  const item = await itemComBoard(input.item_entrada_id)
  if (!item) throw new Error("item_entrada_nao_encontrado")
  const xlsx = criarXlsx(linhasItem(item))
  const nome = `conferencia-${item.id}.xlsx`
  return uploadBuffer(
    input.pasta_convocacao_drive_id,
    nome,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsx,
  )
}

export async function arquivarDrive(input: ArquivarInput): Promise<ArquivarResultado> {
  if (!input.nome || !input.contrato || !input.data_inicio) {
    throw new Error("payload_drive_incompleto")
  }

  const root = rootFolderId()
  const dt = parseIso(input.data_inicio)
  if (!dt.ano || !dt.mes || !dt.dia) throw new Error("payload_drive_data_invalida")

  const ano = input.data_inicio.slice(0, 4)
  const mes = mesNome(input.data_inicio)
  const contrato = nomePastaContrato(input.contrato)
  const pessoa = normDrive(input.nome)
  const periodo = sanitizeName(periodoNome(input.data_inicio, input.data_fim))
  const tipo = normDrive(input.tipo || "convocacao").toLowerCase()

  const natureza = sanitizeName(input.natureza || NATUREZA_PADRAO)
  // Pastas já resolvidas pelo pré-pagamento: usa os ids e pula as ~7 idas ao Drive. O nome
  // fica só pra url de fallback — a real vem do `webViewLink` quando o Drive devolve.
  const reaproveita = input.pastas_resolvidas
  const comPeriodo = input.agrupar_por_periodo !== false
  const pastaPessoa: DriveFile = reaproveita
    ? { id: reaproveita.pastaPessoaId, name: pessoa }
    : await ensurePath(root, [ano, mes, "CONTATO", contrato, natureza, pessoa])
  // Sem período, as três pastas penduram direto no dono (o contrato, no caso do mensal).
  const pastaConvocacao: DriveFile = reaproveita
    ? { id: reaproveita.pastaConvocacaoId, name: comPeriodo ? periodo : pessoa }
    : comPeriodo
      ? await ensureFolder(pastaPessoa.id, periodo)
      : pastaPessoa

  /**
   * Subpasta de destino por tipo, com cache.
   *
   * Cada `ensureFolder` é uma ida ao Drive (find, e create se faltar). Sem o cache, um pacote com
   * boleto TXT + dois QR PNG resolveria `CAJU` três vezes na mesma chamada.
   */
  const cacheSub = new Map<string, DriveFile>()
  let pastaAtestados: DriveFile | undefined
  const subpastaDe = async (t: string): Promise<DriveFile> => {
    const cache = cacheSub.get(t)
    if (cache) return cache
    const nome = subpastaDoTipo(t)
    let destino: DriveFile
    if (nome === null) {
      // ATESTADOS pendura na PESSOA, não na convocação: um atestado cobre dias, não um período de
      // convocação específico. Único destino fora das três pastas do período.
      pastaAtestados = await ensureFolder(pastaPessoa.id, "ATESTADOS")
      destino = pastaAtestados
    } else {
      destino = await ensureFolder(pastaConvocacao.id, nome)
    }
    cacheSub.set(t, destino)
    return destino
  }

  // O `tipo` de cada ARQUIVO manda; o do input é o default.
  //
  // Antes só existia o tipo do input, então arquivar boleto + comprovante + relatório do mesmo
  // pagamento exigia TRÊS chamadas a esta função — e no mensal, que não tem `pastas_resolvidas`,
  // cada uma redescobria a árvore inteira (~7 idas ao Drive) e reescrevia as MESMAS 4 colunas do
  // Monday. Uma chamada com os arquivos etiquetados resolve o caminho uma vez.
  const uploads = []
  for (const arq of input.arquivos ?? []) {
    const destino = await subpastaDe(normDrive(arq.tipo ?? input.tipo ?? "convocacao").toLowerCase())
    uploads.push(await uploadBuffer(destino.id, arq.filename, arq.mime, arq.buffer))
  }
  // Atestado sem arquivo (ou com tipo só no input) ainda precisa da pasta pro eco no Monday.
  if (tipo === "atestado" && !pastaAtestados) await subpastaDe("atestado")

  let planilha: DriveFile | undefined
  if (input.gerar_planilha_conferencia && input.item_entrada_id) {
    const conf = await ensureFolder(pastaConvocacao.id, SUBPASTA_CONFERENCIA)
    planilha = await gerarPlanilhaConferencia({
      item_entrada_id: input.item_entrada_id,
      pasta_convocacao_drive_id: conf.id,
    })
  }

  const pastaPessoaUrl = pastaPessoa.webViewLink || webViewUrl(pastaPessoa.id)
  const pastaConvUrl = pastaConvocacao.webViewLink || webViewUrl(pastaConvocacao.id)

  if (input.atualizar_monday && input.item_entrada_id && input.board_entrada_id) {
    await changeColumnValues(input.board_entrada_id, input.item_entrada_id, {
      [COL_LINK_PESSOA]: { url: pastaPessoaUrl, text: "Pasta pessoa" },
      [COL_ID_PESSOA]: pastaPessoa.id,
      [COL_LINK_CONVOCACAO]: { url: pastaConvUrl, text: "Pasta convocacao" },
      [COL_ID_CONVOCACAO]: pastaConvocacao.id,
    }).catch(() => undefined)
  }

  if (input.atualizar_monday && input.item_controle_id && tipo === "atestado" && pastaAtestados) {
    const arquivo = uploads[0]
    await changeColumnValues(BOARD_CONTROLE_ATESTADOS, input.item_controle_id, {
      [COL_CONTROLE_LINK_ATESTADOS]: { url: pastaAtestados.webViewLink || webViewUrl(pastaAtestados.id), text: "Pasta ATESTADOS" },
      ...(arquivo?.webViewLink ? { [COL_CONTROLE_LINK_ARQUIVO]: { url: arquivo.webViewLink, text: "Arquivo Drive" } } : {}),
      ...(arquivo?.id ? { [COL_CONTROLE_ID_ARQUIVO]: arquivo.id } : {}),
    }).catch(() => undefined)
  }

  if (input.atualizar_monday && input.item_solicitacao_id) {
    await changeColumnValues(input.board_solicitacao_id || BOARD_SOLICITACAO_PGTO, input.item_solicitacao_id, {
      [COL_SOLICITACAO_LINK_CONVOCACAO]: { url: pastaConvUrl, text: "Pasta convocacao" },
    }).catch(() => undefined)
  }

  return {
    ok: true,
    pasta_pessoa_drive_id: pastaPessoa.id,
    pasta_pessoa_drive_url: pastaPessoaUrl,
    pasta_convocacao_drive_id: pastaConvocacao.id,
    pasta_convocacao_drive_url: pastaConvUrl,
    pasta_convocacao_nome: comPeriodo ? periodo : pessoa,
    pasta_caminho: [ano, mes, "CONTATO", contrato, natureza, pessoa, ...(comPeriodo ? [periodo] : [])].join("/"),
    uploads: uploads.map((u) => ({ id: u.id, name: u.name, url: u.webViewLink })),
    planilha: planilha ? { id: planilha.id, name: planilha.name, url: planilha.webViewLink } : undefined,
  }
}
