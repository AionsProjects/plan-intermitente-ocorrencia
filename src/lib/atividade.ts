// Histórico de execuções (Postgres via auth-backend).
//
// A ordem mudou e é o ponto: antes `registrarAtividade` era chamado no `onSuccess` da
// mutation, então AÇÃO QUE FALHA não deixava rastro nenhum. Agora abre ANTES de chamar o
// processo e fecha com o desfecho — o log passa a existir justamente quando dá errado,
// que é quando alguém precisa dele.
//
// O id é cunhado pelo SERVIDOR, uma vez. O front o injeta no payload do processo
// (`execucao_id`), e a rota que executar se ANEXA a ele em vez de abrir outra execução.
// Sem isso cada ação gerava DUAS linhas: uma do front e uma da rota.
//
// "Quem fez" é sempre carimbado pelo backend pela sessão — nunca enviado daqui.

export type TipoAtividade =
  | "convocacao"
  | "registro"
  | "cancelamento"
  | "split"
  | "atestado"
  | "ponto_facultativo"
  | "desconto"
  | "mensal"

export interface MetaAtividade {
  alvo?: string | null
  pessoa?: string | null
  contrato?: string | null
  resumo?: unknown
}

/**
 * Teto pra abrir a execução. Um sistema de log que consegue TRAVAR uma convocação é pior
 * que log faltando — passando disso, segue sem id e a rota abre a própria execução.
 */
const TETO_ABERTURA_MS = 1500

/**
 * Abre a execução e devolve o id, ou null se não deu (nunca lança, nunca trava).
 *
 * ⚠️ O teto usa `AbortSignal.timeout`, NÃO `Promise.race` com um setTimeout. A primeira
 * versão usava race, e isso produziu linha órfã em produção: `Promise.race` desiste de
 * ESPERAR mas não CANCELA o fetch — a requisição chegava mesmo assim, o servidor criava a
 * execução, e o front já tinha descartado o id. Ninguém fechava, e 15 min depois a
 * varredura marcava `abandonada` e disparava alerta de uma convocação que deu certo.
 *
 * Aconteceu de verdade em 12/08 20:08 (KETLEM RAMOS MATOS, item 12788484122): a rota
 * gravou tudo — 5 fases, 4 artefatos, `estado='ok'` — e a linha fantasma do front nasceu
 * 1 segundo DEPOIS de a rota terminar. Abortar fecha a porta: requisição cancelada não
 * chega, e nada é criado.
 */
export async function abrirAtividade(
  acao: TipoAtividade,
  meta: MetaAtividade = {},
): Promise<string | null> {
  try {
    const res = await fetch("/api/atividade", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TETO_ABERTURA_MS),
      body: JSON.stringify({
        acao,
        alvo: meta.alvo ?? null,
        pessoa: meta.pessoa ?? null,
        contrato: meta.contrato ?? null,
        resumo: meta.resumo ?? null,
      }),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { id?: string }
    return j.id ?? null
  } catch {
    // Inclui o AbortError do teto. Sem id, a rota abre a própria execução — uma linha só.
    return null
  }
}

/**
 * Fecha a execução com o desfecho. Fire-and-forget de propósito: o dado crítico (a
 * abertura) já está gravado, e se este PATCH se perder a varredura de abandonadas
 * transforma a linha em 'abandonada' — o que também é informação.
 */
export function fecharAtividade(
  id: string | null,
  estado: "ok" | "erro",
  det: { erro?: unknown; resumo?: unknown } = {},
): void {
  if (!id) return
  void fetch(`/api/atividade/${encodeURIComponent(id)}/fechar`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      estado,
      erro: det.erro instanceof Error ? det.erro.message : det.erro,
      resumo: det.resumo,
    }),
  }).catch(() => {
    // silencioso — o desfecho é secundário à abertura
  })
}

/**
 * Envolve uma ação: abre, injeta `execucao_id` no payload, fecha com o desfecho.
 *
 * Re-lança o erro pra a mutation do react-query continuar vendo a falha — a
 * instrumentação é aditiva.
 */
export async function comAtividade<T>(
  acao: TipoAtividade,
  meta: MetaAtividade,
  fn: (execucaoId: string | null) => Promise<T>,
): Promise<T> {
  const id = await abrirAtividade(acao, meta)
  try {
    const r = await fn(id)
    fecharAtividade(id, "ok")
    return r
  } catch (e) {
    fecharAtividade(id, "erro", { erro: e })
    throw e
  }
}

/**
 * Abre e fecha 'ok' de uma vez, sem envolver a chamada.
 *
 * @deprecated Só registra SUCESSO — ação que falha não deixa rastro, que é o buraco que
 * `comAtividade` conserta. Sobrevive em `atestado`, `desconto` e `ponto_facultativo`,
 * cujas rotas ainda não estão instrumentadas (então não há duplicação de linha).
 *
 * Migrar `atestado` exige uma decisão: hoje ele grava UMA LINHA POR DOCUMENTO do lote, e
 * `comAtividade` naturalmente daria uma execução para o lote inteiro (com um artefato por
 * documento). É mudança no que o operador vê no histórico, não refactor.
 */
export function registrarAtividade(acao: TipoAtividade, meta: MetaAtividade = {}): void {
  void abrirAtividade(acao, meta).then((id) => fecharAtividade(id, "ok"))
}
