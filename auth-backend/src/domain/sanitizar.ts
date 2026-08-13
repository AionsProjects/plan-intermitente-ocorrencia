// Redação de segredo e de dado pessoal antes de PERSISTIR log.
//
// Extraído de mensal/repo.ts, que era o único consumidor enquanto só o mensal tinha
// log detalhado. Agora que toda ação do app grava fase e metadado — e que o corpo do
// alerta de WhatsApp é montado a partir desse metadado — duas cópias divergindo
// deixaria de ser dívida de estilo e passaria a ser o caminho de um vazamento.
//
// 🐞 A versão anterior era RASA: aplicava a limpeza só em `typeof valor === "string"`
// no primeiro nível, então objeto e array aninhados passavam intactos. Metadado de
// fase é aninhado por natureza (`{ pessoas: [{ cpf, chapa }] }`), logo o caso comum
// era justamente o que escapava. Esta versão desce na estrutura.
import { cpfValido } from "../cpf.js"

/** Chaves cujo VALOR nunca é gravado, em qualquer profundidade. */
const CHAVES_PROIBIDAS = /token|secret|password|authorization|cpf|access[_-]?token|apikey|api[_-]?key/i

/**
 * Teto de profundidade. Existe por dois motivos independentes: metadado com ciclo
 * (`a.b = a`) faria recursão infinita, e estrutura muito funda não é legível na
 * timeline de qualquer forma — vira ruído gravado.
 */
const PROFUNDIDADE_MAX = 4
/** Teto de itens por array. Lote de 50 chapas não precisa ir inteiro pro log. */
const ITENS_MAX = 20

/**
 * Redige segredo em texto livre e corta no limite.
 *
 * Cobre os dois formatos que aparecem em mensagem de erro de verdade: header
 * `Bearer <token>` e par `chave=valor` / `chave: valor`. Devolve `null` para nulo —
 * a coluna é nullable e gravar a string "null" seria pior que não gravar.
 */
export function limparTexto(v: unknown, limite = 500): string | null {
  if (v == null) return null
  return String(v)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redigido]")
    .replace(/(token|secret|password|authorization|apikey)\s*[:=]\s*[^\s,;}]+/gi, "$1=[redigido]")
    .slice(0, limite)
}

/**
 * Um CPF solto no meio do texto não casa `chave=valor`, então tem regra própria.
 *
 * FORMATADO (`123.456.789-01`) mascara sempre — a pontuação já declara o que é. Onze
 * dígitos CRUS só mascaram se passarem o dígito verificador, e isso não é preciosismo:
 * item id do Monday tem 11 dígitos hoje, então a regra anterior transformava TODO id em
 * "[cpf]" no log (`{"itemId":"[cpf]"}` no pagamento da MARCIA, 13/08 — o id do item de
 * débito do Controle Caju foi perdido, e o mesmo valia pro mensal).
 *
 * O buraco que sobra é um CPF cru cujos DVs estão errados — que não é CPF de ninguém.
 */
export function limparCpfEmTexto(v: string): string {
  return v.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) => {
    const temPontuacao = /[.-]/.test(m)
    if (temPontuacao) return "[cpf]"
    return cpfValido(m) ? "[cpf]" : m
  })
}

function limparValor(valor: unknown, profundidade: number): unknown {
  if (valor == null) return null
  if (typeof valor === "string") {
    const t = limparTexto(valor, 300)
    return t == null ? null : limparCpfEmTexto(t)
  }
  if (typeof valor === "number" || typeof valor === "boolean") return valor
  if (valor instanceof Date) return valor.toISOString()
  // Além do teto, o que sobra é substituído por um marcador em vez de sumir calado —
  // quem lê o log precisa saber que havia algo ali.
  if (profundidade >= PROFUNDIDADE_MAX) return "[profundo]"
  if (Array.isArray(valor)) {
    const cortado = valor.slice(0, ITENS_MAX).map((x) => limparValor(x, profundidade + 1))
    if (valor.length > ITENS_MAX) cortado.push(`[+${valor.length - ITENS_MAX} itens]`)
    return cortado
  }
  if (typeof valor === "object") return limparObjeto(valor as Record<string, unknown>, profundidade + 1)
  // function, symbol, bigint: não têm o que dizer num log.
  return String(valor).slice(0, 120)
}

function limparObjeto(v: Record<string, unknown>, profundidade: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, valor] of Object.entries(v)) {
    if (CHAVES_PROIBIDAS.test(k)) continue
    out[k] = limparValor(valor, profundidade)
  }
  return out
}

/**
 * Limpa metadado de fase/artefato antes de gravar. Recursivo, com teto de
 * profundidade e de itens por array.
 *
 * Mantém a assinatura da versão antiga de propósito: mensal/repo.ts passa a importar
 * daqui sem nenhuma outra mudança, e ganha a recursão de brinde.
 */
export function limparMetadados(v: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!v) return {}
  return limparObjeto(v, 0)
}
