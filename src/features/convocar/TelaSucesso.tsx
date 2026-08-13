import { CheckCircle2, ExternalLink, FolderOpen, RotateCcw } from "lucide-react"
import { formatarReal } from "@/features/descontos/shared"
import type { ConvocacaoPrePagamento, ConvocacaoRmEstado } from "./types"

type Props = {
  itemId: string
  itemUrl: string
  rm?: ConvocacaoRmEstado
  prepagamento?: ConvocacaoPrePagamento | null
  onNovaConvocacao: () => void
}

/**
 * O cálculo do pré-pagamento — o que a felipeta vai pagar quando o operacional confirmar
 * que a pessoa apareceu.
 *
 * Isto está aqui porque é o único momento em que alguém olha o número ANTES de o dinheiro
 * sair. Depois da felipeta o pagamento é automático, então erro de contrato/período visto
 * agora custa um clique em "Nova convocação"; visto depois, custa estorno na Caju.
 *
 * As linhas seguem a ordem da conta (bruto → desconto → líquido → como sai), porque a
 * pergunta que o DP faz nesta tela é sempre "por que esse valor?", não "quanto".
 */
function BlocoPrePagamento({ p }: { p: ConvocacaoPrePagamento }) {
  if (p.estado === "invalido") {
    return (
      <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-300/[0.07] px-5 py-4 text-left">
        <p className="eyebrow text-amber-700 dark:text-amber-200">Valores não calculados</p>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground/70">
          A convocação foi criada, mas o cálculo do benefício não fechou
          {p.motivoInvalido ? (
            <>
              {" — "}
              <code className="text-amber-700 dark:text-amber-200">{p.motivoInvalido}</code>
            </>
          ) : null}
          . O pagamento vai recalcular na confirmação de comparecimento; avise o DP se repetir.
        </p>
      </div>
    )
  }

  const linhas = [
    { rotulo: "Benefício bruto", vr: p.brutoVR, vt: p.brutoVT, tom: "normal" as const },
    { rotulo: "Desconto abatido", vr: p.descontoVR, vt: p.descontoVT, tom: "desconto" as const },
    { rotulo: "A pagar", vr: p.liquidoVR, vt: p.liquidoVT, tom: "destaque" as const },
  ]
  const temDesconto = (p.descontoVR ?? 0) > 0 || (p.descontoVT ?? 0) > 0

  return (
    <div className="mt-6 rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-5 py-4 text-left backdrop-blur">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow text-foreground/55">Pré-pagamento calculado</p>
        <p className="text-[11px] text-foreground/45">
          {p.diasVR ?? 0} {p.diasVR === 1 ? "dia" : "dias"} VR · {p.diasVT ?? 0}{" "}
          {p.diasVT === 1 ? "dia" : "dias"} VT
        </p>
      </div>

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-foreground/40">
            <th className="pb-1 text-left font-medium">&nbsp;</th>
            <th className="pb-1 text-right font-medium">VR</th>
            <th className="pb-1 text-right font-medium">VT</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr
              key={l.rotulo}
              className={
                l.tom === "destaque"
                  ? "border-t border-[rgb(var(--ink)/0.12)] font-medium text-foreground/90"
                  : "text-foreground/65"
              }
            >
              <td className="py-1 pr-3">{l.rotulo}</td>
              <td
                className={`py-1 text-right tabular-nums ${
                  l.tom === "desconto" && (l.vr ?? 0) > 0 ? "text-amber-700 dark:text-amber-200" : ""
                }`}
              >
                {l.tom === "desconto" && (l.vr ?? 0) > 0 ? "− " : ""}
                {formatarReal(l.vr ?? 0)}
              </td>
              <td
                className={`py-1 text-right tabular-nums ${
                  l.tom === "desconto" && (l.vt ?? 0) > 0 ? "text-amber-700 dark:text-amber-200" : ""
                }`}
              >
                {l.tom === "desconto" && (l.vt ?? 0) > 0 ? "− " : ""}
                {formatarReal(l.vt ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Crédito × boleto: o crédito entra no cartão na hora, o boleto é PIX pra o DP pagar.
          Quem confere pagamento precisa dos dois separados — na Caju eles aparecem em telas
          diferentes. */}
      {((p.creditoVR ?? 0) > 0 || (p.creditoVT ?? 0) > 0 || (p.pixVR ?? 0) > 0 || (p.pixVT ?? 0) > 0) && (
        <p className="mt-3 border-t border-[rgb(var(--ink)/0.08)] pt-2.5 text-[11px] leading-relaxed text-foreground/50">
          Sai como crédito no cartão{" "}
          <span className="tabular-nums text-foreground/75">
            {formatarReal((p.creditoVR ?? 0) + (p.creditoVT ?? 0))}
          </span>{" "}
          + boleto PIX{" "}
          <span className="tabular-nums text-foreground/75">
            {formatarReal((p.pixVR ?? 0) + (p.pixVT ?? 0))}
          </span>
          .
        </p>
      )}

      {p.semSaldo && (
        <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-300/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
          O desconto pendente consumiu o benefício inteiro — nada a pagar nesta convocação.
        </p>
      )}

      {temDesconto && !p.semSaldo && (
        <p className="mt-2 text-[11px] text-foreground/45">
          Desconto reservado para esta convocação — não vai ser abatido duas vezes.
        </p>
      )}

      {p.estado === "nao_gravado" && (
        <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-300/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
          Os valores estão no item, mas não foi possível reservar o desconto. Avise o DP antes de
          criar outra convocação para a mesma pessoa.
        </p>
      )}

      {p.pastaUrl && (
        <a
          href={p.pastaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-foreground/55 transition hover:text-[rgb(var(--accent-rgb))]"
        >
          <FolderOpen className="size-3.5" />
          Pasta da convocação no Drive
        </a>
      )}
    </div>
  )
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

export function TelaSucesso({ itemId, itemUrl, rm, prepagamento, onNovaConvocacao }: Props) {
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

      {!ehMock && prepagamento && <BlocoPrePagamento p={prepagamento} />}

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
