import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@/components/AuthContext"
import { temNivel, type Papel } from "@/features/auth/types"

// Guarda por papel. Use `papeis` (lista explicita) OU `nivelMinimo` (hierarquia).
// Ex.: <RequireRole nivelMinimo="dp" /> libera dp + admin.
type Props =
  | { papeis: Papel[]; nivelMinimo?: never }
  | { nivelMinimo: Papel; papeis?: never }

export function RequireRole(props: Props) {
  const { usuario, carregando } = useAuth()

  if (carregando) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm opacity-70">
        Verificando acesso…
      </div>
    )
  }
  if (!usuario) return <Navigate to="/login" replace />

  const ok =
    "papeis" in props && props.papeis
      ? props.papeis.includes(usuario.papel)
      : temNivel(usuario.papel, props.nivelMinimo!)

  if (!ok) return <Navigate to="/" replace />
  return <Outlet />
}
