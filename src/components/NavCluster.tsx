import { ArrowLeft, Home, Settings2 } from "lucide-react"
import { Link } from "react-router-dom"

import { useNav } from "./NavContext"

/**
 * Balão de navegação GLOBAL — fixo no topo-direito, flutua sobre o conteúdo
 * em todas as telas. Liquid glass (.nav-cluster + .nav-btn no index.css).
 *
 * - Voltar etapa: vem do contexto (página registra via useRegistrarVoltar).
 *   null/undefined → desabilitado.
 * - Home: link pro destino do contexto (default "/").
 * - Config: abre o overlay de configurações (não navega).
 */
export function NavCluster() {
  const { voltar, podeVoltar, homeTo, abrirConfig } = useNav()
  return (
    <div className="nav-cluster nav-cluster-fixed">
      <button
        type="button"
        onClick={voltar}
        disabled={!podeVoltar}
        className="nav-btn nav-btn-prev"
        aria-label="Voltar etapa anterior"
        title={podeVoltar ? "Voltar etapa anterior" : "Sem etapa anterior"}
      >
        <ArrowLeft className="size-4" />
      </button>
      <span className="nav-divider" aria-hidden />
      <Link
        to={homeTo}
        className="nav-btn nav-btn-home"
        aria-label="Ir para a página inicial"
        title="Voltar ao Hub"
      >
        <Home className="size-4" />
      </Link>
      <span className="nav-divider" aria-hidden />
      <button
        type="button"
        onClick={abrirConfig}
        className="nav-btn"
        aria-label="Configurações"
        title="Configurações"
      >
        <Settings2 className="size-4" />
      </button>
    </div>
  )
}
