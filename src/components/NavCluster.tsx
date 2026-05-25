import { ArrowLeft, Home } from "lucide-react"
import { Link } from "react-router-dom"

/**
 * Cluster pill no header de páginas internas — voltar etapa + Home.
 * Liquid glass aesthetic (.nav-cluster + .nav-btn definidos em index.css).
 *
 * Comportamento:
 * - `onVoltar` ausente OU `null` → botão ← fica disabled (página
 *   single-step ou primeira etapa de wizard). Só Home funciona.
 * - `onVoltar` definido → botão ← chama o handler (volta 1 etapa).
 * - Home: link absoluto pra "/" (Hub).
 *
 * Pages multi-step passam mapping próprio (ex: PontoFacultativoPage
 * tem etapaAnterior). Pages single-step (TestePage, DescontosPage)
 * passam `onVoltar={null}` e só ganham Home funcional.
 */
type Props = {
  /** Handler pra voltar 1 etapa interna. null/undefined = desabilita. */
  onVoltar?: (() => void) | null
  /** Override do destino do Home (default "/"). */
  homeTo?: string
  /** Label aria do botão voltar (default "Voltar etapa anterior"). */
  voltarLabel?: string
}

export function NavCluster({
  onVoltar,
  homeTo = "/",
  voltarLabel = "Voltar etapa anterior",
}: Props) {
  const podeVoltar = typeof onVoltar === "function"
  return (
    <div className="nav-cluster shrink-0">
      <button
        type="button"
        onClick={() => onVoltar?.()}
        disabled={!podeVoltar}
        className="nav-btn nav-btn-prev"
        aria-label={voltarLabel}
        title={podeVoltar ? voltarLabel : "Sem etapa anterior"}
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
    </div>
  )
}
