import { useMemo, useState } from "react"
import {
  addDays,
  endOfMonth,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Loader2,
  WalletCards,
  Users,
} from "lucide-react"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"
import { ChoiceButton } from "@/features/atestados/ChoiceButton"
import {
  isFeriadoNacional,
  nomeFeriadoNacional,
} from "@/lib/feriadosBr"

import {
  GRUPO_META,
  SEDUC_SUBGRUPOS,
  TONE_CLASSES,
  type ContratoMeta,
  type GrupoContratoId,
} from "./contratosMeta"
import {
  type BeneficioPontoFacultativo,
  type ContratoPontoFacultativo,
  type PontoFacultativoPayload,
  type PontoFacultativoPreview,
} from "./types"
import {
  useAplicarPontoFacultativo,
  usePreviewPontoFacultativo,
} from "./usePontoFacultativo"

type Etapa = "contrato" | "data" | "beneficios" | "confirmar" | "sucesso"

function etapaKey(e: Etapa): string {
  return `ponto-${e}`
}

function formatarData(iso: string): string {
  return format(parseISO(iso), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function payloadValido(
  contrato: ContratoPontoFacultativo | null,
  data: string | null,
  beneficios: BeneficioPontoFacultativo[],
): PontoFacultativoPayload | null {
  if (!contrato || !data || beneficios.length === 0) return null
  return { contrato, data, beneficios }
}

export function PontoFacultativoPage() {
  const [etapa, setEtapa] = useState<Etapa>("contrato")
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const [contrato, setContrato] = useState<ContratoPontoFacultativo | null>(null)
  const [data, setData] = useState<string | null>(null)
  const [beneficios, setBeneficios] = useState<BeneficioPontoFacultativo[]>([])
  const [preview, setPreview] = useState<PontoFacultativoPreview | null>(null)

  const previewMut = usePreviewPontoFacultativo()
  const aplicarMut = useAplicarPontoFacultativo()

  function ir(next: Etapa, dir: SlideDirection = "forward") {
    setDirecao(dir)
    setEtapa(next)
  }

  function toggleBeneficio(b: BeneficioPontoFacultativo) {
    setBeneficios((prev) =>
      prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b],
    )
  }

  async function carregarPreview() {
    const payload = payloadValido(contrato, data, beneficios)
    if (!payload) return
    const r = await previewMut.mutateAsync(payload)
    setPreview(r)
    ir("confirmar")
  }

  async function aplicar() {
    const payload = payloadValido(contrato, data, beneficios)
    if (!payload) return
    const r = await aplicarMut.mutateAsync(payload)
    setPreview(r)
    ir("sucesso")
  }

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="glass-strong relative w-full max-w-3xl p-8 sm:p-10">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-200/70">
              Ponto facultativo
            </p>
            <h1 className="text-display mt-2 text-4xl leading-tight text-white sm:text-5xl">
              Desconto por contrato
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/58">
              Escolha contrato, dia e benefícios. A confirmação recalcula no
              backend todos os intermitentes convocados naquele dia.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Voltar ao hub"
          >
            <ArrowLeft className="size-4" />
          </Link>
        </header>

        <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
          {etapa === "contrato" && (
            <EtapaContrato
              contrato={contrato}
              onSelecionar={(c) => {
                setContrato(c)
                setPreview(null)
                ir("data")
              }}
            />
          )}
          {etapa === "data" && (
            <EtapaData
              data={data}
              onVoltar={() => ir("contrato", "backward")}
              onSelecionar={(d) => {
                setData(d)
                setPreview(null)
                ir("beneficios")
              }}
            />
          )}
          {etapa === "beneficios" && (
            <EtapaBeneficios
              contrato={contrato}
              data={data}
              beneficios={beneficios}
              erro={previewMut.error instanceof Error ? previewMut.error.message : null}
              carregando={previewMut.isPending}
              onToggle={toggleBeneficio}
              onVoltar={() => ir("data", "backward")}
              onPreview={carregarPreview}
            />
          )}
          {etapa === "confirmar" && preview && (
            <EtapaConfirmar
              preview={preview}
              erro={aplicarMut.error instanceof Error ? aplicarMut.error.message : null}
              carregando={aplicarMut.isPending}
              onVoltar={() => ir("beneficios", "backward")}
              onAplicar={aplicar}
            />
          )}
          {etapa === "sucesso" && preview && (
            <EtapaSucesso
              preview={preview}
              onNovo={() => {
                setPreview(null)
                setData(null)
                setBeneficios([])
                ir("contrato", "backward")
              }}
            />
          )}
        </SlideStack>
      </div>
    </main>
  )
}

function EtapaContrato({
  contrato,
  onSelecionar,
}: {
  contrato: ContratoPontoFacultativo | null
  onSelecionar: (c: ContratoPontoFacultativo) => void
}) {
  // Subview controlada localmente — click em SEDUC abre subset
  // (ESCOLA / SEDE / INTERIOR). Outros grupos selecionam direto.
  const [subview, setSubview] = useState<"principal" | "seduc">("principal")

  if (subview === "seduc") {
    return (
      <section>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-white/82">
            <GraduationCap className="size-5 text-amber-300" />
            <h2 className="text-lg font-medium">SEDUC · escolha o subgrupo</h2>
          </div>
          <button
            type="button"
            onClick={() => setSubview("principal")}
            className="inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/90"
          >
            <ArrowLeft className="size-3.5" />
            Voltar
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {SEDUC_SUBGRUPOS.map(({ contrato: c, meta }) => (
            <TileContrato
              key={c}
              meta={meta}
              selecionado={contrato === c}
              onClick={() => onSelecionar(c)}
            />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="mb-5 flex items-center gap-3 text-white/82">
        <Building2 className="size-5 text-emerald-200" />
        <h2 className="text-lg font-medium">Contrato afetado</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.entries(GRUPO_META) as [GrupoContratoId, ContratoMeta][]).map(
          ([id, meta]) => {
            const ehSeducGrupo = id === "SEDUC"
            const contratoCorrente =
              !ehSeducGrupo && (contrato === id as ContratoPontoFacultativo)
            return (
              <TileContrato
                key={id}
                meta={meta}
                selecionado={!!contratoCorrente}
                temSubgrupo={ehSeducGrupo}
                onClick={() => {
                  if (ehSeducGrupo) {
                    setSubview("seduc")
                    return
                  }
                  onSelecionar(id as ContratoPontoFacultativo)
                }}
              />
            )
          },
        )}
      </div>
    </section>
  )
}

function TileContrato({
  meta,
  selecionado,
  temSubgrupo,
  onClick,
}: {
  meta: ContratoMeta
  selecionado: boolean
  temSubgrupo?: boolean
  onClick: () => void
}) {
  const tones = TONE_CLASSES[meta.tone]
  const Icon = meta.icon

  function handleTiltMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleTiltLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseMove={handleTiltMove}
      onMouseLeave={handleTiltLeave}
      className={`glass-tile glass-tile-3d group relative flex w-full items-center gap-3.5 rounded-2xl border px-4 py-4 text-left transition ${
        tones.border
      } ${tones.bg} ${tones.bgHover} ${tones.glow} ${
        selecionado ? "ring-2 ring-offset-2 ring-offset-transparent ring-white/60" : ""
      }`}
    >
      <div
        className={`icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ${tones.iconBg} ${tones.iconRing}`}
      >
        <Icon className={`icon-3d-only size-5 ${tones.iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium leading-tight text-white/95">
          {meta.label}
        </p>
        <p className={`mt-0.5 text-xs ${tones.text} opacity-75`}>
          {meta.descricao}
        </p>
        {(meta.ativos != null || meta.hoje != null) && (
          <p className="mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/45">
            {meta.ativos != null && (
              <span>
                <span className="font-mono text-white/80">{meta.ativos}</span>{" "}
                ativos
              </span>
            )}
            {meta.ativos != null && meta.hoje != null && (
              <span className="text-white/25">·</span>
            )}
            {meta.hoje != null && (
              <span>
                <span className="font-mono text-white/80">{meta.hoje}</span>{" "}
                hoje
              </span>
            )}
          </p>
        )}
      </div>
      {temSubgrupo ? (
        <ChevronRight className="size-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white/80" />
      ) : null}
    </button>
  )
}

function EtapaData({
  data,
  onVoltar,
  onSelecionar,
}: {
  data: string | null
  onVoltar: () => void
  onSelecionar: (data: string) => void
}) {
  return (
    <section>
      <div className="mb-5 flex items-center gap-3 text-white/82">
        <CalendarDays className="size-5 text-emerald-200" />
        <h2 className="text-lg font-medium">Dia do mês atual</h2>
      </div>
      <CalendarioMesAtual data={data} onSelecionar={onSelecionar} />
      <div className="mt-6">
        <ChoiceButton onClick={onVoltar}>Voltar</ChoiceButton>
      </div>
    </section>
  )
}

function CalendarioMesAtual({
  data,
  onSelecionar,
}: {
  data: string | null
  onSelecionar: (data: string) => void
}) {
  const hoje = useMemo(() => new Date(), [])
  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(hoje), { weekStartsOn: 0 })
    const fim = endOfMonth(hoje)
    const out: Date[] = []
    let cursor = inicio
    while (cursor <= fim) {
      out.push(cursor)
      cursor = addDays(cursor, 1)
    }
    return out
  }, [hoje])

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-display mb-4 text-center text-2xl capitalize text-white">
        {format(hoje, "MMMM 'de' yyyy", { locale: ptBR })}
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={`${d}-${i}`} className="py-1 text-center text-[10px] uppercase tracking-wider text-white/38">
            {d}
          </div>
        ))}
        {dias.map((d) => {
          const iso = format(d, "yyyy-MM-dd")
          const noMes = isSameMonth(d, hoje)
          const domingo = d.getDay() === 0
          const feriado = nomeFeriadoNacional(iso)
          const disabled = !noMes || domingo || isFeriadoNacional(iso)
          const selecionado = data === iso
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              title={feriado ?? (domingo ? "Domingo" : undefined)}
              onClick={() => onSelecionar(iso)}
              className={`relative flex h-12 items-center justify-center rounded-xl text-sm font-medium transition ${
                selecionado
                  ? "bg-emerald-300 text-[#02120d] shadow-[0_0_22px_rgba(110,231,183,0.45)]"
                  : disabled
                    ? "cursor-not-allowed text-white/16"
                    : "text-white/88 hover:bg-emerald-300/12 hover:text-emerald-100"
              }`}
            >
              {d.getDate()}
              {feriado && noMes && (
                <span className="absolute bottom-1 size-1 rounded-full bg-amber-200/75" />
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-white/45">
        Domingos e feriados nacionais ficam bloqueados. Sábados seguem
        liberados porque algumas convocações têm sábado ativo ou extra.
      </p>
    </div>
  )
}

function EtapaBeneficios({
  contrato,
  data,
  beneficios,
  erro,
  carregando,
  onToggle,
  onVoltar,
  onPreview,
}: {
  contrato: ContratoPontoFacultativo | null
  data: string | null
  beneficios: BeneficioPontoFacultativo[]
  erro: string | null
  carregando: boolean
  onToggle: (b: BeneficioPontoFacultativo) => void
  onVoltar: () => void
  onPreview: () => void
}) {
  return (
    <section>
      <div className="mb-5 flex items-center gap-3 text-white/82">
        <WalletCards className="size-5 text-emerald-200" />
        <h2 className="text-lg font-medium">Benefícios a descontar</h2>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/62">
        {contrato} · {data ? formatarData(data) : ""}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceButton
          selected={beneficios.includes("VR")}
          onClick={() => onToggle("VR")}
          className="min-h-20 justify-start px-4 text-left"
        >
          <span>
            <span className="block text-base font-medium">VR</span>
            <span className="mt-1 block text-sm text-white/48">Vale refeição</span>
          </span>
        </ChoiceButton>
        <ChoiceButton
          selected={beneficios.includes("VT")}
          onClick={() => onToggle("VT")}
          className="min-h-20 justify-start px-4 text-left"
        >
          <span>
            <span className="block text-base font-medium">VT</span>
            <span className="mt-1 block text-sm text-white/48">Vale transporte</span>
          </span>
        </ChoiceButton>
      </div>
      {erro && (
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {erro}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
        <ChoiceButton onClick={onVoltar} disabled={carregando}>
          Voltar
        </ChoiceButton>
        <ChoiceButton
          variant="primary"
          disabled={beneficios.length === 0 || carregando}
          onClick={onPreview}
        >
          {carregando && <Loader2 className="size-4 animate-spin" />}
          Pré-visualizar afetados
        </ChoiceButton>
      </div>
    </section>
  )
}

function EtapaConfirmar({
  preview,
  erro,
  carregando,
  onVoltar,
  onAplicar,
}: {
  preview: PontoFacultativoPreview
  erro: string | null
  carregando: boolean
  onVoltar: () => void
  onAplicar: () => void
}) {
  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-white/82">
          <Users className="size-5 text-emerald-200" />
          <h2 className="text-lg font-medium">Prévia de afetados</h2>
        </div>
        <span className="rounded-full border border-emerald-200/25 bg-emerald-200/10 px-3 py-1 text-xs text-emerald-100">
          {preview.totalColaboradores} convocados
        </span>
      </div>
      <ResumoTotais preview={preview} />
      <div className="mt-5 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
        {preview.itens.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/55">
            Nenhum intermitente ativo encontrado para esse contrato e dia.
          </div>
        ) : (
          preview.itens.map((item) => (
            <div
              key={`${item.itemEntradaId}-${item.chapa}`}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-white/92">{item.nome}</p>
                  <p className="mt-1 text-xs text-white/45">
                    {item.chapa} · {item.periodoInicio} a {item.periodoFim}
                  </p>
                </div>
                <p className="text-sm font-semibold text-emerald-100">
                  {moeda(item.total)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2 py-1 ${item.aplicaVR ? "bg-emerald-300/14 text-emerald-100" : "bg-white/[0.04] text-white/36"}`}>
                  VR {moeda(item.valorVR)}
                </span>
                <span className={`rounded-full px-2 py-1 ${item.aplicaVT ? "bg-sky-300/14 text-sky-100" : "bg-white/[0.04] text-white/36"}`}>
                  VT {moeda(item.valorVT)}
                </span>
                {item.avisos.map((a) => (
                  <span key={a} className="rounded-full bg-amber-300/12 px-2 py-1 text-amber-100">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {erro && (
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {erro}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
        <ChoiceButton onClick={onVoltar} disabled={carregando}>
          Voltar
        </ChoiceButton>
        <ChoiceButton
          variant="primary"
          onClick={onAplicar}
          disabled={carregando || preview.itens.length === 0}
        >
          {carregando && <Loader2 className="size-4 animate-spin" />}
          Confirmar ponto facultativo
        </ChoiceButton>
      </div>
    </section>
  )
}

function ResumoTotais({ preview }: { preview: PontoFacultativoPreview }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/38">VR</p>
        <p className="mt-1 text-lg font-semibold text-white">{moeda(preview.totalVR)}</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/38">VT</p>
        <p className="mt-1 text-lg font-semibold text-white">{moeda(preview.totalVT)}</p>
      </div>
      <div className="rounded-2xl border border-emerald-200/25 bg-emerald-200/10 px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-100/70">Total</p>
        <p className="mt-1 text-lg font-semibold text-emerald-50">{moeda(preview.total)}</p>
      </div>
    </div>
  )
}

function EtapaSucesso({
  preview,
  onNovo,
}: {
  preview: PontoFacultativoPreview
  onNovo: () => void
}) {
  return (
    <section className="text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-emerald-200/30 bg-emerald-200/12 text-emerald-100">
        <CheckCircle2 className="size-7" />
      </div>
      <h2 className="text-display mt-5 text-4xl text-white">Aplicado</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/58">
        O ledger dos históricos foi marcado e a base de desconto recebeu os
        valores do ponto facultativo.
      </p>
      <div className="mt-6">
        <ResumoTotais preview={preview} />
      </div>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <ChoiceButton onClick={onNovo}>Novo ponto</ChoiceButton>
        <Link
          to="/"
          className="choice-btn choice-btn--primary inline-flex justify-center"
        >
          Voltar ao hub
        </Link>
      </div>
    </section>
  )
}
