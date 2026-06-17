// Validacao de CPF (digitos verificadores). Espelha src/lib/cpf.ts do frontend.

// Mantem so digitos.
export function soDigitos(cpf: string): string {
  return cpf.replace(/\D/g, "")
}

// Valida os 2 digitos verificadores. Rejeita sequencias iguais (000..., 111...).
export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false

  const dv = (base: string, pesoInicial: number): number => {
    let soma = 0
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (pesoInicial - i)
    }
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  const dv1 = dv(d.slice(0, 9), 10)
  if (dv1 !== Number(d[9])) return false
  const dv2 = dv(d.slice(0, 10), 11)
  return dv2 === Number(d[10])
}
