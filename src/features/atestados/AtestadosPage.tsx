import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useRegistrarVoltar } from "@/components/NavContext"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { BuscarPessoa } from "./BuscarPessoa"
import { EscolhaTipoTrabalhador } from "./EscolhaTipoTrabalhador"
import { ResumoSessao } from "./ResumoSessao"
import { TelaSucesso } from "./TelaSucesso"
import { WizardDocumento } from "./WizardDocumento"
import { useLancarDocumentos } from "./useAtestados"
import type {
  DocumentoLancamento,
  EmpregadoRM,
  LancarDocumentosResultado,
  SessaoLancamento,
  TipoTrabalhador,
} from "./types"

type Etapa =
  | { tipo: "tipo-trabalhador" }
  | { tipo: "busca-pessoa"; tipoTrabalhador: TipoTrabalhador }
  | {
      tipo: "wizard-intermitente"
      empregado: EmpregadoRM
    }
  | {
      tipo: "wizard-clt"
      empregado: EmpregadoRM
    }
  | { tipo: "sucesso"; resultado: LancarDocumentosResultado; totalEnviado: number }

const ORDEM: Record<Etapa["tipo"], number> = {
  "tipo-trabalhador": 0,
  "busca-pessoa": 1,
  "wizard-intermitente": 2,
  "wizard-clt": 2,
  sucesso: 3,
}

function etapaKey(e: Etapa): string {
  if (e.tipo === "wizard-intermitente") return `wiz-${e.empregado.chapa}`
  if (e.tipo === "wizard-clt") return `wiz-clt-${e.empregado.chapa}`
  if (e.tipo === "sucesso") return "sucesso"
  if (e.tipo === "busca-pessoa") return `busca-${e.tipoTrabalhador}`
  return "tipo-trabalhador"
}

export function AtestadosPage() {
  const navigate = useNavigate()
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "tipo-trabalhador" })
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const ultimaOrdemRef = useRef<number>(0)

  const [sessao, setSessao] = useState<SessaoLancamento>({ documentos: [] })
  const [resumoAberto, setResumoAberto] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)

  // Auto-clear do erro após 5s. Cleanup cancela timer se erro muda
  // ou componente desmonta — evita state update órfão.
  useEffect(() => {
    if (!erroEnvio) return
    // Garante que dialog do Resumo abre pra mostrar o erro
    setResumoAberto(true)
    const t = window.setTimeout(() => setErroEnvio(null), 5000)
    return () => window.clearTimeout(t)
  }, [erroEnvio])

  const lancarMutation = useLancarDocumentos()

  function ir(nova: Etapa) {
    const novaOrdem = ORDEM[nova.tipo]
    let dir: SlideDirection = "forward"
    if (
      novaOrdem < ultimaOrdemRef.current &&
      !(ultimaOrdemRef.current === ORDEM.sucesso && nova.tipo === "tipo-trabalhador")
    ) {
      dir = "backward"
    }
    setDirecao(dir)
    ultimaOrdemRef.current = novaOrdem
    setEtapa(nova)
  }

  function voltarParaEtapa() {
    if (etapa.tipo === "wizard-intermitente") {
      ir({ tipo: "busca-pessoa", tipoTrabalhador: "intermitente" })
      return
    }
    if (etapa.tipo === "wizard-clt") {
      ir({ tipo: "busca-pessoa", tipoTrabalhador: "clt" })
      return
    }
    if (etapa.tipo === "busca-pessoa") {
      ir({ tipo: "tipo-trabalhador" })
      return
    }
    navigate("/")
  }

  function escolherTipoTrabalhador(tipo: TipoTrabalhador) {
    ir({ tipo: "busca-pessoa", tipoTrabalhador: tipo })
  }

  function adicionarDocumentoSessao(doc: DocumentoLancamento) {
    setSessao((prev) => ({
      documentos: [...prev.documentos, doc],
      ultimaPessoa: { chapa: doc.chapa, nome: doc.empregadoNome },
    }))
    setResumoAberto(true)
  }

  function removerDocumentoSessao(id: string) {
    setSessao((prev) => ({
      ...prev,
      documentos: prev.documentos.filter((d) => d.id !== id),
    }))
  }

  async function concluirEnvio() {
    setErroEnvio(null)
    try {
      const resultado = await lancarMutation.mutateAsync(sessao.documentos)
      const total = sessao.documentos.length
      setResumoAberto(false)
      setSessao({ documentos: [] })
      ir({ tipo: "sucesso", resultado, totalEnviado: total })
    } catch (err) {
      setErroEnvio(
        err instanceof Error
          ? err.message
          : "Erro ao enviar documentos. Tente novamente.",
      )
    }
  }

  function renderEtapa(): React.ReactNode {
    if (etapa.tipo === "tipo-trabalhador") {
      return <EscolhaTipoTrabalhador onSelecionar={escolherTipoTrabalhador} />
    }
    if (etapa.tipo === "busca-pessoa") {
      const tipoCorrente = etapa.tipoTrabalhador
      return (
        <BuscarPessoa
          tipoTrabalhador={tipoCorrente}
          onSelecionar={(empregado) =>
            ir(
              tipoCorrente === "clt"
                ? { tipo: "wizard-clt", empregado }
                : { tipo: "wizard-intermitente", empregado },
            )
          }
        />
      )
    }
    if (etapa.tipo === "wizard-intermitente") {
      return (
        <WizardDocumento
          modo="intermitente"
          empregado={etapa.empregado}
          convocacao={null}
          documentosSessao={sessao.documentos}
          onCancelar={() =>
            ir({ tipo: "busca-pessoa", tipoTrabalhador: "intermitente" })
          }
          onAdicionar={(doc) => {
            adicionarDocumentoSessao(doc)
            ir({ tipo: "busca-pessoa", tipoTrabalhador: "intermitente" })
          }}
        />
      )
    }
    if (etapa.tipo === "wizard-clt") {
      return (
        <WizardDocumento
          modo="clt"
          empregado={etapa.empregado}
          convocacao={null}
          documentosSessao={sessao.documentos}
          onCancelar={() => ir({ tipo: "busca-pessoa", tipoTrabalhador: "clt" })}
          onAdicionar={(doc) => {
            adicionarDocumentoSessao(doc)
            ir({ tipo: "busca-pessoa", tipoTrabalhador: "clt" })
          }}
        />
      )
    }
    return (
      <TelaSucesso
        resultado={etapa.resultado}
        totalEnviado={etapa.totalEnviado}
        onNovaSessao={() => ir({ tipo: "tipo-trabalhador" })}
      />
    )
  }

  // Wizard tem botão Voltar próprio (navega entre etapas internas). Esconde
  // o Voltar global pra não duplicar visualmente.
  const mostrarVoltar =
    etapa.tipo !== "sucesso" &&
    etapa.tipo !== "wizard-intermitente" &&
    etapa.tipo !== "wizard-clt"

  useRegistrarVoltar(mostrarVoltar ? voltarParaEtapa : null)

  return (
    <div className="relative z-10 min-h-svh">
      <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="glass-strong card-shimmer relative w-full max-w-2xl p-5 sm:p-8 lg:p-10">
          <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
            {renderEtapa()}
          </SlideStack>
        </div>
      </div>

      <ResumoSessao
        sessao={sessao}
        enviando={lancarMutation.isPending}
        open={resumoAberto}
        erro={erroEnvio}
        onAbrir={() => setResumoAberto(true)}
        onFechar={() => {
          setResumoAberto(false)
          // Limpa erro ao fechar manual (sem esperar timer 5s)
          if (erroEnvio) setErroEnvio(null)
        }}
        onRemover={removerDocumentoSessao}
        onConcluir={() => void concluirEnvio()}
      />
    </div>
  )
}
