import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/components/AuthContext"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatarCpf } from "@/lib/cpf"
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

export function LoginPage() {
  const { usuario, carregando, login, erroGoogle } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [modo, setModo] = useState<Modo>("email")
  const [identificador, setIdentificador] = useState("")
  const [senha, setSenha] = useState("")

  // Ja logado: perfil completo -> hub; incompleto -> onboarding.
  useEffect(() => {
    if (carregando || !usuario) return
    navigate(usuario.perfilCompleto ? "/" : "/completar-cadastro", { replace: true })
  }, [carregando, usuario, navigate])

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
      <section className="glass-strong relative w-full max-w-md overflow-hidden px-6 py-9 text-center sm:px-9 sm:py-11">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <h1 className="text-display text-3xl leading-[1.05] text-foreground sm:text-4xl">
          Entrar
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-foreground/58">
          Use seu email ou CPF e senha. No primeiro acesso, entre com o Google para criar
          a conta.
        </p>

        <form onSubmit={enviar} className="mt-7 flex flex-col gap-4 text-left">
          {/* Toggle Email | CPF */}
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card/40 p-1">
            {(["email", "cpf"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => trocarModo(m)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  modo === m
                    ? "bg-[rgb(var(--accent-rgb)/0.16)] text-foreground"
                    : "text-foreground/55 hover:text-foreground/80"
                }`}
              >
                {m === "email" ? "Email" : "CPF"}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ident">{modo === "email" ? "Email" : "CPF"}</Label>
            <Input
              id="ident"
              type={modo === "email" ? "email" : "text"}
              inputMode={modo === "cpf" ? "numeric" : "email"}
              placeholder={modo === "email" ? "voce@contatoserv.com.br" : "000.000.000-00"}
              value={modo === "cpf" ? formatarCpf(identificador) : identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              autoComplete={modo === "email" ? "username" : "off"}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {erroMsg && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erroMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={mut.isPending}
            className="glass-tile glass-tile-3d group mt-1 flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-3.5 text-base font-medium text-foreground/95 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
          >
            {mut.isPending ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {erroGoogle && (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {MENSAGEM_ERRO_GOOGLE[erroGoogle] ?? "Não foi possível entrar com o Google."}
          </p>
        )}

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-foreground/35">
          <span className="h-px flex-1 bg-border" />
          ou
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={login}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card/40 px-5 py-3.5 text-base font-medium text-foreground/90 transition hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
        >
          <GoogleIcon className="size-5" />
          Entrar com Google
        </button>
      </section>
    </main>
  )
}
