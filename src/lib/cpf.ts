// Mascara + validacao de CPF. Espelha auth-backend/src/cpf.ts.

export function soDigitos(cpf: string): string {
  return cpf.replace(/\D/g, "")
}

// Aplica mascara 000.000.000-00 conforme digita (trunca em 11 digitos).
export function formatarCpf(valor: string): string {
  const d = soDigitos(valor).slice(0, 11)
  let out = d
  if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  else if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  else if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`
  return out
}

// Valida os 2 digitos verificadores. Rejeita sequencias iguais.
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

  if (dv(d.slice(0, 9), 10) !== Number(d[9])) return false
  return dv(d.slice(0, 10), 11) === Number(d[10])
}
