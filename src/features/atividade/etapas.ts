/**
 * Rótulos das fases, cobrindo TODAS as ações — não só o mensal.
 *
 * ⚠️ Não reusar `ETAPAS_ORDEM` do acompanhamento do mensal como trilho universal: são
 * as 13 etapas daquele workflow, e uma convocação renderizaria 13 barras com 12
 * falsas. Aqui não há ordem canônica — o trilho vem das fases que a própria execução
 * emitiu, em ordem de gravação.
 */
const LABEL_ETAPA: Record<string, string> = {
  // convocação (routes/convocar.ts)
  antifraude: "Checando conflito de período",
  criar_item_monday: "Criando item no Plano",
  convocacao_rm: "Convocação no RM (eSocial)",
  upload_termo: "Anexando termos",
  arquivar_drive: "Arquivando no Drive",
  resolver_board: "Resolvendo board do mês",
  // mensal (workflows/mensal.ts)
  validacao: "Validando dados",
  caju_pessoas: "Buscando pessoas no Caju",
  caju_credito: "Pedido de crédito Caju",
  caju_pix: "Pedido PIX Caju",
  caju_polling_boleto: "Gerando boleto / QR",
  rm_gerar: "Gerando lançamento no RM",
  rm_aguardar: "Aguardando RM processar",
  rm_integrar: "Integrando no RM",
  monday_plano: "Atualizando o Plano",
  monday_controle_caju: "Registrando no Controle Caju",
  monday_solicitacao: "Criando Solicitação de Pagamento",
  monday_status_ok: "Marcando AUTOMAÇÃO - OK",
  drive: "Arquivando no Drive",
  contrato: "Contrato",
  finalizado: "Finalizado",
  // registro / cancelamento / split
  ledger: "Calculando desconto",
  desconto: "Gravando na Base de Desconto",
  historico: "Atualizando o Histórico",
  cancelar_rm: "Removendo convocação do RM",
  substituir_rm: "Substituindo convocação no RM",
  // pré-pagamento na convocação (fase 1 do pontual)
  pre_pagamento: "Calculando o pagamento",
  reservar_prepagamento: "Reservando o desconto",
  liberar_prepagamento: "Devolvendo o desconto ao FIFO",
  // pagamento pontual na felipeta (workflows/pontual.ts) — um por step, senão a
  // timeline mostra "rm gerar hist pix l0" pra quem só quer saber o que aconteceu.
  caju_pessoa: "Localizando a pessoa no Caju",
  fifo: "Abatendo o desconto pendente",
  caju_credito_vr: "Pedido de crédito — VR",
  caju_credito_vt: "Pedido de crédito — VT",
  caju_pix_vr: "Boleto PIX — VR",
  caju_pix_vt: "Boleto PIX — VT",
  rm_gerar_hist_pix_l0: "Histórico do boleto no RM",
  rm_gerar_hist_credito_l0: "Histórico do crédito no RM",
  monday_balao: "Publicando o resumo no item",
  pagamento: "Pagamento",
}

export const rotuloEtapa = (e: string | null | undefined): string =>
  (e && LABEL_ETAPA[e]) || (e ?? "").replaceAll("_", " ")

/**
 * Cor da barra do trilho por estado da fase.
 *
 * ⚠️ Usa `--status-*-rgb` (triplet), não `--status-*` (hex): `rgb(#ef6666/0.8)` é
 * inválido, o navegador descarta a declaração e a barra fica INVISÍVEL — foi
 * exatamente o que aconteceu na primeira versão disto.
 */
export function corDaFase(estado: string): string {
  if (estado === "erro") return "bg-[rgb(var(--status-red-rgb)/0.85)]"
  if (estado === "rodando") return "animate-pulse bg-[rgb(var(--accent-rgb)/0.75)]"
  if (estado === "pulado") return "bg-[rgb(var(--ink)/0.14)]"
  if (estado === "aviso") return "bg-[rgb(var(--status-yellow-rgb)/0.8)]"
  // Concluída = VERDE, não o âmbar do accent. Um trilho de 17 barras douradas lia como
  // "17 avisos" — e a lâmpada da linha já diz sucesso em verde; o trilho tem que concordar
  // com ela, senão a mesma execução aparece bem em um lugar e suspeita no outro.
  return "bg-[rgb(var(--status-green-rgb)/0.75)]"
}

export const LABEL_ESTADO_FASE: Record<string, string> = {
  rodando: "em andamento",
  ok: "ok",
  erro: "erro",
  pulado: "não se aplica",
  aviso: "pendente",
}

/**
 * Fases dobradas por nome: `comEtapa` grava o par rodando→ok, e mostrar as duas
 * linhas no trilho contaria cada fase duas vezes. Mantém o ÚLTIMO estado de cada
 * fase, preservando a ordem da primeira aparição.
 */
export function fasesDobradas<T extends { etapa: string; estado: string }>(etapas: T[]): T[] {
  const porNome = new Map<string, T>()
  for (const e of etapas) porNome.set(e.etapa, e)
  return [...porNome.values()]
}

const FUSO = "America/Manaus"

/**
 * Hora no fuso de Manaus, explícito.
 *
 * O alerta de erro é gerado no SERVIDOR (UTC na Vercel). Se a tela mostrar a hora do
 * fuso do navegador, o horário da mensagem no WhatsApp não bate com o do log e
 * ninguém confia em nenhum dos dois. Mesma escolha de routes/pontofac.ts.
 */
export function horaManaus(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: FUSO,
    })
  } catch {
    return ""
  }
}

export function horaComSegundosManaus(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: FUSO,
    })
  } catch {
    return ""
  }
}

export function dataHoraManaus(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: FUSO })
  } catch {
    return iso
  }
}

/** `YYYY-MM-DD` do dia em Manaus — chave de agrupamento da lista. */
export function diaManaus(iso: string): string {
  try {
    // en-CA devolve YYYY-MM-DD, que ordena como string.
    return new Date(iso).toLocaleDateString("en-CA", { timeZone: FUSO })
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Rótulo do separador de dia. Hoje e ontem dizem só isso — a data completa ao lado era
 * redundante ("HOJE · QUINTA-FEIRA, 13 DE AGOSTO" ocupava a largura da lista pra informar
 * o que "Hoje" já informou).
 */
export function rotuloDia(dia: string): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: FUSO })
  const ontem = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: FUSO })
  if (dia === hoje) return "Hoje"
  if (dia === ontem) return "Ontem"
  const [ano, mes, d] = dia.split("-").map(Number)
  // Meio-dia UTC evita o dia virar pra trás na formatação.
  const data = new Date(Date.UTC(ano!, (mes ?? 1) - 1, d ?? 1, 12))
  return data.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

export function duracaoCurta(ms: number | null | undefined): string {
  if (ms == null) return ""
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}min ${Math.round(s % 60)}s`
}
