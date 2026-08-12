// Cliente Evolution API (WhatsApp). Mesma instância usada pelo WF
// "Notificar Advertência 4 em 3 meses" (instance AIONS-MIKE, cred "Evolution account (ray)").
//
// ⚠️ ENVIO DESLIGADO POR DEFAULT (`MONITOR_ENVIO_HABILITADO=1` liga). Mandar mensagem é
// ação externa e irreversível: sem o flag, a notificação é montada e gravada em
// pi.board_notificacao com `enviado_em` nulo — dá pra conferir o que sairia antes de soltar.
import { config } from "../config.js"

export interface ResultadoEnvio {
  enviado: boolean
  motivo?: "desabilitado" | "sem_credencial" | "erro"
  detalhe?: string
}

export function envioHabilitado(): boolean {
  return (
    config.evolution.habilitado &&
    !!config.evolution.url &&
    !!config.evolution.apiKey &&
    !!config.evolution.instance
  )
}

/**
 * Manda texto para um número ou grupo (JID `120363...@g.us`).
 * Não lança: quem chama grava o erro na notificação e segue — uma mensagem que não
 * saiu não pode travar a varredura nem perder o registro da alteração.
 */
export async function enviarTexto(destino: string, texto: string): Promise<ResultadoEnvio> {
  if (!config.evolution.habilitado) return { enviado: false, motivo: "desabilitado" }
  if (!config.evolution.url || !config.evolution.apiKey || !config.evolution.instance) {
    return { enviado: false, motivo: "sem_credencial" }
  }
  const base = config.evolution.url.replace(/\/$/, "")
  const url = `${base}/message/sendText/${encodeURIComponent(config.evolution.instance)}`
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.evolution.apiKey },
      body: JSON.stringify({ number: destino, text: texto }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) {
      const corpo = await r.text()
      return { enviado: false, motivo: "erro", detalhe: `HTTP ${r.status} ${corpo.slice(0, 200)}` }
    }
    return { enviado: true }
  } catch (e) {
    return { enviado: false, motivo: "erro", detalhe: (e as Error).message }
  }
}
