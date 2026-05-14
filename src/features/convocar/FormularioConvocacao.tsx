import { useMemo, useState } from "react"
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
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import { GlassDatePicker } from "./GlassDatePicker"
import { GlassSelect } from "./GlassSelect"
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

type Props = {
  empregado: EmpregadoRM
  onTrocarEmpregado: () => void
  onSucesso: (itemId: string, itemUrl: string) => void
}

type FormState = {
  name: string
  escala: string
  solicitante: Solicitante | ""
  contrato: Contrato | ""
  localUnidade: string
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
}

export function FormularioConvocacao({
  empregado,
  onTrocarEmpregado,
  onSucesso,
}: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(empregado))
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [alertaConflito, setAlertaConflito] =
    useState<AlertaConflito | null>(null)
  const opcoesQuery = useOpcoesConvocacao()
  const mutation = useCriarConvocacao()
  const opcoes = opcoesQuery.data ?? OPCOES_CONVOCACAO_FALLBACK

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
      sabado: form.sabado as SimNao,
      insalubridade: form.insalubridade as Insalubridade,
      interior: form.interior as SimNao,
      dataInicio: form.dataInicio,
      dataFim: form.dataFim,
      justificativa: form.justificativa as Justificativa,
      empregadoSubstituido: form.empregadoSubstituido.trim(),
      termoConvocacao: form.termoConvocacao,
      termoInsalubridade: form.termoInsalubridade,
    }
    try {
      const res = await mutation.mutateAsync(payload)
      onSucesso(res.itemId, res.itemUrl)
    } catch (err) {
      if (
        err instanceof ConvocacaoApiError &&
        err.status === 409 &&
        err.erro === "convocacao_conflitante"
      ) {
        setAlertaConflito({
          mensagem:
            err.message ||
            "Data divergente: este intermitente já foi convocado neste período.",
          conflito: err.conflito,
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
        className="inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/85"
      >
        <ArrowLeft className="size-3.5" />
        Trocar empregado
      </button>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/55">
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
            onChange={(v) => set("contrato", v as Contrato | "")}
            options={opcoes.contratos}
          />
        </FieldWrap>

        <FieldText
          label="Local/Unidade"
          value={form.localUnidade}
          onChange={(v) => set("localUnidade", v)}
          required
        />

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
            />
          </FieldWrap>
          <FieldWrap label="Data/Fim" required>
            <GlassDatePicker
              label="Data/Fim"
              value={form.dataFim}
              onChange={(v) => set("dataFim", v)}
              min={form.dataInicio || undefined}
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

      {alertaConflito && <AlertaConflito alerta={alertaConflito} />}

      {erroGeral && (
        <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-xs text-rose-200">
          {erroGeral}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || !camposObrigatoriosOk}
        className="plane-btn glow-gold inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-medium text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background:
            "linear-gradient(135deg, #e8c275 0%, #d4a64a 55%, #6ea0ff 130%)",
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

function AlertaConflito({ alerta }: { alerta: AlertaConflito }) {
  const inicio = formatarDataConflito(alerta.conflito?.data_inicio)
  const fim = formatarDataConflito(alerta.conflito?.data_fim)
  const periodo = inicio && fim ? `${inicio} a ${fim}` : null

  return (
    <div className="rounded-2xl border border-rose-300/35 bg-rose-300/10 px-4 py-4 text-sm text-rose-100 shadow-[0_0_35px_rgba(251,113,133,0.12)]">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-200" />
        <div className="min-w-0 space-y-2">
          <p className="font-medium text-rose-100">Data divergente</p>
          <p className="text-xs leading-relaxed text-rose-100/85">
            Este intermitente já foi convocado para um período que cruza com as
            datas informadas.
          </p>
          {periodo && (
            <p className="text-xs leading-relaxed text-rose-100/85">
              Convocação existente:{" "}
              <span className="font-medium text-rose-50">{periodo}</span>.
            </p>
          )}
          {alerta.conflito?.item_url && (
            <a
              href={alerta.conflito.item_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-50 underline-offset-4 transition hover:underline"
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
      <p className="text-[10px] uppercase tracking-[0.28em] text-white/45">
        {label}
      </p>
      <p className="mt-1 truncate text-sm text-white/75">{value}</p>
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
      <label className="block text-sm font-medium text-white/85">
        {children}
        {required && <span className="ml-1 text-rose-300">*</span>}
      </label>
      {hint && <p className="text-[11px] text-white/45">{hint}</p>}
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
        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 backdrop-blur transition focus:border-[#e8c275]/50 focus:bg-white/[0.07] focus:outline-none"
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
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] px-4 py-3 text-sm text-white/85">
          <span className="flex min-w-0 items-center gap-2">
            <FileUp className="size-4 shrink-0 text-emerald-200" />
            <span className="truncate">{file.name}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/65 transition hover:border-rose-300/40 hover:bg-rose-300/10 hover:text-rose-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-8 text-center transition hover:border-[#e8c275]/40 hover:bg-white/[0.05]">
          <FileUp className="size-5 text-white/55" />
          <span className="text-xs text-white/65">
            <span className="text-[#e8c275] underline-offset-2 hover:underline">
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
