import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CheckCircle2 } from "lucide-react"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { EtapaConfirmar } from "./EtapaConfirmar"
import { EtapaValorBeneficio } from "./EtapaValorBeneficio"
import { TelaCarregando } from "./TelaCarregando"
import { TelaErro } from "./TelaErro"
import { TelaRegistrado } from "./TelaRegistrado"
import { useDesconto, useRegistrarRetirada } from "./useDescontos"
import { digitosParaReal } from "./shared"

type Etapa = "vr" | "vt" | "confirmar" | "sucesso"

const ORDEM: Record<Etapa, number> = {
  vr: 0,
  vt: 1,
  confirmar: 2,
  sucesso: 3,
}

export function DescontosPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const { data, isLoading, isError, error } = useDesconto(uuid)
  const registrarMut = useRegistrarRetirada(uuid ?? "")

  const [etapa, setEtapa] = useState<Etapa>("vr")
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const [vrDigitos, setVrDigitos] = useState<string>("")
  const [vtDigitos, setVtDigitos] = useState<string>("")
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)

  // Auto-fechar / redirecionar após sucesso (2s)
  useEffect(() => {
    if (etapa !== "sucesso") return
    const t = window.setTimeout(() => {
      // Tenta fechar (caso aberto em popup do Monday). Fallback: navega Hub.
      window.close()
      // Se window.close() falhar (página não foi aberta via window.open), o
      // user verá o toast travado — adicionar fallback após 200ms.
      window.setTimeout(() => {
        window.location.href = "/"
      }, 200)
    }, 2000)
    return () => window.clearTimeout(t)
  }, [etapa])

  function ir(novaEtapa: Etapa) {
    const dir: SlideDirection =
      ORDEM[novaEtapa] >= ORDEM[etapa] ? "forward" : "backward"
    setDirecao(dir)
    setEtapa(novaEtapa)
  }

  async function confirmar() {
    if (!data) return
    setErroEnvio(null)
    try {
      await registrarMut.mutateAsync({
        vrRetirado: digitosParaReal(vrDigitos),
        vtRetirado: digitosParaReal(vtDigitos),
      })
      ir("sucesso")
    } catch (err) {
      setErroEnvio(
        err instanceof Error
          ? err.message
          : "Erro ao registrar retirada. Tente novamente.",
      )
    }
  }

  if (!uuid) {
    return (
      <TelaErro
        titulo="Link inválido"
        mensagem="O link acessado não possui identificador."
      />
    )
  }

  if (isLoading) return <TelaCarregando />

  if (isError) {
    const status = (error as Error & { status?: number })?.status
    if (status === 404) {
      return (
        <TelaErro
          titulo="Link não encontrado"
          mensagem="Esse link de retirada manual não é válido ou expirou."
        />
      )
    }
    return (
      <TelaErro
        titulo="Erro ao carregar"
        mensagem="Não foi possível carregar os dados agora. Tente novamente em alguns minutos."
      />
    )
  }

  if (!data) return <TelaCarregando />

  return (
    <div className="relative z-10 min-h-svh">
      <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="glass-strong relative w-full max-w-xl p-5 sm:p-8 lg:p-10">
          {data.status === "registrado" ? (
            <TelaRegistrado dados={data} />
          ) : etapa === "sucesso" ? (
            <ToastSucesso />
          ) : (
            <SlideStack slideKey={etapa} direction={direcao}>
              {etapa === "vr" && (
                <EtapaValorBeneficio
                  dados={data}
                  tipo="VR"
                  valor={vrDigitos}
                  onChange={setVrDigitos}
                  onAvancar={() => ir("vt")}
                  onVoltar={() => ir("vr")}
                  podeVoltar={false}
                />
              )}
              {etapa === "vt" && (
                <EtapaValorBeneficio
                  dados={data}
                  tipo="VT"
                  registradoAnterior={{
                    tipo: "VR",
                    valor: digitosParaReal(vrDigitos),
                  }}
                  valor={vtDigitos}
                  onChange={setVtDigitos}
                  onAvancar={() => ir("confirmar")}
                  onVoltar={() => ir("vr")}
                  podeVoltar
                />
              )}
              {etapa === "confirmar" && (
                <EtapaConfirmar
                  dados={data}
                  vrDigitos={vrDigitos}
                  vtDigitos={vtDigitos}
                  carregando={registrarMut.isPending}
                  erro={erroEnvio}
                  onVoltar={() => ir("vt")}
                  onConfirmar={confirmar}
                />
              )}
            </SlideStack>
          )}
        </div>
      </div>
    </div>
  )
}

function ToastSucesso() {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="inline-flex size-14 items-center justify-center rounded-full bg-emerald-300/15 ring-1 ring-emerald-300/40">
        <CheckCircle2 className="size-7 text-emerald-700 dark:text-emerald-300" />
      </div>
      <p className="text-display text-2xl text-foreground">Retirada registrada</p>
      <p className="text-xs uppercase tracking-[0.28em] text-foreground/45">
        Fechando esta aba…
      </p>
    </div>
  )
}
