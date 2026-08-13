// Dados do relatório de pagamento do PONTUAL.
//
// Duas portas para a mesma estrutura:
//   - `montarDadosRelatorioPontual` — puro, alimentado pelo workflow com os refs em mão;
//   - `lerDadosRelatorioPontual` — reconstrói do banco (snapshot + artefatos da execução), pro
//     back-fill dos pagamentos que já saíram e pra rota de conferência do layout.
//
// A reconstrução lê os ARTEFATOS (`atividade_artefato`), não as refs do ledger: o artefato já vem
// tipado e rotulado ("Pedido crédito VR", "IDFINANC VT"), enquanto o ledger guarda string
// concatenada que exigiria parse frágil.
import { query } from "../db.js"
import type {
  DadosRelatorioPagamento,
  DividaRelatorioPagamento,
  EntradaPedidoRelatorio,
  PessoaRelatorioPagamento,
} from "../services/relatorioPagamento.js"
import { fmtDataIso, montarPedidosRelatorio } from "../services/relatorioPagamento.js"
import { BOARD_DESCONTO_URL, type AbatimentoBalao } from "./mondayPontual.js"
import { lerPrePagamentoCompleto, type PrePagamentoCompleto } from "./prepagamento.js"

const num = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100

export interface RefsRelatorioPontual {
  pedidoCreditoVR?: string | null
  pedidoCreditoVT?: string | null
  pedidoPixVR?: string | null
  pedidoPixVT?: string | null
  idVR?: string | null
  idVT?: string | null
  solicitacaoId?: string | null
  pastaDriveId?: string | null
}

function entradasDeRefs(refs: RefsRelatorioPontual): EntradaPedidoRelatorio[] {
  const e: EntradaPedidoRelatorio[] = []
  if (refs.pedidoCreditoVR) e.push({ natureza: "CRÉDITO", beneficio: "VR", orderId: refs.pedidoCreditoVR })
  if (refs.pedidoCreditoVT) e.push({ natureza: "CRÉDITO", beneficio: "VT", orderId: refs.pedidoCreditoVT })
  if (refs.pedidoPixVR) e.push({ natureza: "BOLETO", beneficio: "VR", orderId: refs.pedidoPixVR })
  if (refs.pedidoPixVT) e.push({ natureza: "BOLETO", beneficio: "VT", orderId: refs.pedidoPixVT })
  return e
}

function pessoaDoSnapshot(s: PrePagamentoCompleto): PessoaRelatorioPagamento {
  return {
    nome: s.nome ?? "(sem nome)",
    chapa: s.chapa,
    cpf: s.cpf,
    diasVR: s.dias_vr,
    diasVT: s.dias_vt,
    vrDia: s.vr_dia,
    vtDia: s.vt_dia,
    brutoVR: s.bruto_vr,
    brutoVT: s.bruto_vt,
    descontoVR: s.desconto_vr,
    descontoVT: s.desconto_vt,
    liquidoVR: s.liquido_vr,
    liquidoVT: s.liquido_vt,
    creditoVR: s.credito_vr,
    creditoVT: s.credito_vt,
    pixVR: s.pix_vr,
    pixVT: s.pix_vt,
  }
}

function dividasDe(abatimentos: AbatimentoBalao[]): DividaRelatorioPagamento[] {
  return abatimentos
    .filter((a) => num(a.vr) > 0 || num(a.vt) > 0)
    .map((a) => ({
      descontoMondayItemId: a.descontoMondayItemId,
      vr: num(a.vr),
      vt: num(a.vt),
      ...(a.status ? { status: a.status } : {}),
      ...(a.residualVR != null ? { residualVR: num(a.residualVR) } : {}),
      ...(a.residualVT != null ? { residualVT: num(a.residualVT) } : {}),
      url: `${BOARD_DESCONTO_URL}/pulses/${a.descontoMondayItemId}`,
    }))
}

const MESES = [
  "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
]

/** Competência do pontual = mês da data de início (mesma regra do WF5). */
export function competenciaLabelPontual(dataInicio: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(dataInicio ?? ""))
  if (!m) return ""
  return `${MESES[Number(m[2]) - 1] ?? ""}/${m[1]}`
}

/** Builder puro — o que o workflow chama, com os refs que ele acabou de produzir. */
export function montarDadosRelatorioPontual(inp: {
  snapshot: PrePagamentoCompleto
  pessoa?: PessoaRelatorioPagamento
  refs: RefsRelatorioPontual
  abatimentos: AbatimentoBalao[]
  geradoPor: string
  geradoEm: Date
}): DadosRelatorioPagamento {
  const s = inp.snapshot
  const pessoa = inp.pessoa ?? pessoaDoSnapshot(s)
  const pastaId = inp.refs.pastaDriveId ?? s.pasta_convocacao_drive_id
  return {
    origem: "PONTUAL",
    contrato: s.contrato ?? "—",
    periodoLabel: `${fmtDataIso(s.data_inicio)} a ${fmtDataIso(s.data_fim)}`,
    dataInicio: s.data_inicio,
    dataFim: s.data_fim,
    competenciaLabel: competenciaLabelPontual(s.data_inicio),
    regraAplicada: s.regra_aplicada,
    pessoas: [pessoa],
    pedidos: montarPedidosRelatorio(entradasDeRefs(inp.refs), {
      creditoVR: num(pessoa.creditoVR),
      creditoVT: num(pessoa.creditoVT),
      pixVR: num(pessoa.pixVR),
      pixVT: num(pessoa.pixVT),
    }),
    idfinancVR: inp.refs.idVR ?? null,
    idfinancVT: inp.refs.idVT ?? null,
    solicitacaoUrl: inp.refs.solicitacaoId
      ? `https://contato-serv.monday.com/boards/18393673859/pulses/${inp.refs.solicitacaoId}`
      : null,
    pastaDriveUrl: pastaId ? `https://drive.google.com/drive/folders/${pastaId}` : null,
    dividas: dividasDe(inp.abatimentos),
    geradoPor: inp.geradoPor,
    geradoEm: inp.geradoEm,
  }
}

/**
 * Sobe SÓ o relatório na pasta da convocação — o caminho do back-fill.
 *
 * `atualizar_monday: false`: os links de pasta já foram escritos no item quando o pagamento
 * rodou, e reescrevê-los meses depois só gera atividade no board sem informação nova.
 */
export async function arquivarRelatorioPontual(
  snapshot: PrePagamentoCompleto,
  dados: DadosRelatorioPagamento,
): Promise<{ url: string | null; pastaId: string | null }> {
  const { arquivarDrive } = await import("../services/driveArquivar.js")
  const { gerarRelatorioPagamentoPdf, nomeArquivoRelatorio } = await import("../services/relatorioPagamento.js")
  const nome = nomeArquivoRelatorio(dados)
  const pastasResolvidas =
    snapshot.pasta_pessoa_drive_id && snapshot.pasta_convocacao_drive_id
      ? { pastaPessoaId: snapshot.pasta_pessoa_drive_id, pastaConvocacaoId: snapshot.pasta_convocacao_drive_id }
      : undefined
  const r = await arquivarDrive({
    tipo: "relatorio",
    nome: snapshot.nome ?? dados.pessoas[0]?.nome ?? "(sem nome)",
    chapa: snapshot.chapa,
    cpf: snapshot.cpf ?? undefined,
    contrato: snapshot.contrato ?? dados.contrato,
    data_inicio: snapshot.data_inicio,
    data_fim: snapshot.data_fim,
    atualizar_monday: false,
    pastas_resolvidas: pastasResolvidas,
    arquivos: [{
      buffer: gerarRelatorioPagamentoPdf(dados),
      filename: nome,
      mime: "application/pdf",
    }],
  })
  return {
    url: r.uploads.find((u) => u.name === nome)?.url ?? null,
    pastaId: r.pasta_convocacao_drive_id ?? null,
  }
}

export interface ArtefatosExecucao {
  execucaoId: string | null
  refs: RefsRelatorioPontual
  abatimentos: AbatimentoBalao[]
}

/**
 * Refs de um pagamento já feito, a partir dos artefatos da execução.
 *
 * Escolhe a execução com MAIS artefatos (não a mais recente): re-marcar o SIM cria uma execução
 * `ja_pago` que fecha com 2 artefatos, e ela apagaria o rastro completo do pagamento de verdade.
 */
export async function lerArtefatosPagamento(itemOrigemId: string): Promise<ArtefatosExecucao> {
  const { rows } = await query<{ id: string }>(
    `SELECT a.id::text
       FROM audit_lancamentos a
       LEFT JOIN atividade_artefato t ON t.execucao_id = a.id
      WHERE a.acao = 'pontual_pagamento' AND a.uuid_alvo = $1
      GROUP BY a.id, a.criado_em
      ORDER BY count(t.id) DESC, a.criado_em DESC
      LIMIT 1`,
    [String(itemOrigemId)],
  )
  const execucaoId = rows[0]?.id ?? null
  if (!execucaoId) return { execucaoId: null, refs: {}, abatimentos: [] }

  const { rows: arts } = await query<{ tipo: string; chave: string; rotulo: string | null }>(
    `SELECT tipo, chave, rotulo FROM atividade_artefato WHERE execucao_id = $1 ORDER BY id`,
    [execucaoId],
  )
  const refs: RefsRelatorioPontual = {}
  for (const a of arts) {
    const vt = /\bVT\b/i.test(a.rotulo ?? "")
    if (a.tipo === "caju_pedido") {
      if (vt) refs.pedidoCreditoVT = a.chave
      else refs.pedidoCreditoVR = a.chave
    } else if (a.tipo === "caju_boleto") {
      if (vt) refs.pedidoPixVT = a.chave
      else refs.pedidoPixVR = a.chave
    } else if (a.tipo === "rm_idfinanc") {
      if (vt) refs.idVT = a.chave
      else refs.idVR = a.chave
    } else if (a.tipo === "solicitacao") {
      refs.solicitacaoId = a.chave
    } else if (a.tipo === "drive_pasta") {
      refs.pastaDriveId = a.chave
    }
  }

  // Abatimentos com desfecho por dívida só existem no log do step do FIFO — o ledger guarda
  // apenas os deltas. Sem o evento, quem chama cai nas reservas do snapshot.
  const { rows: ev } = await query<{ metadados: { abatimentos?: AbatimentoBalao[] } | null }>(
    `SELECT metadados FROM atividade_evento
      WHERE execucao_id = $1 AND etapa = 'fifo' AND estado = 'ok'
      ORDER BY id DESC LIMIT 1`,
    [execucaoId],
  )
  const abatimentos = ev[0]?.metadados?.abatimentos ?? []
  return { execucaoId, refs, abatimentos }
}

/** Reconstrói o relatório de um pagamento já feito. `null` = não há snapshot desse item. */
export async function lerDadosRelatorioPontual(
  itemOrigemId: string,
  geradoPor: string,
  geradoEm: Date,
): Promise<{ dados: DadosRelatorioPagamento; execucaoId: string | null } | null> {
  const snapshot = await lerPrePagamentoCompleto(itemOrigemId)
  if (!snapshot) return null
  const { execucaoId, refs, abatimentos } = await lerArtefatosPagamento(itemOrigemId)
  // Snapshot guarda os deltas em `calculo->reservas`; servem de fallback quando o evento do
  // FIFO não existe (execução antiga, log podado).
  const doSnapshot = (snapshot.calculo as { reservas?: AbatimentoBalao[] }).reservas ?? snapshot.reservas
  return {
    execucaoId,
    dados: montarDadosRelatorioPontual({
      snapshot,
      refs,
      abatimentos: abatimentos.length ? abatimentos : (doSnapshot ?? []),
      geradoPor,
      geradoEm,
    }),
  }
}
