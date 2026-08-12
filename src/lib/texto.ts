/**
 * Normalização de texto pra comparação e busca.
 *
 * `semAcento` era duplicado literal em convocar/BuscarEmpregado.tsx e
 * atestados/BuscarPessoa.tsx, cada um com sua cópia — e a página de atividade seria
 * a terceira. Difere de `normalizarBusca` (lib/buscaUnidade.ts) de propósito: aqui a
 * pontuação é PRESERVADA, porque quem consome é o realce de trecho casado, que precisa
 * de índices alinhados com o texto original.
 */
export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

const PARTICULAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"])

/**
 * Tira palavra repetida do nome.
 *
 * O cadastro concatena nome + sobrenome e produz "THALLISON GOMES SOUZA SOUZA",
 * "KARINE ROMASKEVIS DE OLIVEIRA ROMASKEVIS", "ISAAC RAYLEN FEIJO CALDAS GOMES Gomes".
 * Espelha `nomeLimpo` de auth-backend/src/domain/mensagemAlteracao.ts, que existe pelo
 * mesmo motivo (não sair feio na mensagem de WhatsApp).
 *
 * É correção de EXIBIÇÃO: o dado gravado segue fiel à origem, e o conserto de verdade
 * é no cadastro.
 */
export function nomeLimpo(nome: string | null | undefined): string | null {
  const bruto = String(nome ?? "").trim()
  if (!bruto) return null
  const vistos = new Set<string>()
  const out: string[] = []
  for (const palavra of bruto.split(/\s+/)) {
    const chave = palavra.toUpperCase()
    // Partícula repete legitimamente ("DE OLIVEIRA DE SOUZA") — nunca é dedupada.
    if (PARTICULAS.has(chave)) {
      out.push(palavra)
      continue
    }
    if (vistos.has(chave)) continue
    vistos.add(chave)
    out.push(palavra)
  }
  return out.join(" ")
}
