// Transforma alterações novas em mensagens de WhatsApp para o DP.
//
// Ordem: filtra o que deve alertar -> agrupa por AÇÃO de negócio -> aplica o fusível
// -> grava a notificação (amarrando as alterações) -> envia.
//
// A gravação vem ANTES do envio de propósito: se o envio falhar, a mensagem fica
// registrada com o erro em vez de sumir. E as alterações saem da fila ao serem
// amarradas, então uma falha de envio não vira spam na varredura seguinte.
import { config } from "../config.js"
import { enviarTexto, envioHabilitado } from "../clients/evolution.js"
import { agruparPorAcao, deveNotificar, type AlteracaoClassificada } from "../domain/alteracaoBoard.js"
import { mensagemUnica, mensagemAgrupada } from "../domain/mensagemAlteracao.js"
import { criarNotificacao, marcarEnviada, notificacoesUltimaHora, type Bloqueio } from "../repo/bloqueio.js"

export interface ResultadoNotificacao {
  candidatas: number
  mensagens: number
  enviadas: number
  falhas: number
  colapsadas: number
  envioAtivo: boolean
}

export async function notificarAlteracoes(
  b: Bloqueio,
  alteracoes: AlteracaoClassificada[],
): Promise<ResultadoNotificacao> {
  const ctx = { competencia: b.competencia }
  const destino = b.destino_whatsapp || config.monitor.destinoWhatsapp
  const out: ResultadoNotificacao = {
    candidatas: 0, mensagens: 0, enviadas: 0, falhas: 0, colapsadas: 0,
    envioAtivo: envioHabilitado(),
  }

  const candidatas = alteracoes.filter(deveNotificar)
  out.candidatas = candidatas.length
  if (!candidatas.length) return out

  // Uma ação do operador = uma mensagem, mesmo escrevendo 12 colunas.
  let grupos = agruparPorAcao(candidatas)

  // Fusível: em 30/07/2026 o OP fez 659 alterações críticas num dia. Se o volume passar
  // do teto na última hora, o resto vira UMA mensagem agrupada, avisando que colapsou.
  // Sem isso o grupo é silenciado e a automação morre na praia.
  const jaEnviadas = await notificacoesUltimaHora(b.id)
  const espaco = Math.max(0, b.teto_msgs_hora - jaEnviadas)
  let colapsar: AlteracaoClassificada[] = []

  if (b.modo_notificacao === "digest") {
    colapsar = grupos.flat()
    grupos = []
  } else if (grupos.length > espaco) {
    colapsar = grupos.slice(espaco).flat()
    grupos = grupos.slice(0, espaco)
  }

  for (const g of grupos) {
    const corpo = g.length === 1 ? mensagemUnica(g[0]!, ctx) : mensagemAgrupada(g, ctx)
    await entregar(b.id, destino, corpo, g, false, out)
  }

  if (colapsar.length) {
    const corpo = mensagemAgrupada(colapsar, ctx, { colapsada: true, janelaMin: 60 })
    await entregar(b.id, destino, corpo, colapsar, true, out)
    out.colapsadas = colapsar.length
  }
  return out
}

async function entregar(
  bloqueioId: string,
  destino: string,
  corpo: string,
  alteracoes: AlteracaoClassificada[],
  colapsada: boolean,
  out: ResultadoNotificacao,
): Promise<void> {
  const id = await criarNotificacao({
    bloqueioId, destino, corpo, colapsada,
    activityLogIds: alteracoes.map((a) => a.activityLogId),
  })
  out.mensagens++

  const r = await enviarTexto(destino, corpo)
  if (r.enviado) {
    await marcarEnviada(id)
    out.enviadas++
    return
  }
  if (r.motivo === "desabilitado" || r.motivo === "sem_credencial") {
    // Não é falha: o envio está deliberadamente fechado. Fica gravada, sem `enviado_em`,
    // para conferência — é o modo de homologação.
    await marcarEnviada(id, `nao_enviado:${r.motivo}`)
    return
  }
  await marcarEnviada(id, r.detalhe ?? "erro_desconhecido")
  out.falhas++
  console.warn(`[notificar] mensagem ${id} nao saiu: ${r.detalhe}`)
}
