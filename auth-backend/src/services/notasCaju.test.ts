// Builders do board "Notas e Relatórios Caju" — puros, sem banco nem Monday.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  NATUREZAS_NO_BOARD,
  linhasNotaDeRelatorio,
  montarNomeItemNota,
  montarValuesItemNota,
  tituloGrupoNotas,
  type ColunaRegistro,
  type LinhaNotaCaju,
} from "./notasCaju.js"
import type { DadosRelatorioPagamento } from "./relatorioPagamento.js"

// Registry como ele fica depois de POST /api/boards/registrar no board do Isaac.
// O board REAL (18426593215) depois de enxugado: 6 colunas de dado.
const COLUNAS: ColunaRegistro[] = [
  { nome: "Contrato", columnId: "dropdown_contr", tipo: "dropdown" },
  { nome: "Colaborador", columnId: "text_colab", tipo: "text" },
  { nome: "Data Início", columnId: "date_ini", tipo: "date" },
  { nome: "Resumo Caju", columnId: "link_resumo", tipo: "link" },
  { nome: "Nota de Débito", columnId: "link_nota", tipo: "link" },
  { nome: "Pasta Drive", columnId: "link_pasta", tipo: "link" },
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

test("nome do item: natureza, BENEFÍCIO, quem e data", () => {
  assert.equal(montarNomeItemNota(linha()), "CRÉDITO VR+VT - MARIA DA SILVA SAURO - 01/08/2026")
  // Mensal: pedido é do contrato, não de uma pessoa.
  assert.equal(
    montarNomeItemNota(linha({ natureza: "BOLETO", colaborador: null, origem: "MENSAL" })),
    "BOLETO VR+VT - SEMSA - 01/08/2026",
  )
})

test("benefício no nome distingue os dois pedidos do MESMO pagamento", () => {
  // Até 13/08 o crédito era um pedido POR benefício, e o mensal ainda é. Sem o benefício no
  // nome, as duas linhas ficam idênticas na lista (aconteceu com o LUAN em 14/08) — e as
  // colunas `Benefício`/`Valor` não existem mais pra desempatar.
  assert.equal(montarNomeItemNota(linha({ beneficio: "VR" })), "CRÉDITO VR - MARIA DA SILVA SAURO - 01/08/2026")
  assert.equal(montarNomeItemNota(linha({ beneficio: "VT" })), "CRÉDITO VT - MARIA DA SILVA SAURO - 01/08/2026")
  assert.notEqual(
    montarNomeItemNota(linha({ beneficio: "VR" })),
    montarNomeItemNota(linha({ beneficio: "VT" })),
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
  assert.equal(values.text_colab, "Maria da Silva Sauro")
  assert.deepEqual(values.dropdown_contr, { labels: ["SEMSA"] })
  assert.deepEqual(values.date_ini, { date: "2026-08-01" })
  assert.deepEqual(values.link_resumo, { url: "https://caju/cred", text: "Resumo" })
  assert.deepEqual(values.link_pasta, { url: "https://drive/pasta", text: "Pasta" })
})

test("o que saiu do board NÃO é escrito nem reclamado", () => {
  // Board enxuto (decisão do Isaac): pedido, natureza, benefício, valor, chapa, IDFINANC,
  // Solicitação, Relatório e Status não existem mais. Se o builder ainda os escrevesse, cada
  // pagamento acenderia "colunas ausentes no board" — a fadiga de alerta que já consertamos.
  const { values, faltando } = montarValuesItemNota(linha(), COLUNAS)
  assert.deepEqual(faltando, [], "nada pode entrar em faltando com o board enxuto")
  // 5 e não 6: sem `CAJU_NOTA_URL` configurada a linha não tem `notaUrl`, e célula vazia não é
  // escrita nem reclamada. Com a env no ar, viram 6.
  assert.equal(Object.keys(values).length, 5)
  const comNota = montarValuesItemNota(linha({ notaUrl: "https://caju/nota" }), COLUNAS)
  assert.equal(Object.keys(comNota.values).length, 6)
  assert.deepEqual(comNota.faltando, [])
})

test("campo vazio não vira célula (link vazio é ruído, não informação)", () => {
  const { values } = montarValuesItemNota(linha({ notaUrl: null, idfinanc: null, solicitacaoUrl: "" }), COLUNAS)
  assert.equal("link_nota" in values, false)
  assert.equal("text_idf" in values, false)
  assert.equal("link_sol" in values, false)
})

test("coluna com nome diferente do combinado é PULADA e reportada", () => {
  // Se "Nota de Débito" nascer como "Nota debito", o item ainda tem de nascer — o resto do
  // pagamento não pode morrer por causa de um acento.
  const semNota = COLUNAS.filter((c) => c.nome !== "Nota de Débito")
  const { values, faltando } = montarValuesItemNota(linha({ notaUrl: "https://caju/nota" }), semNota)
  assert.equal("link_nota" in values, false)
  assert.deepEqual(faltando, ["Nota de Débito"])
  assert.ok(Object.keys(values).length >= 4, "as outras colunas continuam preenchidas")
})

test("coluna ausente SEM conteúdo não entra em faltando", () => {
  const semColab = COLUNAS.filter((c) => c.nome !== "Colaborador")
  const { faltando } = montarValuesItemNota(linha({ colaborador: null }), semColab)
  assert.deepEqual(faltando, [])
})

test("tipo inesperado cai em texto em vez de recusar o JSON", () => {
  const comoTexto: ColunaRegistro[] = [{ nome: "Contrato", columnId: "text_contr", tipo: "text" }]
  const { values } = montarValuesItemNota(linha(), comoTexto)
  assert.equal(values.text_contr, "SEMSA")
})

test("nome de coluna casa ignorando acento e caixa", () => {
  const semAcento: ColunaRegistro[] = [
    { nome: "data inicio", columnId: "dt", tipo: "date" },
    { nome: "NOTA DE DEBITO", columnId: "ln", tipo: "link" },
  ]
  const { values } = montarValuesItemNota(linha({ notaUrl: "https://caju/nota" }), semAcento)
  assert.deepEqual(values.dt, { date: "2026-08-01" })
  assert.deepEqual(values.ln, { url: "https://caju/nota", text: "Nota de débito" })
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

test("board leva SÓ o crédito — boleto continua na Solicitação de Pagamento", () => {
  // Decisão do Isaac: duplicar o boleto num segundo board criaria duas listas de "pague isto".
  assert.deepEqual(NATUREZAS_NO_BOARD, ["CRÉDITO"])
  const linhas = linhasNotaDeRelatorio(dados)
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0]!.natureza, "CRÉDITO")
  assert.equal(linhas[0]!.orderId, "cred-vr")
})

test("o boleto entra quando pedido — mesmo builder, mesmo layout", () => {
  // É assim que a parte do boleto liga depois: sem segundo formato pra manter.
  const linhas = linhasNotaDeRelatorio(dados, { naturezas: ["CRÉDITO", "BOLETO"] })
  assert.deepEqual(linhas.map((l) => l.natureza), ["CRÉDITO", "BOLETO"])
})

test("uma linha por pedido, com pessoa/contrato/período do relatório", () => {
  const linhas = linhasNotaDeRelatorio(dados, {
    relatorioUrl: "https://drive/rel.pdf",
    naturezas: ["CRÉDITO", "BOLETO"],
  })
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
  const [credito, boleto] = linhasNotaDeRelatorio(dados, { naturezas: ["CRÉDITO", "BOLETO"] })
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
  assert.ok(linhas.length > 0)
  assert.equal(linhas[0]!.colaborador, null)
  assert.equal(linhas[0]!.chapa, null)
  assert.equal(linhas[0]!.origem, "MENSAL")
})

test("sem pedido nenhum (semSaldo) não gera linha", () => {
  assert.deepEqual(linhasNotaDeRelatorio({ ...dados, pedidos: [] }), [])
})
