import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@/components/AuthContext"

// Guarda rotas de operador. Carregando -> tela neutra; sem usuario -> /login;
// logado mas perfil incompleto (1o acesso) -> onboarding.
export function RequireAuth() {
  const { usuario, carregando } = useAuth()

  if (carregando) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm opacity-70">
        Verificando acesso…
      </div>
    )
  }
  if (!usuario) return <Navigate to="/login" replace />
  if (!usuario.perfilCompleto) return <Navigate to="/completar-cadastro" replace />
  return <Outlet />
}
