import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

// Hash de senha com scrypt (nativo do Node — sem dependencia). Formato salt:hash (hex).
export const SENHA_MIN = 8

export function hashSenha(senha: string): string {
  const salt = randomBytes(16)
  const derivada = scryptSync(senha, salt, 64)
  return `${salt.toString("hex")}:${derivada.toString("hex")}`
}

export function verificarSenha(senha: string, armazenado: string): boolean {
  const [saltHex, hashHex] = armazenado.split(":")
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, "hex")
  const esperado = Buffer.from(hashHex, "hex")
  const derivada = scryptSync(senha, salt, esperado.length)
  // Comparacao em tempo constante.
  return esperado.length === derivada.length && timingSafeEqual(esperado, derivada)
}
