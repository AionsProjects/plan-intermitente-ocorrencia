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
 * Teto da requisição de abertura. Continua existindo pra não deixar fetch pendurado, mas
 * NÃO é mais o que garante uma linha só — quem garante é o id cunhado aqui (ver abaixo).
 */
const TETO_ABERTURA_MS = 8000

/**
 * UUID v4 local. `crypto.randomUUID` exige contexto seguro; o fallback por
 * `getRandomValues` cobre o resto sem perder o log.
 */
function novoId(): string | null {
  const c = globalThis.crypto
  if (!c) return null
  if (typeof c.randomUUID === "function") return c.randomUUID()
  if (typeof c.getRandomValues !== "function") return null
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Abre a execução e devolve o id. O id é cunhado AQUI e a requisição vai fire-and-forget.
 *
 * ⚠️ Este é o conserto da LINHA FANTASMA, e as duas tentativas anteriores erraram o alvo.
 * A primeira usava `Promise.race`; a segunda trocou por `AbortSignal.timeout` afirmando
 * que "requisição cancelada não chega, e nada é criado". **Isso é falso.** Abortar é ato
 * do CLIENTE: se o POST já saiu — e ele sai imediatamente, é um corpo pequeno — o servidor
 * recebe, executa e INSERE. O abort só desiste de ler a resposta. Nada na Vercel cancela a
 * função no meio.
 *
 * Foi exatamente isso que aconteceu, cinco vezes, sempre com a mesma assinatura no banco:
 *
 *   MICHELE   17/08  ok  motor=backend  12:18:44 -> 12:19:03 (18,1 s)   11 fases
 *             17/08  ORFA motor=app     12:19:03                          0 fases
 *   MARCILENE 17/08  ok  motor=backend  12:27:52 -> 12:28:09 (16,7 s)   11 fases
 *             17/08  ORFA motor=app     12:28:10                          0 fases
 *
 * Leia o `motor`: a linha boa é `backend` — ou seja, a ROTA abriu a própria execução,
 * porque o front entregou `execucao_id: null`. E a órfã (`app`) nasce no segundo em que a
 * convocação TERMINA: o POST de abertura ficou preso atrás da própria função da convocação,
 * estourou os 1500 ms, o cliente abortou e jogou o id fora — e o servidor gravou a linha
 * quando a instância liberou. Duas linhas por clique, garantido.
 *
 * A correção não é um teto melhor: é o front CUNHAR o id. Sabendo o id localmente, ele
 * segue para a rota mesmo que a abertura demore ou falhe, e `abrirExecucao` tem
 * `ON CONFLICT (id) DO UPDATE` — quem chegar primeiro cria, o outro se anexa. Uma linha,
 * sempre, e o clique deixa de esperar a rede.
 */
export async function abrirAtividade(
  acao: TipoAtividade,
  meta: MetaAtividade = {},
): Promise<string | null> {
  const id = novoId()
  // Sem crypto não há id local: devolve null e a ROTA abre a própria execução. Uma linha
  // só (perde o registro do que o front tentou, não duplica).
  if (!id) return null
  void fetch("/api/atividade", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TETO_ABERTURA_MS),
    body: JSON.stringify({
      id,
      acao,
      alvo: meta.alvo ?? null,
      pessoa: meta.pessoa ?? null,
      contrato: meta.contrato ?? null,
      resumo: meta.resumo ?? null,
    }),
  }).catch(() => {
    // Silencioso: chegar ou não chegar não muda o id, e a rota grava a linha de todo jeito.
  })
  return id
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
 * `comAtividade` conserta. Sobrevive apenas em `desconto`, cuja rota ainda não está
 * instrumentada (então não há duplicação de linha).
 *
 * `ponto_facultativo` migrou para `comAtividade` (o id vai no payload e a rota se anexa).
 * `atestado` saiu daqui por outro caminho: o lote é UMA requisição com N documentos, então
 * o front não teria como carimbar N ids — quem abre a execução é a rota, uma por documento
 * (`auth-backend/src/routes/atestados.ts`), e o front não loga nada.
 */
export function registrarAtividade(acao: TipoAtividade, meta: MetaAtividade = {}): void {
  void abrirAtividade(acao, meta).then((id) => fecharAtividade(id, "ok"))
}
