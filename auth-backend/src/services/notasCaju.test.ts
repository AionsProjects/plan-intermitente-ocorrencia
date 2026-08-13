// Builders do board "Notas e Relatórios Caju" — puros, sem banco nem Monday.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  linhasNotaDeRelatorio,
  montarNomeItemNota,
  montarValuesItemNota,
  tituloGrupoNotas,
  type ColunaRegistro,
  type LinhaNotaCaju,
} from "./notasCaju.js"
import type { DadosRelatorioPagamento } from "./relatorioPagamento.js"

// Registry como ele fica depois de POST /api/boards/registrar no board do Isaac.
const COLUNAS: ColunaRegistro[] = [
  { nome: "Pedido Caju", columnId: "text_pedido", tipo: "text" },
  { nome: "Natureza", columnId: "color_nat", tipo: "status" },
  { nome: "Benefício", columnId: "dropdown_ben", tipo: "dropdown" },
  { nome: "Origem", columnId: "color_orig", tipo: "status" },
  { nome: "Contrato", columnId: "dropdown_contr", tipo: "dropdown" },
  { nome: "Colaborador", columnId: "text_colab", tipo: "text" },
  { nome: "Chapa", columnId: "text_chapa", tipo: "text" },
  { nome: "Data Início", columnId: "date_ini", tipo: "date" },
  { nome: "Data Fim", columnId: "date_fim", tipo: "date" },
  { nome: "Valor", columnId: "numeric_valor", tipo: "numbers" },
  { nome: "Resumo Caju", columnId: "link_resumo", tipo: "link" },
  { nome: "Nota de Débito", columnId: "link_nota", tipo: "link" },
  { nome: "Relatório", columnId: "link_rel", tipo: "link" },
  { nome: "Pasta Drive", columnId: "link_pasta", tipo: "link" },
  { nome: "IDFINANC", columnId: "text_idf", tipo: "text" },
  { nome: "Solicitação", columnId: "link_sol", tipo: "link" },
  { nome: "Status", columnId: "color_status", tipo: "status" },
]

const linha = (over: Partial<LinhaNotaCaju> = {}): LinhaNotaCaju => ({
  natureza: "CRÉDITO",
  beneficio: "VR + VT",
  orderId: "4ad29f2f-cred",
  valor: 69,
  origem: "PONTUAL",
  contrato: "SEMSA",
  colaborador: "Maria da Silva Sauro",
  chapa: "007104",
  dataInicio: "2026-08-01",
  dataFim: "2026-08-05",
  resumoUrl: "https://caju/cred",
  pastaDriveUrl: "https://drive/pasta",
  relatorioUrl: "https://drive/relatorio.pdf",
  ...over,
})

test("nome do item: natureza, quem e data", () => {
  assert.equal(montarNomeItemNota(linha()), "CRÉDITO - MARIA DA SILVA SAURO - 01/08/2026")
  // Mensal: pedido é do contrato, não de uma pessoa.
  assert.equal(
    montarNomeItemNota(linha({ natureza: "BOLETO", colaborador: null, origem: "MENSAL" })),
    "BOLETO - SEMSA - 01/08/2026",
  )
})

test("gaveta é o mês de caixa no formato da Solicitação", () => {
  assert.equal(tituloGrupoNotas("2026-08-01"), "AGOSTO/26")
  assert.equal(tituloGrupoNotas("2026-01-31"), "JANEIRO/26")
  assert.equal(tituloGrupoNotas(""), "SEM DATA")
})

test("cada tipo de coluna ganha o formato que o Monday espera", () => {
  const { values, faltando } = montarValuesItemNota(linha(), COLUNAS)
  assert.deepEqual(faltando, [])
  assert.equal(values.text_pedido, "4ad29f2f-cred")
  assert.deepEqual(values.color_nat, { label: "CRÉDITO" })
  // "VR + VT" em dropdown são DUAS labels — é o que deixa filtrar por benefício.
  assert.deepEqual(values.dropdown_ben, { labels: ["VR", "VT"] })
  assert.deepEqual(values.dropdown_contr, { labels: ["SEMSA"] })
  assert.deepEqual(values.date_ini, { date: "2026-08-01" })
  assert.equal(values.numeric_valor, "69")
  assert.deepEqual(values.link_resumo, { url: "https://caju/cred", text: "Resumo" })
  assert.deepEqual(values.link_rel, { url: "https://drive/relatorio.pdf", text: "Relatório" })
  assert.deepEqual(values.color_status, { label: "GERADO" })
})

test("campo vazio não vira célula (link vazio é ruído, não informação)", () => {
  const { values } = montarValuesItemNota(linha({ notaUrl: null, idfinanc: null, solicitacaoUrl: "" }), COLUNAS)
  assert.equal("link_nota" in values, false)
  assert.equal("text_idf" in values, false)
  assert.equal("link_sol" in values, false)
})

test("coluna com nome diferente do combinado é PULADA e reportada", () => {
  // O board é do Isaac. Se "Nota de Débito" nascer como "Nota debito", o item ainda tem de
  // nascer — o resto do pagamento não pode morrer por causa de um acento.
  const semNota = COLUNAS.filter((c) => c.nome !== "Nota de Débito")
  const { values, faltando } = montarValuesItemNota(linha({ notaUrl: "https://caju/nota" }), semNota)
  assert.equal("link_nota" in values, false)
  assert.deepEqual(faltando, ["Nota de Débito"])
  assert.ok(Object.keys(values).length > 10, "as outras colunas continuam preenchidas")
})

test("coluna ausente SEM conteúdo não entra em faltando", () => {
  const semColab = COLUNAS.filter((c) => c.nome !== "Colaborador")
  const { faltando } = montarValuesItemNota(linha({ colaborador: null }), semColab)
  assert.deepEqual(faltando, [])
})

test("tipo inesperado cai em texto em vez de recusar o JSON", () => {
  const comoTexto: ColunaRegistro[] = [{ nome: "Natureza", columnId: "text_nat", tipo: "text" }]
  const { values } = montarValuesItemNota(linha(), comoTexto)
  assert.equal(values.text_nat, "CRÉDITO")
})

test("nome de coluna casa ignorando acento e caixa", () => {
  const semAcento: ColunaRegistro[] = [
    { nome: "BENEFICIO", columnId: "dd", tipo: "dropdown" },
    { nome: "data inicio", columnId: "dt", tipo: "date" },
  ]
  const { values } = montarValuesItemNota(linha(), semAcento)
  assert.deepEqual(values.dd, { labels: ["VR", "VT"] })
  assert.deepEqual(values.dt, { date: "2026-08-01" })
})

// ---------------------------------------------------------------------------
// linhasNotaDeRelatorio — o PDF e as linhas do board contam a mesma história
// ---------------------------------------------------------------------------

const dados: DadosRelatorioPagamento = {
  origem: "PONTUAL",
  contrato: "SEDUC INTERIOR",
  periodoLabel: "13/08/2026 a 19/08/2026",
  dataInicio: "2026-08-13",
  dataFim: "2026-08-19",
  pessoas: [{ nome: "LUAN VICTOR", chapa: "007104", cpf: null, liquidoVR: 122.5, liquidoVT: 50 }],
  pedidos: [
    { natureza: "CRÉDITO", beneficio: "VR", orderId: "cred-vr", valor: 49, resumoUrl: "https://caju/1" },
    { natureza: "BOLETO", beneficio: "VR", orderId: "pix-vr", valor: 73.5, resumoUrl: "https://caju/2" },
  ],
  idfinancVR: "24278",
  idfinancVT: "24279",
  solicitacaoUrl: "https://monday/sol",
  pastaDriveUrl: "https://drive/pasta",
  dividas: [],
  geradoPor: "automação",
  geradoEm: new Date("2026-08-13T18:00:00Z"),
}

test("uma linha por pedido, com pessoa/contrato/período do relatório", () => {
  const linhas = linhasNotaDeRelatorio(dados, { relatorioUrl: "https://drive/rel.pdf" })
  assert.equal(linhas.length, 2)
  assert.equal(linhas[0]!.colaborador, "LUAN VICTOR")
  assert.equal(linhas[0]!.chapa, "007104")
  assert.equal(linhas[0]!.dataInicio, "2026-08-13")
  assert.equal(linhas[0]!.relatorioUrl, "https://drive/rel.pdf")
  assert.equal(linhas[0]!.pastaDriveUrl, "https://drive/pasta")
})

test("IDFINANC e Solicitação só na linha do BOLETO", () => {
  // O lançamento financeiro no RM existe pro boleto. Repetir na linha do crédito faria parecer
  // que o crédito gerou financeiro — exatamente o que a ordem dos steps do RM evita.
  const [credito, boleto] = linhasNotaDeRelatorio(dados)
  assert.equal(credito!.idfinanc, null)
  assert.equal(credito!.solicitacaoUrl, null)
  assert.equal(boleto!.idfinanc, "VR 24278; VT 24279")
  assert.equal(boleto!.solicitacaoUrl, "https://monday/sol")
})

test("mensal (N pessoas) não põe colaborador na linha", () => {
  const linhas = linhasNotaDeRelatorio({
    ...dados,
    origem: "MENSAL",
    pessoas: [{ nome: "A" }, { nome: "B" }],
  })
  assert.equal(linhas[0]!.colaborador, null)
  assert.equal(linhas[0]!.chapa, null)
  assert.equal(linhas[0]!.origem, "MENSAL")
})

test("sem pedido nenhum (semSaldo) não gera linha", () => {
  assert.deepEqual(linhasNotaDeRelatorio({ ...dados, pedidos: [] }), [])
})
