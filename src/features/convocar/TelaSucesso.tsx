import { CheckCircle2, ExternalLink, RotateCcw } from "lucide-react"
import type { ConvocacaoRmEstado } from "./types"

type Props = {
  itemId: string
  itemUrl: string
  rm?: ConvocacaoRmEstado
  onNovaConvocacao: () => void
}

/**
 * O lançamento no RM (evento eSocial S-2260). Roda dentro da própria criação, então no caso comum
 * o código já vem aqui.
 *
 * `rm` ausente é o caso que mais importa: significa que quem respondeu foi o n8n, não o nosso
 * backend, então o RM nem foi tentado e ninguém saberia sem este aviso.
 *
 * "conciliando" NUNCA é apresentado como falha: quer dizer que o RM não respondeu a tempo e pode
 * ter gravado. Sugerir "tente de novo" nesse estado é o caminho pra duplicar um evento eSocial.
 */
function LinhaRm({ rm }: { rm?: ConvocacaoRmEstado }) {
  const codigos = rm && "codigos" in rm ? (rm.codigos ?? []) : []
  const atencao =
    !rm || rm.estado === "nao_enfileirado" || rm.estado === "invalido" || rm.estado === "sem_chapa"

  const texto = !rm
    ? "Lançamento no RM: não acionado (a convocação foi criada por outro caminho) — avise o DP."
    : rm.estado === "gravado"
      ? null // o código fala por si, renderizado abaixo
      : rm.estado === "conciliando"
        ? "Lançamento no RM: o RM não respondeu a tempo. Estamos conferindo se gravou — não crie de novo."
        : rm.estado === "enfileirado"
          ? "Lançamento no RM: em nova tentativa. O código aparece no item do monday em instantes."
          : rm.estado === "coberto_por_ausencia"
            ? "Lançamento no RM: nenhum dia a convocar — o período está coberto por atestado."
            : rm.estado === "invalido"
              ? `Lançamento no RM: recusado (${rm.motivo ?? "dados inválidos"}) — avise o DP.`
              : rm.estado === "sem_chapa"
                ? "Lançamento no RM: não acionado — convocação sem chapa."
                : rm.estado === "desligado"
                  ? "Lançamento no RM: desligado nesta configuração."
                  : rm.estado === "rm_nao_configurado"
                    ? "Lançamento no RM: indisponível (RM não configurado)."
                    : "Lançamento no RM: falhou — avise o DP."

  return (
    <div className="mt-3">
      {codigos.length > 0 && (
        <p className="text-xs text-foreground/70">
          {codigos.length > 1 ? "Convocações no RM: " : "Convocação no RM: "}
          {codigos.map((c, i) => (
            <span key={c}>
              {i > 0 && ", "}
              <code className="text-[rgb(var(--accent-rgb))]">{c}</code>
            </span>
          ))}
          {codigos.length > 1 && (
            <span className="text-foreground/50"> — período dividido por atestado</span>
          )}
        </p>
      )}
      {texto && (
        <p className={atencao ? "text-xs text-amber-700 dark:text-amber-200" : "text-xs text-foreground/55"}>
          {texto}
        </p>
      )}
    </div>
  )
}

export function TelaSucesso({ itemId, itemUrl, rm, onNovaConvocacao }: Props) {
  const ehMock = itemId.startsWith("mock-")
  return (
    <div className="text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-300/15 ring-1 ring-emerald-300/40">
        <CheckCircle2 className="size-8 text-emerald-700 dark:text-emerald-200" />
      </div>
      <h1 className="text-display mt-6 text-4xl leading-[1.05] text-foreground">
        Convocação <em className="italic text-[rgb(var(--accent-rgb))]">criada</em>
      </h1>
      <p className="mt-3 text-sm text-foreground/65">
        Convocação cadastrada. Ative a coluna{" "}
        <code className="text-[rgb(var(--accent-rgb))]">Ativar</code> no monday para gerar o
        link de preenchimento.
      </p>

      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.05)] px-4 py-2 text-xs text-foreground/70 backdrop-blur">
        Item no monday:{" "}
        <code className="text-[rgb(var(--accent-rgb))]">{itemId}</code>
        {ehMock && (
          <span className="ml-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-200">
            teste
          </span>
        )}
      </div>

      {!ehMock && <LinhaRm rm={rm} />}

      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
        {!ehMock && itemUrl && (
          <a
            href={itemUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.05)] px-5 py-3 text-sm font-medium text-foreground/85 backdrop-blur transition hover:border-[rgb(var(--ink)/0.25)] hover:bg-[rgb(var(--ink)/0.1)]"
          >
            <ExternalLink className="size-4" />
            Abrir no monday
          </a>
        )}
        <button
          type="button"
          onClick={onNovaConvocacao}
          className="glow-gold inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-medium text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background:
              "linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-rgb)) 55%, rgb(var(--surface-rgb)) 130%)",
            border: "1px solid rgba(255,236,194,0.5)",
          }}
        >
          <RotateCcw className="size-4" />
          Nova convocação
        </button>
      </div>
    </div>
  )
}
