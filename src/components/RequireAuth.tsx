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
  return (
    <>
      {/* Assinatura visual do console (mesma do hub): orbes do accent respirando
          atrás do conteúdo, em todas as telas de operador. */}
      <div
        aria-hidden
        className="hub-orb pointer-events-none fixed left-1/2 top-1/2 z-0 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
      />
      <div
        aria-hidden
        className="hub-orb hub-orb--b pointer-events-none fixed left-[62%] top-[38%] z-0 size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
      />
      <Outlet />
    </>
  )
}
