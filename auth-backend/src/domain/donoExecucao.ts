// Quem é dono de uma linha de execução, para o front se reanexar a ela (abertura atrasada) ou
// fechá-la.
//
// Linha aberta por rota PÚBLICA nasce sem `user_id`: `/preencher/:uuid` não exige sessão, então
// a rota só conhece o operador que o front mandou no corpo (`operadorDoCorpo`). Tratar isso como
// "linha de outra pessoa" era o que fabricava a linha fantasma do cancelamento: a abertura do
// front chegava ~1 s depois da rota (KAREN 25/09/2026, MICHELE 15/09/2026), o servidor recusava o
// id, cunhava outro e a linha nova ficava 'aberta' — ninguém mais a fechava.

export interface LinhaDona {
  user_id: string | null
  operador_email: string | null
}

export interface UsuarioDono {
  id: string
  email: string
}

const email = (v: string) => v.trim().toLowerCase()

/**
 * Com `user_id`, só o próprio. Sem `user_id` (rota pública), o operador carimbado precisa ser o
 * da sessão; sem operador nenhum, vale — o id é um UUID que o próprio front cunhou.
 */
export function ehDonoDaExecucao(linha: LinhaDona, u: UsuarioDono): boolean {
  if (linha.user_id) return linha.user_id === u.id
  return !linha.operador_email || email(linha.operador_email) === email(u.email)
}
