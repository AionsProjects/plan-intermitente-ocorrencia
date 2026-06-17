// Papeis e hierarquia. admin > dp > rh/op (rh e op no mesmo nivel).
export type Papel = "admin" | "dp" | "rh" | "operacional"

export const RANK: Record<Papel, number> = {
  admin: 3,
  dp: 2,
  rh: 1,
  operacional: 1,
}

export const PAPEL_LABEL: Record<Papel, string> = {
  admin: "Admin",
  dp: "DP",
  rh: "RH",
  operacional: "Operacional",
}

export const PAPEIS: Papel[] = ["admin", "dp", "rh", "operacional"]

export interface Usuario {
  id: string
  email: string
  nome: string
  sobrenome: string | null
  cpf: string | null
  papel: Papel
  ativo: boolean
  perfilCompleto: boolean
}

// Papeis auto-escolhiveis no onboarding (DP/Admin sao atribuidos pelo Admin).
export const PAPEIS_CADASTRO: { valor: Extract<Papel, "rh" | "operacional">; label: string; descricao: string }[] = [
  { valor: "operacional", label: "Operacional", descricao: "Lança convocações e ocorrências do dia a dia." },
  { valor: "rh", label: "RH", descricao: "Recursos Humanos." },
]

// Usuario atinge o nivel minimo exigido? (ex.: nivelMinimo="dp" libera dp e admin)
export function temNivel(papel: Papel, nivelMinimo: Papel): boolean {
  return RANK[papel] >= RANK[nivelMinimo]
}
