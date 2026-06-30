// Registra uma ação no histórico (Postgres via auth-backend). Fire-and-forget:
// nunca quebra o fluxo principal — se falhar, só loga no console.
// "Quem fez" é carimbado pelo backend pela sessão (não enviado daqui).

export type TipoAtividade =
  | "convocacao"
  | "registro"
  | "cancelamento"
  | "split"
  | "atestado"
  | "ponto_facultativo"
  | "desconto"
  | "mensal_fechamento"

export interface MetaAtividade {
  alvo?: string | null
  pessoa?: string | null
  contrato?: string | null
  resumo?: unknown
}

export function registrarAtividade(acao: TipoAtividade, meta: MetaAtividade = {}): void {
  void fetch("/api/atividade", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      acao,
      alvo: meta.alvo ?? null,
      pessoa: meta.pessoa ?? null,
      contrato: meta.contrato ?? null,
      resumo: meta.resumo ?? null,
    }),
  }).catch(() => {
    // silencioso — atividade é secundária ao fluxo de negócio
  })
}
