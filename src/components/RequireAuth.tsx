import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/components/AuthContext"
import { loginCom } from "@/lib/proximaUrl"

// Guarda rotas de operador. Carregando -> tela neutra; sem usuario -> /login;
// logado mas perfil incompleto (1o acesso) -> onboarding.
export function RequireAuth() {
  const { usuario, carregando } = useAuth()
  const location = useLocation()

  if (carregando) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm opacity-70">
        Verificando acesso…
      </div>
    )
  }
  // Guarda o destino: o link do alerta de erro chega por WhatsApp e é aberto no
  // celular, onde a sessão costuma estar expirada. Sem o `next` a URL era descartada e
  // a pessoa caía no hub, perdendo a execução que ia investigar.
  if (!usuario) {
    return <Navigate to={loginCom(location.pathname + location.search + location.hash)} replace />
  }
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
