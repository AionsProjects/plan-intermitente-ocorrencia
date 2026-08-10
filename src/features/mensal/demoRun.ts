import { useEffect, useState } from "react"

import type { EventoMensal, RunHeader, RunItem, RunStatus } from "./api"

/**
 * Simulador local do acompanhamento — demo visual SEM backend e SEM efeitos.
 * Ativado por /mensal?demo=1. Avança contrato a contrato pelas 12 etapas do
 * workflow real; TRE PB falha de propósito no meio pra mostrar o estado de
 * erro. Nada é gravado (nem localStorage).
 */

const ETAPAS = [
  "validacao", "caju_pessoas", "caju_credito", "caju_pix",
  "convocacao_rm",
  "rm_gerar", "rm_aguardar", "rm_integrar",
  "monday_plano", "monday_controle_caju", "monday_solicitacao", "drive", "monday_status_ok",
] as const

const CONTRATOS: { contrato: string; qtd: number; falhaEm?: string }[] = [
  { contrato: "DETRAN", qtd: 89 },
  { contrato: "SEDUC SEDE", qtd: 120 },
  { contrato: "SEDUC ESCOLA", qtd: 96 },
  { contrato: "CETAM", qtd: 134 },
  { contrato: "TRE PB", qtd: 56, falhaEm: "rm_integrar" },
  { contrato: "SEMSA", qtd: 247 },
]

const TICK_MS = 420

export type DemoRun = { run: RunStatus; eventos: EventoMensal[]; finalizado: boolean }

function agoraIso() {
  return new Date().toISOString()
}

export function useDemoRun(ativo: boolean): DemoRun | null {
  const [snap, setSnap] = useState<DemoRun | null>(null)

  useEffect(() => {
    if (!ativo) {
      setSnap(null)
      return
    }
    // Estado mutável vive na closure do efeito — nunca lido durante render.
    const criadoEm = agoraIso()
    let idxContrato = 0
    let idxEtapa = -1
    let seqEvento = 0
    let finalizado = false
    const itens: RunItem[] = CONTRATOS.map((c, i) => ({
      ordem: i + 1,
      contrato: c.contrato,
      qtd: c.qtd,
      status: "pendente",
      etapa_atual: "",
      tentativas: 1,
      erro_msg: null,
      motivo_bloqueio: null,
      referencias_externas: {},
      atualizado_em: criadoEm,
    }))
    const eventos: EventoMensal[] = []

    const construir = (): DemoRun => {
      const okN = itens.filter((i) => i.status === "ok").length
      const erroN = itens.filter((i) => i.status === "erro").length
      const header: RunHeader = {
        run_id: "demo",
        papel: "teste",
        competencia: "2026-07",
        status: finalizado ? (erroN > 0 ? "concluido_com_erro" : "concluido") : "rodando",
        modo: "homologacao",
        etapa_atual: "contrato",
        total_contratos: itens.length,
        ok_contratos: okN,
        erro_contratos: erroN,
        criado_em: criadoEm,
        atualizado_em: agoraIso(),
        finalizado_em: finalizado ? agoraIso() : null,
      }
      return {
        run: { run: header, itens: itens.map((i) => ({ ...i })) },
        eventos: [...eventos],
        finalizado,
      }
    }

    setSnap(construir())
    const t = setInterval(() => {
      if (finalizado) return
      const cfg = CONTRATOS[idxContrato]
      const item = itens[idxContrato]
      if (!cfg || !item) {
        finalizado = true
        setSnap(construir())
        return
      }

      idxEtapa += 1
      const etapa = ETAPAS[idxEtapa]
      const falhou = cfg.falhaEm && etapa === cfg.falhaEm

      if (falhou) {
        item.status = "erro"
        item.erro_msg = "RM: IntegrarBackOffices retornou Pendente (simulado)"
        item.etapa_atual = etapa!
      } else if (!etapa) {
        item.status = "ok"
        item.etapa_atual = "finalizado"
      } else {
        item.status = "rodando"
        item.etapa_atual = etapa
      }
      item.atualizado_em = agoraIso()

      eventos.push({
        id: ++seqEvento,
        contrato: item.contrato,
        etapa: item.etapa_atual,
        estado: falhou ? "erro" : !etapa ? "ok" : "iniciando",
        tentativa: 1,
        mensagem: falhou ? item.erro_msg : null,
        metadados: {},
        criado_em: agoraIso(),
      })

      if (falhou || !etapa) {
        idxContrato += 1
        idxEtapa = -1
        if (idxContrato >= CONTRATOS.length) finalizado = true
      }
      setSnap(construir())
    }, TICK_MS)
    return () => clearInterval(t)
  }, [ativo])

  return ativo ? snap : null
}
