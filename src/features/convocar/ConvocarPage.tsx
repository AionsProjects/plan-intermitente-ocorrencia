import { useRef, useState } from "react"
import { useRegistrarVoltar } from "@/components/NavContext"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { BuscarEmpregado } from "./BuscarEmpregado"
import { EscolherMes } from "./EscolherMes"
import { FormularioConvocacao } from "./FormularioConvocacao"
import { TelaSucesso } from "./TelaSucesso"
import type { EmpregadoRM } from "./types"

type Etapa =
  | { tipo: "busca" }
  | { tipo: "mes"; empregado: EmpregadoRM }
  | { tipo: "form"; empregado: EmpregadoRM; papel: "atual" | "proximo"; competencia: string }
  | { tipo: "sucesso"; itemId: string; itemUrl: string }

const ORDEM: Record<Etapa["tipo"], number> = {
  busca: 0,
  mes: 1,
  form: 2,
  sucesso: 3,
}

function etapaKey(e: Etapa): string {
  if (e.tipo === "mes") return `mes-${e.empregado.chapa || e.empregado.nome}`
  if (e.tipo === "form")
    return `form-${e.empregado.chapa || e.empregado.nome}-${e.papel}`
  if (e.tipo === "sucesso") return `sucesso-${e.itemId}`
  return "busca"
}

export function ConvocarPage() {
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
          onSelecionar={(empregado) => ir({ tipo: "mes", empregado })}
        />
      )
    }
    if (etapa.tipo === "mes") {
      return (
        <EscolherMes
          empregado={etapa.empregado}
          onTrocarEmpregado={() => ir({ tipo: "busca" })}
          onEscolher={(papel, competencia) =>
            ir({ tipo: "form", empregado: etapa.empregado, papel, competencia })
          }
        />
      )
    }
    if (etapa.tipo === "form") {
      return (
        <FormularioConvocacao
          empregado={etapa.empregado}
          papel={etapa.papel}
          competencia={etapa.competencia}
          onTrocarEmpregado={() => ir({ tipo: "busca" })}
          onVoltarMes={() => ir({ tipo: "mes", empregado: etapa.empregado })}
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

  useRegistrarVoltar(
    etapa.tipo === "mes"
      ? () => ir({ tipo: "busca" })
      : etapa.tipo === "form"
        ? () => ir({ tipo: "mes", empregado: etapa.empregado })
        : null,
  )

  return (
    <div className="relative z-10 min-h-svh">
      <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="glass-strong card-shimmer relative w-full max-w-2xl p-5 sm:p-8 lg:p-10">
          <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
            {renderEtapa()}
          </SlideStack>
        </div>
      </div>
    </div>
  )
}
