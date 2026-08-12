import { useEffect, useState } from "react"
import type { MouseEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/components/AuthContext"
import { formatarCpf } from "@/lib/cpf"
import { proximaUrlSegura } from "@/lib/proximaUrl"
import { GoogleIcon } from "@/features/auth/GoogleIcon"

type Modo = "email" | "cpf"

async function loginLocal(body: { identificador: string; senha: string }): Promise<void> {
  const res = await fetch("/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { erro?: string }
    const err = new Error(data.erro ?? `erro_${res.status}`) as Error & { erro?: string }
    err.erro = data.erro
    throw err
  }
}

const MENSAGEM_ERRO: Record<string, string> = {
  conta_inexistente: "Conta não encontrada. Crie sua conta entrando com o Google primeiro.",
  sem_senha: "Esta conta ainda não tem senha. Entre com o Google para defini-la.",
  credenciais_invalidas: "Email/CPF ou senha incorretos.",
  conta_desativada: "Conta desativada. Fale com um administrador.",
  campos_obrigatorios: "Preencha login e senha.",
}

const MENSAGEM_ERRO_GOOGLE: Record<string, string> = {
  dominio_nao_permitido: "Use uma conta @contatoserv.com.br. Contas de fora não têm acesso.",
  email_nao_verificado: "Email Google não verificado.",
  conta_desativada: "Conta desativada. Fale com um administrador.",
  state_invalido: "Sessão de login expirou. Tente de novo.",
  erro_interno: "Erro no login com Google. Tente de novo.",
}

function tiltMove(e: MouseEvent<HTMLButtonElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", String(((e.clientX - r.left) / r.width) * 100))
  e.currentTarget.style.setProperty("--my", String(((e.clientY - r.top) / r.height) * 100))
}
function tiltLeave(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.setProperty("--mx", "50")
  e.currentTarget.style.setProperty("--my", "50")
}

export function LoginPage() {
  const { usuario, carregando, login, erroGoogle } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const qc = useQueryClient()

  const [modo, setModo] = useState<Modo>("email")
  const [identificador, setIdentificador] = useState("")
  const [senha, setSenha] = useState("")

  // Ja logado: perfil completo -> destino (`?next=`, default hub); incompleto -> onboarding.
  //
  // O `next` vem do RequireAuth e é o que faz o link do alerta de erro sobreviver a
  // sessão expirada — sem ele a pessoa cai no hub e perde a execução que ia investigar.
  // `proximaUrlSegura` recusa URL absoluta e `//host`: sem essa validação o `?next=`
  // seria um open redirect em cima da tela de login.
  const proximo = proximaUrlSegura(params.get("next"))
  useEffect(() => {
    if (carregando || !usuario) return
    if (!usuario.perfilCompleto) {
      // Onboarding primeiro; o destino é preservado pra depois dele.
      navigate(proximo ? `/completar-cadastro?next=${encodeURIComponent(proximo)}` : "/completar-cadastro", { replace: true })
      return
    }
    navigate(proximo ?? "/", { replace: true })
  }, [carregando, usuario, navigate, proximo])

  const mut = useMutation({
    mutationFn: loginLocal,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth"] })
      // o effect acima cuida do redirect quando o /auth/me atualizar
    },
  })

  const erroMsg = mut.isError
    ? (MENSAGEM_ERRO[(mut.error as Error & { erro?: string }).erro ?? ""] ??
       "Não foi possível entrar. Tente de novo.")
    : null

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    const ident = modo === "cpf" ? identificador.replace(/\D/g, "") : identificador.trim()
    if (!ident || !senha) return
    mut.mutate({ identificador: ident, senha })
  }

  function trocarModo(m: Modo) {
    setModo(m)
    setIdentificador("")
  }

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <section className="glass-panel fade-up w-full max-w-[400px] px-6 py-9 text-center sm:px-9 sm:py-10">
        <p className="eyebrow">Aionscorp</p>
        <h1 className="text-display mt-2.5 text-[34px] leading-[1.05] text-foreground">
          Entrar
        </h1>
        <p className="mx-auto mt-3 max-w-[280px] text-[13px] leading-[1.55] text-foreground/55">
          Use seu email ou CPF e senha. No primeiro acesso, entre com o Google para criar
          a conta.
        </p>

        <form onSubmit={enviar} className="mt-[22px] flex flex-col gap-3.5 text-left">
          {/* Toggle Email | CPF — segmented pill afundado */}
          <div className="seg-pill">
            {(["email", "cpf"] as const).map((m) => (
              <button
                type="button"
                key={m}
                data-on={modo === m}
                onClick={() => trocarModo(m)}
              >
                {m === "email" ? "Email" : "CPF"}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ident" className="text-[11px] font-medium text-foreground/68">
              {modo === "email" ? "Email" : "CPF"}
            </label>
            <div className="glass-field">
              <input
                id="ident"
                type={modo === "email" ? "email" : "text"}
                inputMode={modo === "cpf" ? "numeric" : "email"}
                placeholder={modo === "email" ? "voce@contatoserv.com.br" : "000.000.000-00"}
                value={modo === "cpf" ? formatarCpf(identificador) : identificador}
                onChange={(e) => setIdentificador(e.target.value)}
                autoComplete={modo === "email" ? "username" : "off"}
                className="text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="senha" className="text-[11px] font-medium text-foreground/68">
              Senha
            </label>
            <div className="glass-field">
              <input
                id="senha"
                type="password"
                placeholder="••••••••"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                className="text-sm"
              />
            </div>
          </div>

          {erroMsg && (
            <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erroMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={mut.isPending}
            onMouseMove={tiltMove}
            onMouseLeave={tiltLeave}
            className="glass-cta tilt-3d--suave tilt-3d mt-2 w-full py-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
          >
            {mut.isPending ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {erroGoogle && (
          <p className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            {MENSAGEM_ERRO_GOOGLE[erroGoogle] ?? "Não foi possível entrar com o Google."}
          </p>
        )}

        <div className="my-5 flex items-center gap-2.5 text-[10px] uppercase tracking-[0.2em] text-foreground/38">
          <span className="h-px flex-1 bg-[rgb(var(--ink)/0.12)]" />
          ou
          <span className="h-px flex-1 bg-[rgb(var(--ink)/0.12)]" />
        </div>

        <button
          type="button"
          onClick={login}
          className="pill-soft w-full px-5 py-[13px] text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
        >
          <GoogleIcon className="size-4" />
          Entrar com Google
        </button>
      </section>
    </main>
  )
}
