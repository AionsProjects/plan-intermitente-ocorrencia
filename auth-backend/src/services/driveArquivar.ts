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

const CONTRATO_DRIVE_MAP: Record<string, string> = {
  SEMSA: "85 - SEMSA",
  CETAM: "74 - CETAM",
  "TRE PB": "79 - TRE PB",
  "SEDUC SEDE": "SEDUC SEDE",
  "SEDUC ESCOLA": "11.01 - SEDUC ESCOLA",
  "SEDUC INTERIOR": "11.02 - SEDUC INTERIOR",
  "BARCO CONTATO": "15 - BARCO CONTATO",
  DETRAN: "DETRAN",
  ADMINISTRATIVO: "ADMINISTRATIVO",
}

interface ArquivoEntrada {
  buffer: Buffer
  filename: string
  mime: string
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
}

/** Natureza default — mantém intacto o caminho que o pontual já usa em produção. */
const NATUREZA_PADRAO = "INTERMITENTE - PONTUAL"

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
  const contratoNorm = normDrive(input.contrato)
  const contrato = CONTRATO_DRIVE_MAP[contratoNorm] || contratoNorm
  const pessoa = normDrive(input.nome)
  const periodo = sanitizeName(periodoNome(input.data_inicio, input.data_fim))
  const tipo = normDrive(input.tipo || "convocacao").toLowerCase()

  const natureza = sanitizeName(input.natureza || NATUREZA_PADRAO)
  // Pastas já resolvidas pelo pré-pagamento: usa os ids e pula as ~7 idas ao Drive. O nome
  // fica só pra url de fallback — a real vem do `webViewLink` quando o Drive devolve.
  const reaproveita = input.pastas_resolvidas
  const pastaPessoa: DriveFile = reaproveita
    ? { id: reaproveita.pastaPessoaId, name: pessoa }
    : await ensurePath(root, [ano, mes, "CONTATO", contrato, natureza, pessoa])
  const pastaConvocacao: DriveFile = reaproveita
    ? { id: reaproveita.pastaConvocacaoId, name: periodo }
    : await ensureFolder(pastaPessoa.id, periodo)

  let pastaUpload = pastaConvocacao
  let pastaAtestados: DriveFile | undefined
  if (tipo === "atestado") {
    pastaAtestados = await ensureFolder(pastaPessoa.id, "ATESTADOS")
    pastaUpload = pastaAtestados
  } else if (tipo === "caju_boleto") {
    const caju = await ensureFolder(pastaConvocacao.id, "CAJU")
    pastaUpload = await ensureFolder(caju.id, "BOLETOS")
  } else if (tipo === "caju_comprovante") {
    const caju = await ensureFolder(pastaConvocacao.id, "CAJU")
    pastaUpload = await ensureFolder(caju.id, "COMPROVANTES")
  } else if (tipo === "termo") {
    pastaUpload = await ensureFolder(pastaConvocacao.id, "TERMOS")
  } else if (tipo === "outro") {
    pastaUpload = await ensureFolder(pastaConvocacao.id, "OUTROS")
  }

  const uploads = []
  for (const arq of input.arquivos ?? []) {
    uploads.push(await uploadBuffer(pastaUpload.id, arq.filename, arq.mime, arq.buffer))
  }

  let planilha: DriveFile | undefined
  if (input.gerar_planilha_conferencia && input.item_entrada_id) {
    const conf = await ensureFolder(pastaConvocacao.id, "CONFERENCIA")
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
    pasta_convocacao_nome: periodo,
    pasta_caminho: [ano, mes, "CONTATO", contrato, natureza, pessoa, periodo].join("/"),
    uploads: uploads.map((u) => ({ id: u.id, name: u.name, url: u.webViewLink })),
    planilha: planilha ? { id: planilha.id, name: planilha.name, url: planilha.webViewLink } : undefined,
  }
}
