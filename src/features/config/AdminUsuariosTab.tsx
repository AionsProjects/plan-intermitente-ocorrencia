import { useState } from "react"
import { Check, KeyRound, Pencil, X } from "lucide-react"

import { useAuth } from "@/components/AuthContext"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cpfValido, formatarCpf, soDigitos } from "@/lib/cpf"
import { PAPEIS, PAPEL_LABEL, type Papel } from "@/features/auth/types"
import {
  useAtualizarUsuario,
  useRedefinirSenha,
  useUsuarios,
  type UsuarioAdmin,
} from "./useUsuarios"

const SENHA_MIN = 8

const MSG_ERRO: Record<string, string> = {
  cpf_duplicado: "CPF já usado por outra conta.",
  cpf_invalido: "CPF inválido.",
  nome_obrigatorio: "Nome não pode ficar vazio.",
  senha_curta: `Senha precisa de ${SENHA_MIN}+ caracteres.`,
}

function LinhaUsuario({ u, ehVoce }: { u: UsuarioAdmin; ehVoce: boolean }) {
  const atualizar = useAtualizarUsuario()
  const redefinir = useRedefinirSenha()
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(u.nome)
  const [sobrenome, setSobrenome] = useState(u.sobrenome ?? "")
  const [cpf, setCpf] = useState(u.cpf ?? "")
  const [novaSenha, setNovaSenha] = useState("")

  const cpfOk = cpfValido(cpf)
  const podeSalvar = nome.trim().length > 0 && cpfOk

  const erro =
    (atualizar.error as (Error & { erro?: string }) | null)?.erro ??
    (redefinir.error as (Error & { erro?: string }) | null)?.erro
  const erroMsg = erro ? (MSG_ERRO[erro] ?? "Erro ao salvar.") : null

  function cancelar() {
    setNome(u.nome)
    setSobrenome(u.sobrenome ?? "")
    setCpf(u.cpf ?? "")
    setNovaSenha("")
    atualizar.reset()
    redefinir.reset()
    setEditando(false)
  }

  async function salvar() {
    if (!podeSalvar) return
    await atualizar.mutateAsync({
      id: u.id,
      nome: nome.trim(),
      sobrenome: sobrenome.trim(),
      cpf: soDigitos(cpf),
    })
    if (novaSenha.length >= SENHA_MIN) {
      await redefinir.mutateAsync({ id: u.id, nova_senha: novaSenha })
    }
    setNovaSenha("")
    setEditando(false)
  }

  return (
    <div className="rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {u.nome} {u.sobrenome ?? ""}{" "}
            {ehVoce && <span className="text-foreground/45">(você)</span>}
          </p>
          <p className="truncate text-xs text-foreground/55">{u.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!editando && !ehVoce && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              title="Editar"
              className="rounded-lg border border-border p-1.5 text-foreground/60 transition hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {/* Toggle ativo */}
          <button
            type="button"
            role="switch"
            aria-checked={u.ativo}
            disabled={ehVoce || atualizar.isPending}
            onClick={() => atualizar.mutate({ id: u.id, ativo: !u.ativo })}
            title={ehVoce ? "Você não pode se desativar" : u.ativo ? "Ativo" : "Inativo"}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${
              u.ativo ? "bg-[rgb(var(--accent-rgb)/0.7)]" : "bg-[rgb(var(--ink)/0.15)]"
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                u.ativo ? "left-[1.375rem]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Funcao (sempre visivel) */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-foreground/50">Função:</span>
        <Select
          value={u.papel}
          disabled={ehVoce || atualizar.isPending}
          onValueChange={(v) => atualizar.mutate({ id: u.id, papel: v as Papel })}
        >
          <SelectTrigger size="sm" className="min-w-[9rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAPEIS.map((p) => (
              <SelectItem key={p} value={p}>
                {PAPEL_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!editando && u.ultimo_login && (
          <span className="ml-auto text-[11px] text-foreground/40">
            {new Date(u.ultimo_login).toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>

      {/* Edicao de dados pessoais + senha */}
      {editando && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`n-${u.id}`} className="text-xs">Nome</Label>
              <Input id={`n-${u.id}`} value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`s-${u.id}`} className="text-xs">Sobrenome</Label>
              <Input id={`s-${u.id}`} value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`c-${u.id}`} className="text-xs">CPF</Label>
            <Input
              id={`c-${u.id}`}
              inputMode="numeric"
              value={formatarCpf(cpf)}
              onChange={(e) => setCpf(e.target.value)}
              aria-invalid={cpf.length > 0 && !cpfOk}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`p-${u.id}`} className="flex items-center gap-1 text-xs">
              <KeyRound className="size-3" /> Nova senha (opcional)
            </Label>
            <Input
              id={`p-${u.id}`}
              type="password"
              placeholder={`deixe vazio p/ manter · mín ${SENHA_MIN}`}
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              aria-invalid={novaSenha.length > 0 && novaSenha.length < SENHA_MIN}
            />
          </div>

          {erroMsg && <p className="text-xs text-destructive">{erroMsg}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={salvar}
              disabled={!podeSalvar || atualizar.isPending || redefinir.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[rgb(var(--accent-rgb)/0.16)] px-3 py-2 text-sm font-medium text-foreground ring-1 ring-[rgb(var(--accent-rgb)/0.5)] transition disabled:pointer-events-none disabled:opacity-50"
            >
              <Check className="size-4" /> Salvar
            </button>
            <button
              type="button"
              onClick={cancelar}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground/70 transition hover:text-foreground"
            >
              <X className="size-4" /> Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AdminUsuariosTab() {
  const { usuario } = useAuth()
  const { data: usuarios, isLoading, isError } = useUsuarios(true)

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground/55">
        Defina função, acesso e dados de cada pessoa. Desativar encerra a sessão na hora.
      </p>

      {isLoading && <p className="text-sm text-foreground/60">Carregando…</p>}
      {isError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Erro ao carregar usuários.
        </p>
      )}

      <div className="space-y-2">
        {usuarios?.map((u) => (
          <LinhaUsuario key={u.id} u={u} ehVoce={u.id === usuario?.id} />
        ))}
      </div>
    </div>
  )
}
