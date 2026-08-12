import { useEffect, useState } from "react"

/**
 * Atrasa a propagação de um valor até ele parar de mudar por `delay`.
 *
 * Estava privado em features/convocar/useConvocacao.ts. Extraído porque a busca da
 * página de atividade precisa do mesmo comportamento — e porque lá o valor também vai
 * pra URL: sem debounce, cada tecla vira uma entrada no histórico e prende o botão
 * voltar do celular.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
