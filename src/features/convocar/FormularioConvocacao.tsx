import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileUp,
  Loader2,
  Lock,
  Send,
  X,
} from "lucide-react"
import { addDays, format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import { GlassDatePicker } from "./GlassDatePicker"
import { GlassSelect } from "./GlassSelect"
import { ComboboxFiltravel } from "@/components/ui/combobox-filtravel"
import { ConvocacaoApiError } from "./api"
import {
  OPCOES_CONVOCACAO_FALLBACK,
  type ConvocacaoConflito,
  type ConvocacaoPayload,
  type Contrato,
  type EmpregadoRM,
  type Insalubridade,
  type Justificativa,
  type SimNao,
  type Solicitante,
} from "./types"
import { useCriarConvocacao, useOpcoesConvocacao } from "./useConvocacao"
import { unidadesParaContrato } from "@/lib/unidadesContrato"
import type { ConvocacaoResposta } from "./types"

type Props = {
  empregado: EmpregadoRM
  papel: "passado" | "atual" | "proximo"
  competencia: string // YYYY-MM do mês escolhido (trava o calendário)
  onTrocarEmpregado: () => void
  onVoltarMes: () => void
  // A resposta inteira, não campos posicionais: ela cresce a cada fase da migração do pontual
  // (rm, pré-pagamento, felipeta), e cada campo novo era uma posição nova pra errar.
  onSucesso: (resposta: ConvocacaoResposta) => void
}

type FormState = {
  name: string
  escala: string
  solicitante: Solicitante | ""
  contrato: Contrato | ""
  localUnidade: string
  optanteVT: SimNao | ""
  sabado: SimNao | ""
  insalubridade: Insalubridade | ""
  interior: SimNao | ""
  dataInicio: string
  dataFim: string
  justificativa: Justificativa | ""
  empregadoSubstituido: string
  termoConvocacao: File | null
  termoInsalubridade: File | null
}

const initialState = (empregado: EmpregadoRM): FormState => ({
  name: `INTERMITENTE - ${empregado.nome}`,
  escala: "",
  solicitante: "",
  contrato: "",
  localUnidade: "",
  optanteVT: empregado.optanteVtLabel || (empregado.optanteVT ? "SIM" : "NÃO"),
  sabado: "",
  insalubridade: "",
  interior: "",
  dataInicio: "",
  dataFim: "",
  justificativa: "",
  empregadoSubstituido: "",
  termoConvocacao: null,
  termoInsalubridade: null,
})

type AlertaConflito = {
  mensagem: string
  conflito?: ConvocacaoConflito
  /**
   * O período que o OP PEDIU. É o que separa os dois desfechos: pedido que passa do fim
   * da convocação existente dá emenda (tem data nova a oferecer); pedido que cabe inteiro
   * dentro dela não tem o que lançar. Sem isto a caixa fala igual nos dois casos.
   */
  pedidoInicio?: string
  pedidoFim?: string
}

export function FormularioConvocacao({
  empregado,
  papel,
  competencia,
  onTrocarEmpregado,
  onVoltarMes,
  onSucesso,
}: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(empregado))
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [alertaConflito, setAlertaConflito] =
    useState<AlertaConflito | null>(null)
  const opcoesQuery = useOpcoesConvocacao()
  const mutation = useCriarConvocacao()

  // Competência do mês escolhido (etapa anterior) → trava o range do calendário.
  const minData = competencia ? `${competencia}-01` : undefined
  const maxData = competencia
    ? (() => {
        const [a, m] = competencia.split("-").map(Number)
        return `${competencia}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`
      })()
    : undefined
  const opcoes = opcoesQuery.data ?? OPCOES_CONVOCACAO_FALLBACK
  const unidadesPorContrato = opcoes.unidadesPorContrato as Record<
    string,
    readonly string[]
  >
  const unidadesDoContrato = useMemo(() => {
    if (!form.contrato) return []
    const remotas = unidadesPorContrato[form.contrato] ?? []
    return remotas.length > 0 ? remotas : [...unidadesParaContrato(form.contrato)]
  }, [form.contrato, unidadesPorContrato])

  const camposObrigatoriosOk = useMemo(() => {
    return (
      form.name.trim().length > 0 &&
      form.escala.trim().length > 0 &&
      form.solicitante !== "" &&
      form.contrato !== "" &&
      form.localUnidade.trim().length > 0 &&
      form.sabado !== "" &&
      form.insalubridade !== "" &&
      form.interior !== "" &&
      form.dataInicio !== "" &&
      form.dataFim !== "" &&
      form.justificativa !== "" &&
      form.empregadoSubstituido.trim().length > 0
    )
  }, [form])

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setErroGeral(null)
    setAlertaConflito(null)
    setForm((f) => ({ ...f, [k]: v }))
  }

  function setContrato(contrato: Contrato | "") {
    setErroGeral(null)
    setAlertaConflito(null)
    const unidades = contrato
      ? (unidadesPorContrato[contrato] ?? unidadesParaContrato(contrato))
      : []
    setForm((f) => ({
      ...f,
      contrato,
      localUnidade: unidades.length === 1 ? unidades[0] : "",
    }))
  }

  useEffect(() => {
    if (!form.contrato) return
    if (form.localUnidade && unidadesDoContrato.includes(form.localUnidade)) return
    setForm((f) => ({
      ...f,
      localUnidade: unidadesDoContrato.length === 1 ? unidadesDoContrato[0] : "",
    }))
  }, [form.contrato, form.localUnidade, unidadesDoContrato])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErroGeral(null)
    setAlertaConflito(null)
    if (!camposObrigatoriosOk) {
      setErroGeral("Preencha todos os campos obrigatórios.")
      return
    }
    if (form.dataInicio > form.dataFim) {
      setErroGeral("A data de início não pode ser maior que a data de fim.")
      return
    }
    const payload: ConvocacaoPayload = {
      name: form.name.trim(),
      empregado,
      escala: form.escala.trim(),
      solicitante: form.solicitante as Solicitante,
      contrato: form.contrato as Contrato,
      localUnidade: form.localUnidade.trim(),
      optanteVT: (empregado.optanteVtLabel ||
        (empregado.optanteVT ? "SIM" : "NÃO")) as SimNao,
      sabado: form.sabado as SimNao,
      insalubridade: form.insalubridade as Insalubridade,
      interior: form.interior as SimNao,
      dataInicio: form.dataInicio,
      dataFim: form.dataFim,
      justificativa: form.justificativa as Justificativa,
      empregadoSubstituido: form.empregadoSubstituido.trim(),
      termoConvocacao: form.termoConvocacao,
      termoInsalubridade: form.termoInsalubridade,
      papel,
    }
    try {
      const res = await mutation.mutateAsync(payload)
      onSucesso(res)
    } catch (err) {
      if (
        err instanceof ConvocacaoApiError &&
        err.status === 409 &&
        err.erro === "convocacao_conflitante"
      ) {
        setAlertaConflito({
          mensagem:
            err.message ||
            "Este intermitente já tem convocação no período informado.",
          conflito: err.conflito,
          pedidoInicio: form.dataInicio,
          pedidoFim: form.dataFim,
        })
        return
      }

      setErroGeral(
        (err as Error).message ||
          "Erro ao criar convocação. Tente novamente.",
      )
    }
  }

  const admissaoEmpregadoFmt = (() => {
    try {
      return empregado.admissao
        ? format(parseISO(empregado.admissao), "dd/MM/yyyy", { locale: ptBR })
        : "—"
    } catch {
      return empregado.admissao || "—"
    }
  })()

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <button
        type="button"
        onClick={onTrocarEmpregado}
        className="inline-flex items-center gap-1.5 text-xs text-foreground/55 transition hover:text-foreground/85"
      >
        <ArrowLeft className="size-3.5" />
        Trocar empregado
      </button>

      {/* Mês escolhido na etapa anterior — chip + trocar */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-2.5">
        <span className="text-sm text-foreground/80">
          Convocando para:{" "}
          <span className="font-medium capitalize text-foreground">
            {papel === "proximo" ? "próximo mês" : "mês atual"}
            {competencia ? ` (${competencia})` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={onVoltarMes}
          className="text-xs text-foreground/55 underline-offset-2 transition hover:text-foreground/85 hover:underline"
        >
          trocar mês
        </button>
      </div>

      <section className="rounded-3xl border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.03)] p-5 backdrop-blur">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-foreground/55">
          <Lock className="size-3" />
          Dados vindos do RM (não editáveis)
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <ReadonlyField label="Nome" value={empregado.nome} />
          <ReadonlyField label="Chapa" value={empregado.chapa || "—"} />
          <ReadonlyField label="CPF" value={empregado.cpf || "—"} />
          <ReadonlyField label="Função" value={empregado.funcao || "—"} />
          <ReadonlyField label="Admissão" value={admissaoEmpregadoFmt} />
          <ReadonlyField label="Seção" value={empregado.secao || "—"} />
          <ReadonlyField
            label="Vale Transporte"
            value={empregado.optanteVtLabel || (empregado.optanteVT ? "SIM" : "NÃO")}
          />
        </div>
      </section>

      <section className="space-y-5">
        <FieldText
          label="Nome do elemento"
          hint="Padrão: INTERMITENTE - NOME. Manter o padrão recomendado."
          value={form.name}
          onChange={(v) => set("name", v)}
          required
        />

        <FieldText
          label="Escala"
          hint="Informe a escala que o empregado irá cumprir no dia."
          value={form.escala}
          onChange={(v) => set("escala", v)}
          required
        />

        <FieldWrap label="Solicitante" required>
          <GlassSelect
            label="Solicitante"
            value={form.solicitante}
            onChange={(v) => set("solicitante", v as Solicitante | "")}
            options={opcoes.solicitantes}
          />
        </FieldWrap>

        <FieldWrap label="Op - Contrato" required>
          <GlassSelect
            label="Op - Contrato"
            value={form.contrato}
            onChange={(v) => setContrato(v as Contrato | "")}
            options={opcoes.contratos}
          />
        </FieldWrap>

        <FieldWrap
          label="Local/Unidade"
          hint="As unidades são filtradas pelo contrato selecionado."
          required
        >
          <ComboboxFiltravel
            valor={form.localUnidade}
            onChange={(v) => set("localUnidade", v)}
            opcoes={unidadesDoContrato}
            placeholder={
              form.contrato ? "Selecione a unidade" : "Selecione o contrato primeiro"
            }
            buscaPlaceholder="Buscar unidade"
            disabled={!form.contrato || unidadesDoContrato.length === 0}
            emptyMessage="Não há unidades cadastradas para este contrato"
            noMatchMessage="Nenhuma unidade encontrada para esse termo"
          />
        </FieldWrap>

        <FieldWrap
          label="Sábado?"
          hint="Informe se o empregado convocado trabalha aos sábados."
          required
        >
          <GlassSelect
            label="Sábado?"
            value={form.sabado}
            onChange={(v) => set("sabado", v as SimNao | "")}
            options={opcoes.sabados}
          />
        </FieldWrap>

        <FieldWrap label="Insalubridade?" required>
          <GlassSelect
            label="Insalubridade?"
            value={form.insalubridade}
            onChange={(v) => set("insalubridade", v as Insalubridade | "")}
            options={opcoes.insalubridades}
          />
        </FieldWrap>

        <FieldFile
          label="Termo de Insalubridade"
          file={form.termoInsalubridade}
          onChange={(f) => set("termoInsalubridade", f)}
        />

        <FieldWrap label="Interior?" required>
          <GlassSelect
            label="Interior?"
            value={form.interior}
            onChange={(v) => set("interior", v as SimNao | "")}
            options={opcoes.interiores}
          />
        </FieldWrap>

        <div className="grid gap-5 sm:grid-cols-2">
          <FieldWrap label="Data/Início" required>
            <GlassDatePicker
              label="Data/Início"
              value={form.dataInicio}
              onChange={(v) => set("dataInicio", v)}
              min={minData}
              max={maxData}
            />
          </FieldWrap>
          <FieldWrap label="Data/Fim" required>
            <GlassDatePicker
              label="Data/Fim"
              value={form.dataFim}
              onChange={(v) => set("dataFim", v)}
              min={form.dataInicio || minData}
              max={maxData}
            />
          </FieldWrap>
        </div>

        <FieldWrap label="OP - Justificativa" required>
          <GlassSelect
            label="OP - Justificativa"
            value={form.justificativa}
            onChange={(v) => set("justificativa", v as Justificativa | "")}
            options={opcoes.justificativas}
          />
        </FieldWrap>

        <FieldText
          label="OP - Empregado Substituído"
          hint="Informe o nome da pessoa substituída."
          value={form.empregadoSubstituido}
          onChange={(v) => set("empregadoSubstituido", v)}
          required
        />

        <FieldFile
          label="Termo de Convocação"
          file={form.termoConvocacao}
          onChange={(f) => set("termoConvocacao", f)}
        />
      </section>

      {alertaConflito && (
        <AlertaConflito
          alerta={alertaConflito}
          onUsarData={(iso) => {
            // Arrasta o fim junto quando ele ficou atrás do novo início — senão o próprio
            // form barra em "data início > data fim" e o atalho viraria um segundo erro.
            setForm((f) => ({
              ...f,
              dataInicio: iso,
              dataFim: f.dataFim && f.dataFim >= iso ? f.dataFim : iso,
            }))
            setAlertaConflito(null)
          }}
        />
      )}

      {erroGeral && (
        <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
          {erroGeral}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || !camposObrigatoriosOk}
        className="plane-btn glow-gold inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-medium text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-rgb)) 55%, rgb(var(--surface-rgb)) 130%)",
          border: "1px solid rgba(255,236,194,0.5)",
        }}
      >
        {mutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4 plane-icon" />
        )}
        Convocar
      </button>
    </form>
  )
}

function formatarDataConflito(data?: string): string | null {
  if (!data) return null
  try {
    return format(parseISO(data), "dd/MM/yyyy", { locale: ptBR })
  } catch {
    return data
  }
}

/** Primeiro dia livre depois da convocação que já existe (ISO), ou null se não der. */
function proximoDiaLivre(fimExistente?: string): string | null {
  if (!fimExistente) return null
  try {
    return format(addDays(parseISO(fimExistente), 1), "yyyy-MM-dd")
  } catch {
    return null
  }
}

/**
 * Recusa da trava de período. NÃO é erro: a regra rodou e decidiu não agir — por isso
 * âmbar e não vermelho, o mesmo sinal da lâmpada neutra que o /atividade usa em
 * 'recusado'. O texto diz três coisas que a versão anterior não dizia: QUEM já está
 * convocado, POR QUE o dia não pode repetir (ele já está pago, lançar de novo pagaria em
 * dobro) e QUAL data usar — com botão, pra o OP não ter que somar um dia na cabeça.
 */
function AlertaConflito({
  alerta,
  onUsarData,
}: {
  alerta: AlertaConflito
  onUsarData?: (iso: string) => void
}) {
  const inicio = formatarDataConflito(alerta.conflito?.data_inicio)
  const fim = formatarDataConflito(alerta.conflito?.data_fim)
  const periodo = inicio && fim ? `${inicio} a ${fim}` : null
  const quem = alerta.conflito?.nome?.trim() || "Este intermitente"

  // Emenda só faz sentido quando o pedido PASSA do fim do que já existe. Pedido que cabe
  // inteiro dentro da convocação atual não tem data nova a oferecer — não há o que lançar.
  const fimExistente = alerta.conflito?.data_fim
  const podeEmendar = !!fimExistente && !!alerta.pedidoFim && alerta.pedidoFim > fimExistente
  const sugestao = podeEmendar ? proximoDiaLivre(fimExistente) : null
  const sugestaoFmt = formatarDataConflito(sugestao ?? undefined)
  const pedidoFmt = (() => {
    const a = formatarDataConflito(alerta.pedidoInicio)
    const b = formatarDataConflito(alerta.pedidoFim)
    if (!a || !b) return null
    return a === b ? a : `${a} a ${b}`
  })()

  return (
    <div className="rounded-2xl border border-amber-300/35 bg-amber-300/10 px-4 py-4 text-sm text-amber-800 dark:text-amber-100 shadow-[0_0_35px_rgba(251,191,36,0.12)]">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-200" />
        <div className="min-w-0 space-y-2">
          <p className="font-medium text-amber-800 dark:text-amber-100">Período já convocado</p>
          <p className="text-xs leading-relaxed text-amber-800/85 dark:text-amber-100/85">
            {quem} já tem convocação
            {periodo ? (
              <>
                {" de "}
                <span className="font-medium text-amber-900 dark:text-amber-50">{periodo}</span>
              </>
            ) : (
              " em um período que cruza com as datas informadas"
            )}
            .
          </p>
          {podeEmendar && fim && sugestaoFmt ? (
            <>
              <p className="text-xs leading-relaxed text-amber-800/85 dark:text-amber-100/85">
                O dia <span className="font-medium text-amber-900 dark:text-amber-50">{fim}</span>{" "}
                já está pago nessa convocação — lançar de novo pagaria em dobro. Para emendar,
                comece em{" "}
                <span className="font-medium text-amber-900 dark:text-amber-50">{sugestaoFmt}</span>.
              </p>
              {onUsarData && sugestao && (
                <button
                  type="button"
                  onClick={() => onUsarData(sugestao)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-300/15 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-50 transition hover:bg-amber-300/25"
                >
                  Usar {sugestaoFmt}
                </button>
              )}
            </>
          ) : (
            <p className="text-xs leading-relaxed text-amber-800/85 dark:text-amber-100/85">
              {pedidoFmt
                ? `O período que você pediu (${pedidoFmt}) está dentro dessa convocação — não há nada a lançar.`
                : "O período informado está dentro dessa convocação — não há nada a lançar."}
            </p>
          )}
          {alerta.conflito?.item_url && (
            <a
              href={alerta.conflito.item_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-50 underline-offset-4 transition hover:underline"
            >
              Abrir convocação existente
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.28em] text-foreground/45">
        {label}
      </p>
      <p className="mt-1 truncate text-sm text-foreground/75">{value}</p>
    </div>
  )
}

function FieldLabel({
  children,
  required,
  hint,
}: {
  children: React.ReactNode
  required?: boolean
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground/85">
        {children}
        {required && <span className="ml-1 text-rose-700 dark:text-rose-300">*</span>}
      </label>
      {hint && <p className="text-[11px] text-foreground/45">{hint}</p>}
    </div>
  )
}

function FieldWrap({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <FieldLabel required={required} hint={hint}>
        {label}
      </FieldLabel>
      {children}
    </div>
  )
}

function FieldText({
  label,
  hint,
  value,
  onChange,
  required,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  required?: boolean
}) {
  return (
    <div className="space-y-2">
      <FieldLabel required={required} hint={hint}>
        {label}
      </FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="liquid-input w-full px-4 py-3 text-sm"
      />
    </div>
  )
}

function FieldFile({
  label,
  file,
  onChange,
}: {
  label: string
  file: File | null
  onChange: (f: File | null) => void
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      {file ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] px-4 py-3 text-sm text-foreground/85">
          <span className="flex min-w-0 items-center gap-2">
            <FileUp className="size-4 shrink-0 text-emerald-700 dark:text-emerald-200" />
            <span className="truncate">{file.name}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.05)] text-foreground/65 transition hover:border-rose-300/40 hover:bg-rose-300/10 hover:text-rose-700 dark:text-rose-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <label className="liquid-field flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed px-4 py-8 text-center transition hover:border-[rgb(var(--accent-rgb)/0.4)]">
          <FileUp className="size-5 text-foreground/55" />
          <span className="text-xs text-foreground/65">
            <span className="text-[rgb(var(--accent-rgb))] underline-offset-2 hover:underline">
              Escolha um arquivo
            </span>{" "}
            ou arraste e solte aqui
          </span>
          <input
            type="file"
            className="sr-only"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
    </div>
  )
}
