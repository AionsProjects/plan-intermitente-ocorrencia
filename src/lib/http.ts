// Helper compartilhado pras chamadas ao n8n + identidade do operador.
//
// Identidade vem de um GETTER registrado pelo AuthProvider (setOperadorProvider),
// evitando import circular — este modulo nao depende do React.
//
// O campo `operador` e injetado nos payloads de escrita. O n8n IGNORA chaves
// desconhecidas, entao isso NAO quebra os WFs atuais; a identidade so passa a ser
// usada quando os WFs forem fiados (fora do escopo desta etapa). Em rotas publicas
// (/preencher/:uuid, /descontos/:uuid) o usuario pode nao estar logado -> operador null.

export interface OperadorInfo {
  email: string
  nome: string
  papel: string
}

let operadorProvider: () => OperadorInfo | null = () => null

export function setOperadorProvider(fn: () => OperadorInfo | null): void {
  operadorProvider = fn
}

export function operadorAtual(): OperadorInfo | null {
  return operadorProvider()
}

// Anexa `operador` a um corpo JSON sem mutar o original.
export function comOperador<T extends object>(
  body: T,
): T & { operador: OperadorInfo | null } {
  return { ...body, operador: operadorAtual() }
}

// Anexa `operador` a um FormData (multipart) como campo JSON.
export function anexarOperador(fd: FormData): FormData {
  fd.append("operador", JSON.stringify(operadorAtual()))
  return fd
}
