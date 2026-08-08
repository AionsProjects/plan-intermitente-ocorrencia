import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ANTECEDENCIA_MINIMA_DIAS,
  antecedencia,
  calcularDataConvocacao,
  chapaAceitavelNoFiltro,
  chapaRm,
  chaveEfeitoConvocacaoRm,
  classificarItensConvocacaoRm,
  convocacaoJaNoRm,
  dataHoraRm,
  dataPrevistaPagamentoPadrao,
  diasCorridos,
  somarDias,
  tipoEhConvocavel,
  filtroReadViewConvocacao,
  lotesDeChapas,
  montarConvocacaoRm,
  paraDataIso,
  parseConvocacoesReadView,
  periodosCruzam,
  pkConvocacaoRm,
  validarConvocacaoRm,
  type ConvocacaoExistenteRm,
  type ItemConvocacaoMonday,
} from "./convocacaoRm.js"

test("chapaRm: 6 dígitos com zero à esquerda, ignora ruído", () => {
  assert.equal(chapaRm("3330"), "003330")
  assert.equal(chapaRm("007404"), "007404")
  assert.equal(chapaRm(" 74-04 "), "007404")
  assert.equal(chapaRm(""), "000000")
})

test("dataHoraRm: dia + hora no formato do RM, respeita hora já presente", () => {
  assert.equal(dataHoraRm("2026-08-11"), "2026-08-11T00:00:00")
  assert.equal(dataHoraRm("2026-08-11", "14:32:05"), "2026-08-11T14:32:05")
  assert.equal(dataHoraRm("2026-08-11T09:01:02"), "2026-08-11T09:01:02")
})

test("diasCorridos ignora fuso (Date.UTC, não local)", () => {
  assert.equal(diasCorridos("2026-05-29", "2026-06-01"), 3)
  assert.equal(diasCorridos("2026-08-08", "2026-08-08"), 0)
  assert.equal(diasCorridos("2026-08-10", "2026-08-08"), -2)
})

test("antecedencia: 3 dias corridos é o mínimo do art. 452-A, e não bloqueia", () => {
  assert.deepEqual(antecedencia({ dataConvocacao: "2026-05-29", dataInicio: "2026-06-01" }), {
    dias: 3, suficiente: true,
  })
  // Mesmo dia: o próprio DP faz isso (514 registros). Reporta insuficiente, mas monta.
  assert.deepEqual(antecedencia({ dataConvocacao: "2026-06-01", dataInicio: "2026-06-01" }), {
    dias: 0, suficiente: false,
  })
  assert.equal(ANTECEDENCIA_MINIMA_DIAS, 3)
})

test("dataPrevistaPagamentoPadrao: dia 5 do mês seguinte, virando o ano", () => {
  assert.equal(dataPrevistaPagamentoPadrao("2026-06-30"), "2026-07-05")
  assert.equal(dataPrevistaPagamentoPadrao("2026-12-31"), "2027-01-05")
})

test("paraDataIso: aceita ISO e DD/MM/YYYY (o board usa os dois)", () => {
  // `Admissão` é coluna TEXT preenchida à mão em pt-BR; as datas de período são colunas date (ISO).
  assert.equal(paraDataIso("2026-08-11"), "2026-08-11")
  assert.equal(paraDataIso("2026-08-11T00:00:00"), "2026-08-11")
  assert.equal(paraDataIso("09/07/2024"), "2024-07-09")
  assert.equal(paraDataIso(" 11/12/2023 "), "2023-12-11")
  assert.equal(paraDataIso(""), "")
  assert.equal(paraDataIso("11-12-2023"), "")
  assert.equal(paraDataIso(undefined), "")
})

test("admissão em DD/MM/YYYY não reprova nem perde o piso da regra", () => {
  assert.deepEqual(
    validarConvocacaoRm({ chapa: "6323", dataInicio: "2026-08-01", dataFim: "2026-08-03", dataAdmissao: "09/07/2024" }),
    [],
  )
  // Admitida 02/08 (BR) e início 03/08 -> menos de 3 dias -> data do ato = início.
  const r = calcularDataConvocacao({ dataInicio: "2026-08-03", dataAdmissao: "02/08/2026" })
  assert.equal(r.data, "2026-08-03")
  assert.equal(r.motivo, "admissao_recente")
  // E admissão BR depois do início continua sendo erro.
  assert.deepEqual(
    validarConvocacaoRm({ chapa: "6323", dataInicio: "2026-08-01", dataFim: "2026-08-03", dataAdmissao: "05/08/2026" }),
    ["admissao_apos_inicio"],
  )
})

test("classificarItensConvocacaoRm: admissão BR e cancelamento BR são normalizados", () => {
  const { candidatos } = classificarItensConvocacaoRm([
    item({ dataAdmissao: "09/07/2024", statusConvocacao: "Cancelada parcialmente", cancelamentoInicio: "20/08/2026" }),
  ])
  assert.equal(candidatos.length, 1)
  assert.equal(candidatos[0].dataFim, "2026-08-19")
})

test("somarDias: atravessa mês e ano sem o fuso mexer no dia", () => {
  assert.equal(somarDias("2026-08-11", -3), "2026-08-08")
  assert.equal(somarDias("2026-08-02", -3), "2026-07-30")
  assert.equal(somarDias("2026-01-01", -3), "2025-12-29")
})

// --- data do ATO: 3 dias antes do início, com piso na admissão --------------

test("calcularDataConvocacao: padrão = 3 dias corridos antes do início (não é hoje)", () => {
  const r = calcularDataConvocacao({ dataInicio: "2026-08-11", dataAdmissao: "2026-01-15" })
  assert.equal(r.data, "2026-08-08")
  assert.equal(r.antecedenciaDias, 3)
  assert.equal(r.motivo, "antecedencia_padrao")
  assert.equal(r.exigeConfirmacaoRm, false)
})

test("calcularDataConvocacao: admitida no MESMO dia do início -> data do ato = início", () => {
  // Caso do DP: admitida dia 3 e convocada dia 3. 3-dias-antes cairia antes da admissão.
  const r = calcularDataConvocacao({ dataInicio: "2026-08-03", dataAdmissao: "2026-08-03" })
  assert.equal(r.data, "2026-08-03")
  assert.equal(r.antecedenciaDias, 0)
  assert.equal(r.motivo, "admissao_recente")
  assert.equal(r.exigeConfirmacaoRm, true)
})

test("calcularDataConvocacao: admissão 1 e 2 dias antes do início -> data do ato = início", () => {
  const umDia = calcularDataConvocacao({ dataInicio: "2026-08-03", dataAdmissao: "2026-08-02" })
  assert.equal(umDia.data, "2026-08-03")
  assert.equal(umDia.motivo, "admissao_recente")
  const doisDias = calcularDataConvocacao({ dataInicio: "2026-08-03", dataAdmissao: "2026-08-01" })
  assert.equal(doisDias.data, "2026-08-03")
  assert.equal(doisDias.motivo, "admissao_recente")
  assert.equal(doisDias.exigeConfirmacaoRm, true)
})

test("calcularDataConvocacao: admissão EXATAMENTE 3 dias antes já cabe na regra padrão", () => {
  const r = calcularDataConvocacao({ dataInicio: "2026-08-03", dataAdmissao: "2026-07-31" })
  assert.equal(r.data, "2026-07-31") // = a própria admissão, e a antecedência fecha em 3
  assert.equal(r.motivo, "antecedencia_padrao")
  assert.equal(r.exigeConfirmacaoRm, false)
})

test("calcularDataConvocacao: sem admissão cai no padrão e marca o motivo", () => {
  const r = calcularDataConvocacao({ dataInicio: "2026-08-11" })
  assert.equal(r.data, "2026-08-08")
  assert.equal(r.motivo, "sem_admissao")
})

test("calcularDataConvocacao: data informada manda, mesmo furando a antecedência", () => {
  const r = calcularDataConvocacao({ dataInicio: "2026-08-11", dataConvocacao: "2026-08-10" })
  assert.equal(r.data, "2026-08-10")
  assert.equal(r.motivo, "informada")
  assert.equal(r.antecedenciaDias, 1)
  assert.equal(r.exigeConfirmacaoRm, true)
})

test("calcularDataConvocacao: admissão depois do início é sinalizada", () => {
  const r = calcularDataConvocacao({ dataInicio: "2026-08-03", dataAdmissao: "2026-08-10" })
  assert.equal(r.admissaoAposInicio, true)
})

test("montarConvocacaoRm: raiz FopConvocacao, tabela PFCONVOCACAO, defaults do DP", () => {
  const m = montarConvocacaoRm({
    chapa: "3330", dataInicio: "2026-08-11", dataFim: "2026-08-31", dataAdmissao: "2026-01-15",
  })
  assert.match(m.dadosXml, /^<FopConvocacao>\s*<PFCONVOCACAO>/)
  assert.match(m.dadosXml, /<\/PFCONVOCACAO>\s*<\/FopConvocacao>$/)
  assert.ok(m.dadosXml.includes("<CODCOLIGADA>3</CODCOLIGADA>"))
  assert.ok(m.dadosXml.includes("<CHAPA>003330</CHAPA>"))
  assert.ok(m.dadosXml.includes("<INDLOCALPRESTACTRAB>0</INDLOCALPRESTACTRAB>"))
  assert.ok(m.dadosXml.includes("<ESTADOCONVOCACAO>4</ESTADOCONVOCACAO>"))
  assert.ok(m.dadosXml.includes("<DTINIPRESTSERV>2026-08-11T00:00:00</DTINIPRESTSERV>"))
  assert.ok(m.dadosXml.includes("<DTFIMPRESTSERV>2026-08-31T00:00:00</DTFIMPRESTSERV>"))
  // Data do ato = 3 dias antes do início, 00:00:00 como o DP grava; DTRESPOSTA acompanha
  // (estado 4 = já respondida).
  assert.ok(m.dadosXml.includes("<DTCONVOCACAO>2026-08-08T00:00:00</DTCONVOCACAO>"))
  assert.ok(m.dadosXml.includes("<DTRESPOSTA>2026-08-08T00:00:00</DTRESPOSTA>"))
  assert.equal(m.dataConvocacao, "2026-08-08")
  assert.equal(m.antecedenciaDias, 3)
  assert.equal(m.antecedenciaSuficiente, true)
  assert.equal(m.motivoDataConvocacao, "antecedencia_padrao")
  assert.equal(m.exigeConfirmacaoRm, false)
})

test("montarConvocacaoRm: admissão recente -> ato no início e exigeConfirmacaoRm", () => {
  const m = montarConvocacaoRm({
    chapa: "7404", dataInicio: "2026-08-03", dataFim: "2026-08-31", dataAdmissao: "2026-08-03",
  })
  assert.ok(m.dadosXml.includes("<DTCONVOCACAO>2026-08-03T00:00:00</DTCONVOCACAO>"))
  assert.ok(m.dadosXml.includes("<DTINIPRESTSERV>2026-08-03T00:00:00</DTINIPRESTSERV>"))
  assert.equal(m.motivoDataConvocacao, "admissao_recente")
  assert.equal(m.exigeConfirmacaoRm, true)
  assert.equal(m.antecedenciaSuficiente, false)
})

test("montarConvocacaoRm: é determinístico (não depende de relógio)", () => {
  const entrada = { chapa: "3330", dataInicio: "2026-08-11", dataFim: "2026-08-31", dataAdmissao: "2026-01-15" }
  assert.equal(montarConvocacaoRm(entrada).dadosXml, montarConvocacaoRm(entrada).dadosXml)
})

test("montarConvocacaoRm: barra convocação antes da admissão", () => {
  assert.throws(
    () => montarConvocacaoRm({
      chapa: "3330", dataInicio: "2026-08-03", dataFim: "2026-08-31", dataAdmissao: "2026-08-10",
    }),
    /admissao_apos_inicio/,
  )
})

const BASE = { chapa: "3330", dataInicio: "2026-08-11", dataFim: "2026-08-31" }

test("montarConvocacaoRm: sem código = tag VAZIA e presente (o RM numera pelo contador)", () => {
  // Provado contra o RM em 08/08/2026: com a tag vazia gravou e numerou C03S003754; SEM a tag o
  // SaveRecord estoura em ReadRowPrimaryKey antes de persistir. A tag não pode faltar.
  const m = montarConvocacaoRm(BASE)
  assert.ok(m.dadosXml.includes("<CODCONVOCACAO></CODCONVOCACAO>"))
  assert.equal(m.codConvocacao, "")
})

test("montarConvocacaoRm: omitirCodigo é só diagnóstico (reproduz a falha do RM)", () => {
  const m = montarConvocacaoRm(BASE, { omitirCodigo: true })
  assert.ok(!m.dadosXml.includes("CODCONVOCACAO"))
})

test("montarConvocacaoRm: código informado é escapado e vai no XML (mas o RM o ignora)", () => {
  const m = montarConvocacaoRm({ ...BASE, codConvocacao: "PI-1<&>" })
  assert.ok(m.dadosXml.includes("<CODCONVOCACAO>PI-1&lt;&amp;&gt;</CODCONVOCACAO>"))
})

test("montarConvocacaoRm: data do ato informada entra como 00:00:00", () => {
  const m = montarConvocacaoRm({ ...BASE, dataConvocacao: "2026-08-05" })
  assert.ok(m.dadosXml.includes("<DTCONVOCACAO>2026-08-05T00:00:00</DTCONVOCACAO>"))
  assert.equal(m.antecedenciaDias, 6)
  assert.equal(m.motivoDataConvocacao, "informada")
})

test("montarConvocacaoRm: DTPREVPGTO só sai se pedirem (o RM pode derivar)", () => {
  assert.ok(!montarConvocacaoRm(BASE).dadosXml.includes("DTPREVPGTO"))
  const comPrev = montarConvocacaoRm({ ...BASE, dataPrevistaPagamento: "2026-09-05" })
  assert.ok(comPrev.dadosXml.includes("<DTPREVPGTO>2026-09-05T00:00:00</DTPREVPGTO>"))
})

test("montarConvocacaoRm: nunca gera tabela filha PFCONVOCACAOPFPERFF no v1", () => {
  assert.ok(!montarConvocacaoRm(BASE).dadosXml.includes("PFCONVOCACAOPFPERFF"))
})

test("validarConvocacaoRm: pega chapa vazia, data inválida e período invertido", () => {
  assert.deepEqual(validarConvocacaoRm({ chapa: "3330", dataInicio: "2026-08-11", dataFim: "2026-08-31" }), [])
  assert.deepEqual(validarConvocacaoRm({ chapa: "", dataInicio: "2026-08-11", dataFim: "2026-08-31" }), [
    "chapa_invalida",
  ])
  // `11/08/2026` é VÁLIDO (DD/MM/YYYY, formato da coluna Admissão). Inválido é o resto.
  assert.deepEqual(validarConvocacaoRm({ chapa: "1", dataInicio: "11/08/2026", dataFim: "2026-08-31" }), [])
  assert.deepEqual(validarConvocacaoRm({ chapa: "1", dataInicio: "11-08-2026", dataFim: "2026-08-31" }), [
    "data_inicio_invalida",
  ])
  assert.deepEqual(validarConvocacaoRm({ chapa: "1", dataInicio: "agosto", dataFim: "2026-08-31" }), [
    "data_inicio_invalida",
  ])
  assert.deepEqual(validarConvocacaoRm({ chapa: "1", dataInicio: "2026-08-31", dataFim: "2026-08-11" }), [
    "periodo_invertido",
  ])
  assert.deepEqual(
    validarConvocacaoRm({ chapa: "1", dataInicio: "2026-08-11", dataFim: "2026-08-31", codConvocacao: "x".repeat(61) }),
    ["cod_convocacao_longo"],
  )
})

test("montarConvocacaoRm lança em entrada inválida — não monta XML meia-boca", () => {
  assert.throws(
    () => montarConvocacaoRm({ chapa: "", dataInicio: "2026-08-11", dataFim: "2026-08-31" }),
    /convocacao_rm_invalida: chapa_invalida/,
  )
})

test("pkConvocacaoRm: coligada;chapa;codigo na ordem do XSD", () => {
  assert.equal(pkConvocacaoRm({ chapa: "3330", codConvocacao: "C03S003328" }), "3;003330;C03S003328")
})

test("chaveEfeitoConvocacaoRm: por PESSOA e com nome de etapa novo", () => {
  assert.equal(
    chaveEfeitoConvocacaoRm({ contrato: "SEDUC ESCOLA", chapa: "3330", dataInicio: "2026-08-11" }),
    "convocacao_rm:SEDUC_ESCOLA:003330:2026-08-11",
  )
  // Duas pessoas do mesmo contrato/período têm chaves distintas: chave de lote pularia o resto.
  const a = chaveEfeitoConvocacaoRm({ contrato: "DETRAN", chapa: "1", dataInicio: "2026-08-01" })
  const b = chaveEfeitoConvocacaoRm({ contrato: "DETRAN", chapa: "2", dataInicio: "2026-08-01" })
  assert.notEqual(a, b)
})

const VIEW_XML = `<NewDataSet>
  <PFCONVOCACAO>
    <CODCOLIGADA>3</CODCOLIGADA>
    <CHAPA>003330</CHAPA>
    <CODCONVOCACAO>C03S003328</CODCONVOCACAO>
    <ESTADOCONVOCACAO>4</ESTADOCONVOCACAO>
    <DTCONVOCACAO>2026-05-29T00:00:00</DTCONVOCACAO>
    <DTRESPOSTA>2026-05-29T00:00:00</DTRESPOSTA>
    <DTINIPRESTSERV>2026-06-01T00:00:00</DTINIPRESTSERV>
    <DTFIMPRESTSERV>2026-06-30T00:00:00</DTFIMPRESTSERV>
    <INDLOCALPRESTACTRAB>0</INDLOCALPRESTACTRAB>
    <DESCESTADOCONVOCACAO>Concluída</DESCESTADOCONVOCACAO>
  </PFCONVOCACAO>
  <PFCONVOCACAO>
    <CODCOLIGADA>3</CODCOLIGADA>
    <CHAPA>007404</CHAPA>
    <CODCONVOCACAO>C03S003742</CODCONVOCACAO>
    <ESTADOCONVOCACAO>3</ESTADOCONVOCACAO>
    <DTCONVOCACAO>2026-07-30T00:00:00</DTCONVOCACAO>
    <DTINIPRESTSERV>2026-07-30T00:00:00</DTINIPRESTSERV>
    <DTFIMPRESTSERV>2026-07-31T00:00:00</DTFIMPRESTSERV>
    <INDLOCALPRESTACTRAB>0</INDLOCALPRESTACTRAB>
    <DESCESTADOCONVOCACAO>Em progresso</DESCESTADOCONVOCACAO>
  </PFCONVOCACAO>
</NewDataSet>`

test("parseConvocacoesReadView: extrai as colunas da view, datas sem hora", () => {
  const linhas = parseConvocacoesReadView(VIEW_XML)
  assert.equal(linhas.length, 2)
  assert.deepEqual(linhas[0], {
    chapa: "003330",
    codConvocacao: "C03S003328",
    dataConvocacao: "2026-05-29",
    dataInicio: "2026-06-01",
    dataFim: "2026-06-30",
    estado: "4",
    estadoDescricao: "Concluída",
  })
  assert.equal(linhas[1].estadoDescricao, "Em progresso")
})

test("parseConvocacoesReadView: resultado vazio não explode", () => {
  assert.deepEqual(parseConvocacoesReadView("<NewDataSet />"), [])
  assert.deepEqual(parseConvocacoesReadView(""), [])
})

test("periodosCruzam: inclusive nas pontas", () => {
  assert.equal(periodosCruzam("2026-08-01", "2026-08-10", "2026-08-10", "2026-08-20"), true)
  assert.equal(periodosCruzam("2026-08-01", "2026-08-10", "2026-08-11", "2026-08-20"), false)
  assert.equal(periodosCruzam("2026-08-05", "2026-08-06", "2026-08-01", "2026-08-31"), true)
})

const EXISTENTES: ConvocacaoExistenteRm[] = parseConvocacoesReadView(VIEW_XML)

test("convocacaoJaNoRm: acha o que o DP já lançou pra mesma pessoa e período", () => {
  const achou = convocacaoJaNoRm(EXISTENTES, { chapa: "3330", dataInicio: "2026-06-15", dataFim: "2026-06-20" })
  assert.equal(achou?.codConvocacao, "C03S003328")
})

test("convocacaoJaNoRm: período que não cruza e chapa de outra pessoa não contam", () => {
  assert.equal(convocacaoJaNoRm(EXISTENTES, { chapa: "3330", dataInicio: "2026-07-01", dataFim: "2026-07-31" }), null)
  assert.equal(convocacaoJaNoRm(EXISTENTES, { chapa: "9999", dataInicio: "2026-06-01", dataFim: "2026-06-30" }), null)
})

test("filtroReadViewConvocacao: overlap, chapas normalizadas e sem duplicata", () => {
  const f = filtroReadViewConvocacao({
    chapas: ["3330", "003330", "7404"],
    dataInicio: "2026-08-01",
    dataFim: "2026-08-31",
  })
  assert.equal(
    f,
    "CODCOLIGADA=3 AND CHAPA IN ('003330','007404')" +
      " AND DTINIPRESTSERV <= '2026-08-31' AND DTFIMPRESTSERV >= '2026-08-01'",
  )
})

test("filtroReadViewConvocacao: chapa suja FALHA em vez de virar outra pessoa", () => {
  // `chapaRm` manglaria "3330' OR 1=1 --" em 333011 — chapa de outra pessoa. A consulta voltaria
  // vazia, o pré-voo diria "não existe" e o lote duplicaria a convocação. Tem que estourar.
  assert.throws(
    () => filtroReadViewConvocacao({ chapas: ["3330' OR 1=1 --"], dataInicio: "2026-08-01", dataFim: "2026-08-31" }),
    /filtro_chapa_invalida/,
  )
  assert.throws(
    () => filtroReadViewConvocacao({ chapas: ["ABC"], dataInicio: "2026-08-01", dataFim: "2026-08-31" }),
    /filtro_chapa_invalida/,
  )
  assert.throws(
    () => filtroReadViewConvocacao({ chapas: [], dataInicio: "2026-08-01", dataFim: "2026-08-31" }),
    /filtro_sem_chapas/,
  )
  assert.throws(
    () => filtroReadViewConvocacao({ chapas: ["3330"], dataInicio: "01/08/2026", dataFim: "2026-08-31" }),
    /filtro_datas_invalidas/,
  )
})

test("chapaAceitavelNoFiltro: só dígitos, espaço em volta tudo bem", () => {
  assert.equal(chapaAceitavelNoFiltro("003330"), true)
  assert.equal(chapaAceitavelNoFiltro(" 3330 "), true)
  assert.equal(chapaAceitavelNoFiltro("33-30"), false)
  assert.equal(chapaAceitavelNoFiltro(""), false)
})

test("lotesDeChapas: dedup, normaliza e fatia", () => {
  const chapas = Array.from({ length: 250 }, (_, i) => String(i + 1))
  const lotes = lotesDeChapas(chapas, 100)
  assert.deepEqual(lotes.map((l) => l.length), [100, 100, 50])
  assert.equal(lotes[0][0], "000001")
  assert.deepEqual(lotesDeChapas(["1", "001", "0001"], 100), [["000001"]])
})

test("lotesDeChapas: também rejeita chapa suja (senão o filtro já receberia dígitos)", () => {
  assert.throws(() => lotesDeChapas(["3330", "x9"]), /filtro_chapa_invalida/)
})

// --- classificação do lote por contrato -------------------------------------

const item = (extra: Partial<ItemConvocacaoMonday> = {}): ItemConvocacaoMonday => ({
  itemId: "1",
  nome: "Fulana",
  chapa: "003330",
  contrato: "SEDUC ESCOLA",
  dataInicio: "2026-08-11",
  dataFim: "2026-08-31",
  dataAdmissao: "2026-01-15",
  statusConvocacao: "Válida",
  ...extra,
})

test("classificarItensConvocacaoRm: item válido vira candidato com o período efetivo", () => {
  const { candidatos, pulados } = classificarItensConvocacaoRm([item()])
  assert.equal(pulados.length, 0)
  assert.equal(candidatos.length, 1)
  assert.equal(candidatos[0].dataInicio, "2026-08-11")
  assert.equal(candidatos[0].dataFim, "2026-08-31")
})

test("classificarItensConvocacaoRm: item de GATILHO (contrato sem chapa) fica fora do lote", () => {
  // O grupo do gatilho tem 1 item por contrato no mesmo board: contrato preenchido, chapa vazia.
  // Sem esse filtro ele viraria "convocação" de ninguém.
  const { candidatos, pulados } = classificarItensConvocacaoRm([
    item({ itemId: "gatilho", chapa: "", nome: "SEDUC ESCOLA" }),
  ])
  assert.equal(candidatos.length, 0)
  assert.equal(pulados[0].motivo, "sem_chapa")
})

test("tipoEhConvocavel: NÃO CONVOCADO e DEMISSÃO ficam fora, acento não atrapalha", () => {
  assert.equal(tipoEhConvocavel("PONTUAL"), true)
  assert.equal(tipoEhConvocavel("MENSAL"), true)
  assert.equal(tipoEhConvocavel("MOP"), true)
  assert.equal(tipoEhConvocavel("NÃO CONVOCADO"), false)
  assert.equal(tipoEhConvocavel("NAO CONVOCADO"), false)
  assert.equal(tipoEhConvocavel("DEMISSÃO"), false)
  // Vazio segue passando: item sem o campo preenchido é decidido por datas e status, como antes.
  assert.equal(tipoEhConvocavel(""), true)
  assert.equal(tipoEhConvocavel(undefined), true)
})

test("classificarItensConvocacaoRm: NÃO CONVOCADO não vai pro RM nem com datas preenchidas", () => {
  // Hoje os 77 itens NÃO CONVOCADO do board estão sem datas e cairiam em sem_periodo — acidente de
  // preenchimento, não trava. Com data preenchida, sem este filtro, convocaria no RM quem não foi
  // convocado.
  const { candidatos, pulados } = classificarItensConvocacaoRm([
    item({ tipoConvocacao: "NÃO CONVOCADO" }),
  ])
  assert.equal(candidatos.length, 0)
  assert.equal(pulados[0].motivo, "tipo_nao_convocavel")
  assert.equal(pulados[0].detalhe, "NÃO CONVOCADO")
})

test("classificarItensConvocacaoRm: PONTUAL, MENSAL e MOP passam", () => {
  for (const tipo of ["PONTUAL", "MENSAL", "MOP"]) {
    const { candidatos } = classificarItensConvocacaoRm([item({ tipoConvocacao: tipo })])
    assert.equal(candidatos.length, 1, tipo)
  }
})

test("classificarItensConvocacaoRm: já lançado é pulado com o código", () => {
  const { candidatos, pulados } = classificarItensConvocacaoRm([item({ codRmExistente: " C03S003742 " })])
  assert.equal(candidatos.length, 0)
  assert.equal(pulados[0].motivo, "ja_lancado")
  assert.equal(pulados[0].detalhe, "C03S003742")
})

test("classificarItensConvocacaoRm: cancelada e bloqueada não vão pro RM", () => {
  for (const status of ["Cancelada", "Bloqueada - conflito"]) {
    const { candidatos, pulados } = classificarItensConvocacaoRm([item({ statusConvocacao: status })])
    assert.equal(candidatos.length, 0, status)
    assert.equal(pulados[0].motivo, "cancelada", status)
  }
})

test("classificarItensConvocacaoRm: cancelamento parcial TRUNCA o fim", () => {
  const { candidatos } = classificarItensConvocacaoRm([
    item({ statusConvocacao: "Cancelada parcialmente", cancelamentoInicio: "2026-08-20" }),
  ])
  assert.equal(candidatos.length, 1)
  assert.equal(candidatos[0].dataFim, "2026-08-19") // cancelamento − 1
})

test("classificarItensConvocacaoRm: parcial cancelado no 1º dia não sobra período", () => {
  const { candidatos, pulados } = classificarItensConvocacaoRm([
    item({ statusConvocacao: "Cancelada parcialmente", cancelamentoInicio: "2026-08-11" }),
  ])
  assert.equal(candidatos.length, 0)
  assert.equal(pulados[0].motivo, "cancelada")
})

test("classificarItensConvocacaoRm: sem período e admissão depois do início são pulados", () => {
  const semData = classificarItensConvocacaoRm([item({ dataFim: "" })])
  assert.equal(semData.pulados[0].motivo, "sem_periodo")
  const admissaoRuim = classificarItensConvocacaoRm([item({ dataAdmissao: "2026-09-01" })])
  assert.equal(admissaoRuim.pulados[0].motivo, "dados_invalidos")
  assert.match(admissaoRuim.pulados[0].detalhe!, /admissao_apos_inicio/)
})

test("classificarItensConvocacaoRm: lote misto mantém contagem e ordem", () => {
  const r = classificarItensConvocacaoRm([
    item({ itemId: "ok1" }),
    item({ itemId: "gat", chapa: "" }),
    item({ itemId: "ok2", chapa: "7404" }),
    item({ itemId: "canc", statusConvocacao: "Cancelada" }),
  ])
  assert.deepEqual(r.candidatos.map((c) => c.item.itemId), ["ok1", "ok2"])
  assert.deepEqual(r.pulados.map((p) => p.item.itemId), ["gat", "canc"])
})
