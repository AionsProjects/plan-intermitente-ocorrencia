import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { BuscarPessoa } from "./BuscarPessoa"
import { EscolhaTipoTrabalhador } from "./EscolhaTipoTrabalhador"
import { PainelConvocacoes } from "./PainelConvocacoes"
import { ResumoSessao } from "./ResumoSessao"
import { TelaSucesso } from "./TelaSucesso"
import { WizardDocumento } from "./WizardDocumento"
import { useLancarDocumentos } from "./useAtestados"
import type {
  ConvocacaoResumida,
  DocumentoLancamento,
  EmpregadoRM,
  LancarDocumentosResultado,
  SessaoLancamento,
  TipoTrabalhador,
} from "./types"

type Etapa =
  | { tipo: "tipo-trabalhador" }
  | { tipo: "busca-pessoa"; tipoTrabalhador: "intermitente" }
  | {
      tipo: "convocacoes"
      tipoTrabalhador: "intermitente"
      empregado: EmpregadoRM
    }
  | {
      tipo: "wizard-intermitente"
      empregado: EmpregadoRM
      convocacao: ConvocacaoResumida
    }
  | { tipo: "wizard-clt" }
  | { tipo: "sucesso"; resultado: LancarDocumentosResultado; totalEnviado: number }

const ORDEM: Record<Etapa["tipo"], number> = {
  "tipo-trabalhador": 0,
  "busca-pessoa": 1,
  convocacoes: 2,
  "wizard-intermitente": 3,
  "wizard-clt": 3,
  sucesso: 4,
}

function etapaKey(e: Etapa): string {
  if (e.tipo === "convocacoes") return `conv-${e.empregado.chapa}`
  if (e.tipo === "wizard-intermitente")
    return `wiz-${e.empregado.chapa}-${e.convocacao.uuid}`
  if (e.tipo === "wizard-clt") return "wiz-clt"
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
    if (etapa.tipo === "convocacoes" || etapa.tipo === "wizard-intermitente") {
      ir({ tipo: "busca-pessoa", tipoTrabalhador: "intermitente" })
      return
    }
    if (etapa.tipo === "wizard-clt") {
      ir({ tipo: "tipo-trabalhador" })
      return
    }
    if (etapa.tipo === "busca-pessoa") {
      ir({ tipo: "tipo-trabalhador" })
      return
    }
    navigate("/")
  }

  function escolherTipoTrabalhador(tipo: TipoTrabalhador) {
    if (tipo === "intermitente") {
      ir({ tipo: "busca-pessoa", tipoTrabalhador: "intermitente" })
    } else {
      ir({ tipo: "wizard-clt" })
    }
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
      return (
        <BuscarPessoa
          onSelecionar={(empregado) =>
            ir({
              tipo: "convocacoes",
              tipoTrabalhador: "intermitente",
              empregado,
            })
          }
        />
      )
    }
    if (etapa.tipo === "convocacoes") {
      return (
        <PainelConvocacoes
          empregado={etapa.empregado}
          onSelecionar={(convocacao) =>
            ir({
              tipo: "wizard-intermitente",
              empregado: etapa.empregado,
              convocacao,
            })
          }
        />
      )
    }
    if (etapa.tipo === "wizard-intermitente") {
      return (
        <WizardDocumento
          modo="intermitente"
          empregado={etapa.empregado}
          convocacao={etapa.convocacao}
          documentosSessao={sessao.documentos}
          onCancelar={() =>
            ir({
              tipo: "convocacoes",
              tipoTrabalhador: "intermitente",
              empregado: etapa.empregado,
            })
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
          empregado={null}
          convocacao={null}
          documentosSessao={sessao.documentos}
          onCancelar={() => ir({ tipo: "tipo-trabalhador" })}
          onAdicionar={(doc) => {
            adicionarDocumentoSessao(doc)
            ir({ tipo: "tipo-trabalhador" })
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

  const mostrarVoltar = etapa.tipo !== "sucesso"

  return (
    <div className="relative z-10 min-h-svh">
      <div className="flex justify-center px-4 py-12">
        <div className="glass-strong relative w-full max-w-2xl p-8 sm:p-10 fade-up">
          {mostrarVoltar && (
            <button
              type="button"
              onClick={voltarParaEtapa}
              className="mb-6 inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/85"
            >
              <ArrowLeft className="size-3.5" />
              Voltar
            </button>
          )}
          <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
            {renderEtapa()}
          </SlideStack>

          {erroEnvio && (
            <p className="mt-6 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-center text-sm text-rose-100">
              {erroEnvio}
            </p>
          )}
        </div>
      </div>

      <ResumoSessao
        sessao={sessao}
        enviando={lancarMutation.isPending}
        open={resumoAberto}
        onAbrir={() => setResumoAberto(true)}
        onFechar={() => setResumoAberto(false)}
        onRemover={removerDocumentoSessao}
        onConcluir={() => void concluirEnvio()}
      />
    </div>
  )
}
