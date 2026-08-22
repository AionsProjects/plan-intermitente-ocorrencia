// Tradução de uma execução para a língua de quem opera — a Thifany e o operacional.
//
// O log nasceu instrumentando o backend, então falava a língua do backend: a linha liderava
// com o TIPO da ação ("Convocação", "Pagamento pontual") e a pessoa vinha depois, quando
// vinha — some quando há erro ou execução em andamento. Mas a pergunta que se chega fazendo
// é "saiu o pagamento da Márcia?", e o nome é a chave da busca, não o tipo.
//
// Então cada ação declara aqui como se apresenta: QUEM (título), QUANTO/QUANDO (destaque) e
// O QUÊ (detalhe). Uma função só, testável, sem JSX.
import type { Execucao } from "./types"
import { LABEL_ACAO } from "./types"

const dinheiro = (v: number): string =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "2026-08-13" → "13/08"; devolve "" pro que não é data. */
function diaCurto(v: unknown): string {
  const s = String(v ?? "")
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}/${m[2]}` : ""
}

function num(resumo: Record<string, unknown>, chave: string): number {
  const v = resumo[chave]
  return typeof v === "number" ? v : Number(v) || 0
}

/**
 * Total de uma grandeza do resumo, aceitando as DUAS formas em que ela existe.
 *
 * O workflow passou a gravar `credito_vr`/`credito_vt` separados (pedido de separar VR e VT na
 * tabela). Quem continuou lendo só a chave plana `credito` passou a ler ZERO — e foi assim que o
 * pagamento da MÁRCIA (14/08, R$ 138) apareceu como "Pago: nada" enquanto a tabela ao lado
 * mostrava os valores certos, tirados das chaves novas.
 *
 * Execuções antigas só têm a chave plana, então as duas formas continuam valendo.
 */
export function totalResumo(resumo: Record<string, unknown>, base: string): number {
  if (resumo[`${base}_vr`] != null || resumo[`${base}_vt`] != null) {
    return num(resumo, `${base}_vr`) + num(resumo, `${base}_vt`)
  }
  return num(resumo, base)
}

export interface ResumoLinha {
  /** Quem — o que o olho procura primeiro. */
  titulo: string
  /** Quanto ou quando — à direita, alinhado, comparável entre linhas. */
  destaque: string | null
  /** O que aconteceu, em uma frase curta. */
  detalhe: string
}

/**
 * O que a linha fechada diz. `destaque` é opcional de propósito: ação sem número não ganha
 * um placeholder ("—" repetido em coluna é ruído que ensina o olho a ignorar a coluna).
 */
export function resumoLinha(exec: Execucao): ResumoLinha {
  const r = (exec.payload_resumo ?? {}) as Record<string, unknown>
  const acao = LABEL_ACAO[exec.acao] ?? exec.acao.replaceAll("_", " ")
  const contrato = exec.contrato ?? ""
  // Título: pessoa > contrato > nome da ação. Mensal é por contrato e não tem pessoa;
  // relatório não tem nenhum dos dois.
  const titulo = exec.pessoa_nome || contrato || acao

  const periodo = (() => {
    const de = diaCurto(r.data_inicio)
    const ate = diaCurto(r.data_fim)
    if (!de) return null
    return de === ate ? de : `${de}–${ate}`
  })()

  if (exec.acao === "pontual_pagamento") {
    const total = num(r, "credito") + num(r, "boleto")
    const semSaldo = r.sem_saldo === true
    return {
      titulo,
      destaque: semSaldo ? "nada a pagar" : total > 0 ? dinheiro(total) : null,
      // Só contrato e período. A divisão crédito/boleto é da conferência, não do relance —
      // repetida ao lado do total ela dizia a mesma coisa duas vezes na mesma linha.
      detalhe: [contrato, periodo].filter(Boolean).join(" · "),
    }
  }

  if (exec.acao === "convocacao") {
    return {
      titulo,
      destaque: periodo,
      // A unidade saiu: é o texto mais longo do board ("SEMSA - UBS DR. JOSE AMAZONAS
      // PALHANO") e empurrava contrato e período pra fora por reticências.
      detalhe: contrato,
    }
  }

  if (exec.acao === "registro" || exec.acao === "cancelamento" || exec.acao === "split") {
    const faltas = num(r, "qtd_faltas")
    const atrasos = num(r, "qtd_atrasos")
    const marcas = [
      faltas > 0 ? `${faltas} ${faltas === 1 ? "falta" : "faltas"}` : null,
      atrasos > 0 ? `${atrasos} ${atrasos === 1 ? "atraso" : "atrasos"}` : null,
    ].filter(Boolean)
    return {
      titulo,
      destaque: marcas.length ? marcas.join(" · ") : periodo,
      detalhe: contrato,
    }
  }

  if (exec.acao === "mensal" || exec.acao === "mensal_fechamento") {
    const pessoas = num(r, "pessoas")
    return {
      titulo: titulo || "Pagamento mensal",
      destaque: pessoas > 0 ? `${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}` : null,
      detalhe: [r.competencia ? String(r.competencia) : null, contrato].filter(Boolean).join(" · "),
    }
  }

  return { titulo, destaque: periodo, detalhe: contrato || acao }
}

/**
 * A frase de desfecho, no topo do detalhe aberto: o que ESTA execução conseguiu (ou não).
 *
 * Existe porque "ok" com 19 fases verdes não responde "e aí, pagou quanto, pra onde?" — e era
 * o que a Thifany tinha que deduzir lendo nomes de etapa do RM.
 */
export function fraseDesfecho(exec: Execucao): string {
  const r = (exec.payload_resumo ?? {}) as Record<string, unknown>
  const quem = exec.pessoa_nome || exec.contrato || "esta execução"

  if (exec.estado === "erro") {
    return `Não concluiu. ${exec.erro_msg ? exec.erro_msg : "Veja o detalhe técnico abaixo."}`
  }
  if (exec.estado === "recusado") {
    const r2 = r as { recusado?: string; item_conflitante?: string; periodo_conflitante?: string }
    if (r2.recusado === "convocacao_conflitante") {
      return `Não permitida: ${quem} já tem convocação no período${
        r2.periodo_conflitante ? ` (${r2.periodo_conflitante})` : ""
      }. A trava impediu a sobreposição — nada quebrou.`
    }
    return `Não permitida por regra de negócio. ${exec.erro_msg ?? ""}`.trim()
  }
  if (exec.estado === "abandonada") {
    return "Começou e não terminou — ninguém confirmou o fim. Pode ter sido aba fechada no meio."
  }
  if (exec.estado === "aberta") return "Em andamento."

  if (exec.acao === "pontual_pagamento") {
    if (r.sem_saldo === true) {
      return `Nada a pagar: o desconto pendente consumiu todo o benefício de ${quem}. A dívida foi abatida.`
    }
    const credito = totalResumo(r, "credito")
    const boleto = totalResumo(r, "boleto")
    const partes = [
      credito > 0 ? `${dinheiro(credito)} de crédito no cartão` : null,
      boleto > 0 ? `${dinheiro(boleto)} em boleto PIX` : null,
    ].filter(Boolean)
    const desconto = totalResumo(r, "desconto")
    return (
      `Pago a ${quem}: ${partes.join(" e ") || "nada"}.` +
      (desconto > 0 ? ` Desconto de ${dinheiro(desconto)} abatido.` : "") +
      (boleto > 0 ? " O boleto está na Solicitação de Pagamento, esperando o DP." : "")
    )
  }
  if (exec.acao === "convocacao") {
    return `Convocação de ${quem} criada no Plano.` + (exec.estado === "parcial" ? " Parte do processo ficou pendente — veja abaixo." : "")
  }
  if (exec.estado === "parcial") return "Concluiu, mas parte ficou pendente — veja abaixo."
  return "Concluído."
}
