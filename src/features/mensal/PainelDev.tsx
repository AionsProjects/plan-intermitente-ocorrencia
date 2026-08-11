/**
 * Modo desenvolvedor do mensal: escolher POR FAMÍLIA o que um run de teste envia de VERDADE.
 *
 * Existe porque o mensal dispara muitos efeitos reais e testar UMA função exigia ou simular tudo
 * (homologação) ou enviar tudo (produção). Aparece em duas telas — conferência e confirmação —
 * para que a escolha possa ser feita antes de percorrer a lista inteira.
 *
 * Backend: presença de `familiasReais` força o run pra homologação (chave de idempotência POR
 * RUN), então um envio real de teste NUNCA marca a etapa como feita pro run oficial.
 */
export const FAMILIAS_DEV: { valor: string; rotulo: string }[] = [
  { valor: "rm_historico", rotulo: "RM — histórico de benefícios (ZMDHSTBENFUNC)" },
  { valor: "rm_financeiro", rotulo: "RM — lançamento financeiro (FopRotinas + Integrar)" },
  { valor: "rm_convocacao", rotulo: "RM — convocação (eSocial S-2260)" },
  { valor: "monday_escritas", rotulo: "Monday — escritas (Plano, Solicitação, Controle, OK)" },
  { valor: "drive", rotulo: "Drive — arquivamento" },
]

export function PainelDev({
  ligado,
  onLigado,
  familias,
  onFamilias,
}: {
  ligado: boolean
  onLigado: (v: boolean) => void
  familias: string[]
  onFamilias: (fn: (s: string[]) => string[]) => void
}) {
  return (
    <div className="rounded-xl border border-dashed border-violet-400/50 bg-violet-400/[0.06] px-4 py-3 text-left">
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(e) => onLigado(e.target.checked)}
          className="size-4 accent-violet-400"
        />
        <span className="text-[10px] uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
          Modo desenvolvedor · real por função
        </span>
      </label>
      {ligado && (
        <>
          <p className="mt-2 text-[11px] text-foreground/60">
            Marque o que vai <strong>de verdade</strong> — todo o resto simula. Caju{" "}
            <strong>sempre simula</strong> neste modo. Envio real de teste não conta pro run
            oficial (será reenviado) e pede limpeza manual depois.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {FAMILIAS_DEV.map(({ valor, rotulo }) => (
              <label
                key={valor}
                className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/85"
              >
                <input
                  type="checkbox"
                  checked={familias.includes(valor)}
                  onChange={(e) =>
                    onFamilias((s) => (e.target.checked ? [...s, valor] : s.filter((x) => x !== valor)))
                  }
                  className="size-3.5 shrink-0 accent-violet-400"
                />
                <span>{rotulo}</span>
              </label>
            ))}
          </div>
          {familias.length > 0 && (
            <p className="mt-2 text-[11px] text-violet-600 dark:text-violet-300">
              {familias.length} função(ões) com envio REAL — as demais simulam.
            </p>
          )}
        </>
      )}
    </div>
  )
}
