import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { LogOut } from "lucide-react"

import { useAuth } from "@/components/AuthContext"
import { useNav } from "@/components/NavContext"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatarCpf } from "@/lib/cpf"
import { PAPEL_LABEL } from "@/features/auth/types"

const SENHA_MIN = 8

const MSG_ERRO: Record<string, string> = {
  senha_atual_incorreta: "Senha atual incorreta.",
  senha_curta: `A nova senha precisa de pelo menos ${SENHA_MIN} caracteres.`,
  sem_senha: "Esta conta ainda não tem senha definida.",
  nao_autenticado: "Sessão expirada. Entre de novo.",
}

async function mudarSenha(body: { senha_atual: string; nova_senha: string }): Promise<void> {
  const res = await fetch("/auth/mudar-senha", {
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

function iniciais(nome: string, sobrenome: string | null): string {
  const a = nome.trim()[0] ?? ""
  const b = sobrenome?.trim()[0] ?? ""
  return (a + b).toUpperCase() || "?"
}

export function ContaTab() {
  const { usuario, logout } = useAuth()
  const { fecharConfig } = useNav()
  const navigate = useNavigate()

  const [atual, setAtual] = useState("")
  const [nova, setNova] = useState("")
  const [nova2, setNova2] = useState("")

  const mut = useMutation({
    mutationFn: mudarSenha,
    onSuccess: () => {
      setAtual("")
      setNova("")
      setNova2("")
    },
  })

  if (!usuario) return null

  const novaOk = nova.length >= SENHA_MIN
  const conferem = nova === nova2
  const formOk = atual.length > 0 && novaOk && conferem
  const erroMsg = mut.isError
    ? (MSG_ERRO[(mut.error as Error & { erro?: string }).erro ?? ""] ??
       "Não foi possível trocar a senha.")
    : null

  async function sair() {
    await logout()
    fecharConfig()
    navigate("/login", { replace: true })
  }

  return (
    <div className="space-y-4">
      {/* Perfil (so leitura) */}
      <section className="rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-full bg-[rgb(var(--accent-rgb)/0.16)] text-lg font-semibold text-[rgb(var(--accent-rgb))] ring-1 ring-[rgb(var(--accent-rgb)/0.4)]">
            {iniciais(usuario.nome, usuario.sobrenome)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-foreground">
              {usuario.nome} {usuario.sobrenome ?? ""}
            </p>
            <p className="truncate text-sm text-foreground/60">{usuario.email}</p>
            <span className="mt-1 inline-block rounded-full bg-[rgb(var(--accent-rgb)/0.14)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--accent-rgb))]">
              {PAPEL_LABEL[usuario.papel]}
            </span>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-foreground/45">CPF</dt>
            <dd className="text-foreground/80">
              {usuario.cpf ? formatarCpf(usuario.cpf) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-foreground/45">Função</dt>
            <dd className="text-foreground/80">{PAPEL_LABEL[usuario.papel]}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-foreground/45">
          Dados pessoais não podem ser editados aqui. Fale com um administrador.
        </p>
      </section>

      {/* Trocar senha */}
      <section className="rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-4 sm:p-5">
        <h3 className="text-sm font-medium text-foreground">Trocar senha</h3>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (formOk) mut.mutate({ senha_atual: atual, nova_senha: nova })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="atual">Senha atual</Label>
            <Input id="atual" type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nova">Nova senha</Label>
            <Input id="nova" type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" aria-invalid={nova.length > 0 && !novaOk} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nova2">Confirmar nova senha</Label>
            <Input id="nova2" type="password" value={nova2} onChange={(e) => setNova2(e.target.value)} autoComplete="new-password" aria-invalid={nova2.length > 0 && !conferem} />
          </div>

          {nova.length > 0 && !novaOk && (
            <p className="text-xs text-destructive">Mínimo {SENHA_MIN} caracteres.</p>
          )}
          {nova2.length > 0 && !conferem && (
            <p className="text-xs text-destructive">As senhas não conferem.</p>
          )}
          {erroMsg && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erroMsg}</p>
          )}
          {mut.isSuccess && (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">Senha alterada.</p>
          )}

          <button
            type="submit"
            disabled={!formOk || mut.isPending}
            className="w-full rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-foreground transition hover:border-[rgb(var(--accent-rgb)/0.4)] disabled:pointer-events-none disabled:opacity-50"
          >
            {mut.isPending ? "Salvando…" : "Trocar senha"}
          </button>
        </form>
      </section>

      {/* Sair */}
      <button
        type="button"
        onClick={sair}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm font-medium text-destructive transition hover:bg-destructive/20"
      >
        <LogOut className="size-4" />
        Sair
      </button>
    </div>
  )
}
