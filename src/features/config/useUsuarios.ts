import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Papel } from "@/features/auth/types"

export interface UsuarioAdmin {
  id: string
  email: string
  nome: string
  sobrenome: string | null
  cpf: string | null
  papel: Papel
  ativo: boolean
  ultimo_login: string | null
}

const QK = ["admin", "usuarios"] as const

async function listarUsuarios(): Promise<UsuarioAdmin[]> {
  const res = await fetch("/api/usuarios", { credentials: "same-origin" })
  if (!res.ok) throw new Error(`Erro ${res.status} ao listar usuários`)
  const data = (await res.json()) as { usuarios: UsuarioAdmin[] }
  return data.usuarios ?? []
}

// Lista de usuarios (admin). So roda quando `habilitado` (aba Admin aberta).
export function useUsuarios(habilitado: boolean) {
  return useQuery({
    queryKey: QK,
    queryFn: listarUsuarios,
    enabled: habilitado,
    staleTime: 30_000,
  })
}

interface PatchArgs {
  id: string
  papel?: Papel
  ativo?: boolean
  nome?: string
  sobrenome?: string
  cpf?: string
}

export function useAtualizarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: PatchArgs) => {
      const { id, ...corpo } = args
      const res = await fetch(`/api/usuarios/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { erro?: string }
        const err = new Error(data.erro ?? `erro_${res.status}`) as Error & { erro?: string }
        err.erro = data.erro
        throw err
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useRedefinirSenha() {
  return useMutation({
    mutationFn: async (args: { id: string; nova_senha: string }) => {
      const res = await fetch(`/api/usuarios/${args.id}/senha`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nova_senha: args.nova_senha }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { erro?: string }
        const err = new Error(data.erro ?? `erro_${res.status}`) as Error & { erro?: string }
        err.erro = data.erro
        throw err
      }
      return res.json()
    },
  })
}
