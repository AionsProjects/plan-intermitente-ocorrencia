import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { BuscarEmpregado } from "./BuscarEmpregado"
import { FormularioConvocacao } from "./FormularioConvocacao"
import { TelaSucesso } from "./TelaSucesso"
import type { EmpregadoRM } from "./types"

type Etapa =
  | { tipo: "busca" }
  | { tipo: "form"; empregado: EmpregadoRM }
  | { tipo: "sucesso"; itemId: string; itemUrl: string }

const ORDEM: Record<Etapa["tipo"], number> = {
  busca: 0,
  form: 1,
  sucesso: 2,
}

function etapaKey(e: Etapa): string {
  if (e.tipo === "form")
    return `form-${e.empregado.chapa || e.empregado.nome}`
  if (e.tipo === "sucesso") return `sucesso-${e.itemId}`
  return "busca"
}

export function ConvocarPage() {
  const navigate = useNavigate()
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "busca" })
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const ultimoTipoRef = useRef<Etapa["tipo"]>("busca")

  function ir(nova: Etapa) {
    const novaOrdem = ORDEM[nova.tipo]
    const atualOrdem = ORDEM[ultimoTipoRef.current]
    let dir: SlideDirection = "forward"
    // sucesso → busca é loop de "nova convocação" — tratamos como forward
    if (
      novaOrdem < atualOrdem &&
      !(ultimoTipoRef.current === "sucesso" && nova.tipo === "busca")
    ) {
      dir = "backward"
    }
    setDirecao(dir)
    ultimoTipoRef.current = nova.tipo
    setEtapa(nova)
  }

  function renderEtapa(): React.ReactNode {
    if (etapa.tipo === "busca") {
      return (
        <BuscarEmpregado
          onSelecionar={(empregado) => ir({ tipo: "form", empregado })}
        />
      )
    }
    if (etapa.tipo === "form") {
      return (
        <FormularioConvocacao
          empregado={etapa.empregado}
          onTrocarEmpregado={() => ir({ tipo: "busca" })}
          onSucesso={(itemId, itemUrl) =>
            ir({ tipo: "sucesso", itemId, itemUrl })
          }
        />
      )
    }
    return (
      <TelaSucesso
        itemId={etapa.itemId}
        itemUrl={etapa.itemUrl}
        onNovaConvocacao={() => ir({ tipo: "busca" })}
      />
    )
  }

  return (
    <div className="relative z-10 min-h-svh">
      <div className="flex justify-center px-4 py-12">
        <div className="glass-strong relative w-full max-w-2xl p-8 sm:p-10 fade-up">
          {etapa.tipo !== "sucesso" && (
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mb-6 inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/85"
            >
              <ArrowLeft className="size-3.5" />
              Voltar
            </button>
          )}
          <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
            {renderEtapa()}
          </SlideStack>
        </div>
      </div>
    </div>
  )
}
