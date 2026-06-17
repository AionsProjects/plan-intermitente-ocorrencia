import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, UserPlus } from "lucide-react"

import { useAuth } from "@/components/AuthContext"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cpfValido, formatarCpf, soDigitos } from "@/lib/cpf"
import { PAPEIS_CADASTRO, type Papel } from "@/features/auth/types"

type PapelCadastro = (typeof PAPEIS_CADASTRO)[number]["valor"]

const SENHA_MIN = 8

async function completarCadastro(body: {
  nome: string
  sobrenome: string
  cpf: string
  papel: PapelCadastro
  senha: string
}): Promise<void> {
  const res = await fetch("/auth/completar-cadastro", {
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
  cpf_duplicado: "Este CPF já está cadastrado em outra conta.",
  cpf_invalido: "CPF inválido. Confira os dígitos.",
  nome_obrigatorio: "Preencha nome e sobrenome.",
  papel_invalido: "Selecione uma função.",
  senha_curta: `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`,
}

export function CompletarCadastroPage() {
  const { usuario, carregando } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [nome, setNome] = useState("")
  const [sobrenome, setSobrenome] = useState("")
  const [cpf, setCpf] = useState("")
  const [senha, setSenha] = useState("")
  const [senha2, setSenha2] = useState("")
  // Admin/DP pre-existentes mantem o papel — escondemos a escolha; demais escolhem.
  const jaElevado = usuario?.papel === "admin" || usuario?.papel === "dp"
  const [papel, setPapel] = useState<PapelCadastro>("operacional")

  // Sem login -> /login. Perfil ja completo -> hub.
  useEffect(() => {
    if (carregando) return
    if (!usuario) navigate("/login", { replace: true })
    else if (usuario.perfilCompleto) navigate("/", { replace: true })
  }, [carregando, usuario, navigate])

  const mut = useMutation({
    mutationFn: completarCadastro,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth"] })
      navigate("/", { replace: true })
    },
  })

  const cpfOk = useMemo(() => cpfValido(cpf), [cpf])
  const senhaOk = senha.length >= SENHA_MIN
  const senhasConferem = senha === senha2
  const formOk =
    nome.trim().length > 0 && sobrenome.trim().length > 0 && cpfOk &&
    senhaOk && senhasConferem && (jaElevado || !!papel)

  const erroMsg = mut.isError
    ? (MENSAGEM_ERRO[(mut.error as Error & { erro?: string }).erro ?? ""] ??
       "Não foi possível salvar. Tente de novo.")
    : null

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!formOk) return
    mut.mutate({
      nome: nome.trim(),
      sobrenome: sobrenome.trim(),
      cpf: soDigitos(cpf),
      papel: papel as Papel as PapelCadastro,
      senha,
    })
  }

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <section className="glass-strong relative w-full max-w-md overflow-hidden px-6 py-8 sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <h1 className="text-display text-3xl leading-[1.05] text-foreground sm:text-4xl">
          Complete seu cadastro
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/58">
          {usuario?.email
            ? <>Conta <span className="text-foreground/80">{usuario.email}</span>. Confirme seus dados para continuar.</>
            : "Confirme seus dados para continuar."}
        </p>

        <form onSubmit={enviar} className="mt-7 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="given-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sobrenome">Sobrenome</Label>
              <Input id="sobrenome" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} autoComplete="family-name" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cpf">CPF</Label>
            <Input
              id="cpf"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={formatarCpf(cpf)}
              onChange={(e) => setCpf(e.target.value)}
              aria-invalid={cpf.length > 0 && !cpfOk}
            />
            {cpf.length > 0 && !cpfOk && (
              <span className="text-xs text-destructive">CPF inválido.</span>
            )}
          </div>

          {!jaElevado && (
            <div className="flex flex-col gap-2">
              <Label>Função</Label>
              <div className="grid grid-cols-2 gap-2.5">
                {PAPEIS_CADASTRO.map((p) => {
                  const ativo = papel === p.valor
                  return (
                    <button
                      type="button"
                      key={p.valor}
                      onClick={() => setPapel(p.valor)}
                      className={`glass-tile rounded-xl px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)] ${
                        ativo ? "ring-2 ring-[rgb(var(--accent-rgb)/0.6)]" : "opacity-80"
                      }`}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground/95">{p.label}</span>
                        {ativo && <Check className="size-4 text-[rgb(var(--accent-rgb))]" />}
                      </span>
                      <span className="mt-1 block text-xs leading-snug text-foreground/50">{p.descricao}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
                aria-invalid={senha.length > 0 && !senhaOk}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="senha2">Confirmar senha</Label>
              <Input
                id="senha2"
                type="password"
                value={senha2}
                onChange={(e) => setSenha2(e.target.value)}
                autoComplete="new-password"
                aria-invalid={senha2.length > 0 && !senhasConferem}
              />
            </div>
          </div>
          {senha.length > 0 && !senhaOk && (
            <span className="text-xs text-destructive">
              A senha precisa de pelo menos {SENHA_MIN} caracteres.
            </span>
          )}
          {senha2.length > 0 && !senhasConferem && (
            <span className="text-xs text-destructive">As senhas não conferem.</span>
          )}

          {erroMsg && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erroMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={!formOk || mut.isPending}
            className="glass-tile glass-tile-3d group mt-2 flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-medium text-foreground/95 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            <UserPlus className="size-4.5 text-[rgb(var(--accent-rgb))]" />
            {mut.isPending ? "Salvando…" : "Concluir cadastro"}
          </button>
        </form>
      </section>
    </main>
  )
}
