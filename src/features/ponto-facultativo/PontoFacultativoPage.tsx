import { useEffect, useMemo, useState } from "react"
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
import { Link, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Coins,
  GraduationCap,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  UserX,
  Users,
  UtensilsCrossed,
  WalletCards,
} from "lucide-react"

import { useRegistrarVoltar } from "@/components/NavContext"
import { SlideStack, type SlideDirection } from "@/components/SlideStack"
import { ChoiceButton } from "@/features/atestados/ChoiceButton"
import { isFeriado, nomeFeriado, useFeriados } from "@/lib/feriadosBoard"
import { filtrarPorBusca } from "@/lib/buscaUnidade"

import { mockPreview } from "./api"
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
  type PontoFacultativoItem,
  type PontoFacultativoPayload,
  type PontoFacultativoPreview,
  type UnidadeComCount,
} from "./types"
import {
  useAplicarPontoFacultativo,
  useOpcoesPontoFacultativo,
  usePreviewPontoFacultativo,
} from "./usePontoFacultativo"

type Etapa = "contrato" | "unidade" | "data" | "beneficios" | "confirmar" | "sucesso"

/** Seeds aceitos via `?seed=` — pré-popula estado para testes visuais. */
type Seed =
  | "data"
  | "beneficios"
  | "confirmar-cheio"
  | "confirmar-vazio"
  | "sucesso"

function dataMockISO(): string {
  const d = new Date()
  // dia 5 do mês atual, ou dia atual se já passou
  const dia = Math.min(5, d.getDate())
  return format(new Date(d.getFullYear(), d.getMonth(), dia), "yyyy-MM-dd")
}

function aplicarSeed(seed: string | null): {
  etapa: Etapa
  contrato: ContratoPontoFacultativo | null
  unidade: string | null
  data: string | null
  beneficios: BeneficioPontoFacultativo[]
  preview: PontoFacultativoPreview | null
} {
  const s = seed as Seed
  switch (s) {
    case "data":
      return { etapa: "data", contrato: "SEMSA", unidade: "SEMSA - INTERMITENTE", data: null, beneficios: [], preview: null }
    case "beneficios":
      return {
        etapa: "beneficios",
        contrato: "SEDUC SEDE",
        unidade: "SEDUC - MANAUS",
        data: dataMockISO(),
        beneficios: ["VR"],
        preview: null,
      }
    case "confirmar-cheio": {
      const p: PontoFacultativoPayload = {
        contrato: "SEDUC SEDE",
        unidade: "SEDUC - MANAUS",
        data: dataMockISO(),
        beneficios: ["VR", "VT"],
      }
      return {
        etapa: "confirmar",
        contrato: p.contrato,
        unidade: p.unidade,
        data: p.data,
        beneficios: p.beneficios,
        preview: mockPreview(p),
      }
    }
    case "confirmar-vazio": {
      const p: PontoFacultativoPayload = {
        contrato: "CETAM",
        unidade: "GASTRONOMIA",
        data: dataMockISO(),
        beneficios: ["VR"],
      }
      return {
        etapa: "confirmar",
        contrato: p.contrato,
        unidade: p.unidade,
        data: p.data,
        beneficios: p.beneficios,
        preview: mockPreview(p, { vazio: true }),
      }
    }
    case "sucesso": {
      const p: PontoFacultativoPayload = {
        contrato: "DETRAN",
        unidade: "DETRAN - INTERMITENTE",
        data: dataMockISO(),
        beneficios: ["VR", "VT"],
      }
      return {
        etapa: "sucesso",
        contrato: p.contrato,
        unidade: p.unidade,
        data: p.data,
        beneficios: p.beneficios,
        preview: mockPreview(p),
      }
    }
    default:
      return { etapa: "contrato", contrato: null, unidade: null, data: null, beneficios: [], preview: null }
  }
}

function etapaKey(e: Etapa): string {
  return `ponto-${e}`
}

function formatarData(iso: string): string {
  return format(parseISO(iso), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

/** Mapeia códigos de erro do backend pra mensagens human-readable.
 *  Backend retorna 400 unidade_ambigua / 400 unidade_invalida / 409
 *  sem_intermitentes_para_aplicar — strings cruas confundem operacional. */
function mensagemErroPreview(erro: unknown): string | null {
  if (!erro) return null
  const raw = erro instanceof Error ? erro.message : String(erro)
  if (raw.includes("unidade_ambigua")) {
    return "Encontramos duas unidades com nomes parecidos. Peça ao administrador para revisar o cadastro."
  }
  if (raw.includes("unidade_invalida")) {
    return "Não conseguimos validar essa unidade. Recarregue a lista e tente de novo."
  }
  if (raw.includes("sem_intermitentes_para_aplicar")) {
    return "Nenhum intermitente convocado nessa unidade para essa data. Volte e ajuste a seleção."
  }
  return raw
}

/** Texto humano por código de aviso vindo do preview do backend. */
function legendaAviso(aviso: string | null): {
  titulo: string
  detalhe: string
} {
  switch (aviso) {
    case "sem_intermitentes_unidade_data":
      return {
        titulo: "Nenhum intermitente convocado nesta unidade para esta data",
        detalhe: "Volte e tente outra data, unidade ou contrato antes de aplicar.",
      }
    case "contrato_sem_intermitentes":
      return {
        titulo: "Contrato sem intermitentes ativos",
        detalhe: "Volte e escolha outro contrato.",
      }
    default:
      return {
        titulo: "Nenhum intermitente encontrado",
        detalhe: "Volte e tente outra data, unidade ou contrato antes de aplicar.",
      }
  }
}

function payloadValido(
  contrato: ContratoPontoFacultativo | null,
  unidade: string | null,
  data: string | null,
  beneficios: BeneficioPontoFacultativo[],
): PontoFacultativoPayload | null {
  if (!contrato || !unidade || !data || beneficios.length === 0) return null
  return { contrato, unidade, data, beneficios }
}

export function PontoFacultativoPage() {
  const [search] = useSearchParams()
  const seed = search.get("seed")
  const inicial = useMemo(() => aplicarSeed(seed), [seed])

  const [etapa, setEtapa] = useState<Etapa>(inicial.etapa)
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const [contrato, setContrato] = useState<ContratoPontoFacultativo | null>(inicial.contrato)
  const [unidade, setUnidade] = useState<string | null>(inicial.unidade)
  const [data, setData] = useState<string | null>(inicial.data)
  const [beneficios, setBeneficios] = useState<BeneficioPontoFacultativo[]>(inicial.beneficios)
  const [preview, setPreview] = useState<PontoFacultativoPreview | null>(inicial.preview)

  // Se o seed mudar (navegação interna no /teste/ponto-facultativo), re-aplica.
  useEffect(() => {
    setEtapa(inicial.etapa)
    setContrato(inicial.contrato)
    setUnidade(inicial.unidade)
    setData(inicial.data)
    setBeneficios(inicial.beneficios)
    setPreview(inicial.preview)
  }, [inicial])

  const opcoesQuery = useOpcoesPontoFacultativo()
  const previewMut = usePreviewPontoFacultativo()
  const aplicarMut = useAplicarPontoFacultativo()
  const unidadesContrato = contrato
    ? (opcoesQuery.data?.unidadesPorContrato[contrato] ?? [])
    : []
  const mesReferencia = opcoesQuery.data?.mesReferencia ?? null

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
    const payload = payloadValido(contrato, unidade, data, beneficios)
    if (!payload) return
    const r = await previewMut.mutateAsync(payload)
    setPreview(r)
    ir("confirmar")
  }

  async function aplicar() {
    const payload = payloadValido(contrato, unidade, data, beneficios)
    if (!payload) return
    const r = await aplicarMut.mutateAsync(payload)
    setPreview(r)
    ir("sucesso")
  }

  // Mapeamento reverso de etapas — header navega 1 passo atrás. Quando
  // já está na primeira etapa (contrato), botão fica disabled visualmente
  // pra forçar Home explicit se user quer sair do fluxo.
  const etapaAnterior: Record<Etapa, Etapa | null> = {
    contrato: null,
    unidade: "contrato",
    data: "unidade",
    beneficios: "data",
    confirmar: "beneficios",
    sucesso: null, // sucesso vai pro Hub via CTA dedicado
  }
  function voltarEtapa() {
    const prev = etapaAnterior[etapa]
    if (prev) ir(prev, "backward")
  }
  const podeVoltarEtapa = etapaAnterior[etapa] !== null
  useRegistrarVoltar(podeVoltarEtapa ? voltarEtapa : null)

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="glass-strong card-shimmer relative w-full max-w-3xl p-8 sm:p-10">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow-fade-in text-[11px] uppercase text-emerald-700/70 dark:text-emerald-200/70">
              Ponto facultativo
            </p>
            <h1 className="text-display mt-2 text-4xl leading-tight text-foreground sm:text-5xl">
              Desconto por contrato
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-foreground/58">
              Escolha contrato, unidade, dia e benefícios. Ao confirmar, o
              desconto é aplicado a todos os intermitentes convocados naquele local.
            </p>
          </div>
        </header>

        <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
          {etapa === "contrato" && (
            <EtapaContrato
              contrato={contrato}
              onSelecionar={(c) => {
                setContrato(c)
                setUnidade(null)
                setData(null)
                setBeneficios([])
                setPreview(null)
                ir("unidade")
              }}
            />
          )}
          {etapa === "unidade" && (
            <EtapaUnidade
              contrato={contrato}
              unidade={unidade}
              unidades={unidadesContrato}
              mesReferencia={mesReferencia}
              carregando={opcoesQuery.isPending}
              erro={opcoesQuery.error instanceof Error ? opcoesQuery.error.message : null}
              onVoltar={() => ir("contrato", "backward")}
              onSelecionar={(u) => {
                setUnidade(u)
                setData(null)
                setBeneficios([])
                setPreview(null)
                ir("data")
              }}
            />
          )}
          {etapa === "data" && (
            <EtapaData
              data={data}
              contrato={contrato}
              onVoltar={() => ir("unidade", "backward")}
              onSelecionar={(d) => {
                setData(d)
                setBeneficios([])
                setPreview(null)
                ir("beneficios")
              }}
            />
          )}
          {etapa === "beneficios" && (
            <EtapaBeneficios
              contrato={contrato}
              unidade={unidade}
              data={data}
              beneficios={beneficios}
              erro={mensagemErroPreview(previewMut.error)}
              carregando={previewMut.isPending}
              onToggle={toggleBeneficio}
              onVoltar={() => ir("data", "backward")}
              onPreview={carregarPreview}
            />
          )}
          {etapa === "confirmar" && preview && (
            <EtapaConfirmar
              preview={preview}
              erro={mensagemErroPreview(aplicarMut.error)}
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
                setContrato(null)
                setUnidade(null)
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
          <div className="flex items-center gap-3 text-foreground/82">
            <GraduationCap className="size-5 text-amber-700 dark:text-amber-300" />
            <h2 className="text-lg font-medium">SEDUC · escolha o subgrupo</h2>
          </div>
          <button
            type="button"
            onClick={() => setSubview("principal")}
            className="inline-flex items-center gap-1.5 text-xs text-foreground/55 transition hover:text-foreground/90"
          >
            <ArrowLeft className="size-3.5" />
            Voltar
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {SEDUC_SUBGRUPOS.map(({ contrato: c, meta }, i) => (
            <div
              key={c}
              className="fade-up"
              style={{ animationDelay: `${50 + i * 50}ms` }}
            >
              <TileContrato
                meta={meta}
                selecionado={contrato === c}
                onClick={() => onSelecionar(c)}
              />
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="mb-5 flex items-center gap-3 text-foreground/82">
        <Building2 className="size-5 text-emerald-700 dark:text-emerald-200" />
        <h2 className="text-lg font-medium">Contrato afetado</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.entries(GRUPO_META) as [GrupoContratoId, ContratoMeta][]).map(
          ([id, meta], i) => {
            const ehSeducGrupo = id === "SEDUC"
            const contratoCorrente =
              !ehSeducGrupo && (contrato === id as ContratoPontoFacultativo)
            return (
              <div
                key={id}
                className="fade-up"
                style={{ animationDelay: `${80 + i * 70}ms` }}
              >
                <TileContrato
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
              </div>
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
      data-tone={meta.tone}
      data-anim={meta.animOverride}
      className={`tile-contrato group relative flex w-full items-center gap-3.5 rounded-2xl border border-[rgb(var(--ink)/0.12)] px-4 py-4 text-left ${
        selecionado ? "ring-2 ring-offset-2 ring-offset-transparent ring-[rgb(var(--ink)/0.6)]" : ""
      }`}
    >
      <div
        className={`icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ${tones.iconBg} ${tones.iconRing}`}
      >
        <Icon
          data-icon-anim
          className={`size-5 ${tones.iconColor}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium leading-tight text-foreground/95">
          {meta.label}
        </p>
        <p className={`mt-0.5 text-xs ${tones.text} opacity-75`}>
          {meta.descricao}
        </p>
        {(meta.ativos != null || meta.hoje != null) && (
          <p className="mt-1.5 text-xs">
            {meta.ativos != null && (
              <>
                <span className="font-mono font-medium text-foreground/85">
                  {meta.ativos}
                </span>
                <span className="text-foreground/40"> ativos</span>
              </>
            )}
            {meta.ativos != null && meta.hoje != null && meta.hoje > 0 && (
              <span className="mx-2 text-foreground/25">·</span>
            )}
            {meta.hoje != null && meta.hoje > 0 && (
              <>
                <span className={`font-mono font-medium ${tones.text}`}>
                  {meta.hoje}
                </span>
                <span className="text-foreground/40"> hoje</span>
              </>
            )}
          </p>
        )}
      </div>
      {temSubgrupo ? (
        <ChevronRight
          className={`size-5 shrink-0 transition-all duration-300 ${tones.iconColor} opacity-60 group-hover:translate-x-1 group-hover:opacity-100`}
        />
      ) : null}
    </button>
  )
}

function EtapaUnidade({
  contrato,
  unidade,
  unidades,
  mesReferencia,
  carregando,
  erro,
  onVoltar,
  onSelecionar,
}: {
  contrato: ContratoPontoFacultativo | null
  unidade: string | null
  unidades: UnidadeComCount[]
  mesReferencia: string | null
  carregando: boolean
  erro: string | null
  onVoltar: () => void
  onSelecionar: (unidade: string) => void
}) {
  const [busca, setBusca] = useState("")
  const semUnidades = !carregando && unidades.length === 0

  // Ordena: com pessoas (qtd desc, alfabético tiebreaker) > sem pessoas (alfabético).
  // Operacional vê o que tem gente primeiro, vazios cinzas no final.
  const unidadesOrdenadas = useMemo(() => {
    const comPessoas = unidades
      .filter((u) => u.qtdIntermitentes > 0)
      .sort((a, b) => b.qtdIntermitentes - a.qtdIntermitentes || a.label.localeCompare(b.label))
    const semPessoas = unidades
      .filter((u) => u.qtdIntermitentes === 0)
      .sort((a, b) => a.label.localeCompare(b.label))
    return [...comPessoas, ...semPessoas]
  }, [unidades])

  const unidadesFiltradas = useMemo(() => {
    if (!busca.trim()) return unidadesOrdenadas
    const labels = unidadesOrdenadas.map((u) => u.label)
    const filtrados = new Set(filtrarPorBusca(labels, busca))
    return unidadesOrdenadas.filter((u) => filtrados.has(u.label))
  }, [busca, unidadesOrdenadas])

  const totalComPessoas = useMemo(
    () => unidades.filter((u) => u.qtdIntermitentes > 0).length,
    [unidades],
  )
  const totalConvocacoes = useMemo(
    () => unidades.reduce((acc, u) => acc + u.qtdIntermitentes, 0),
    [unidades],
  )
  const todasVazias = !carregando && unidades.length > 0 && totalComPessoas === 0

  // Auto-select quando só 1 unidade COM PESSOAS — usuário não precisa clicar.
  useEffect(() => {
    if (carregando) return
    const comPessoas = unidades.filter((u) => u.qtdIntermitentes > 0)
    if (comPessoas.length === 1 && !unidade) {
      onSelecionar(comPessoas[0].label)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidades, carregando])

  useEffect(() => {
    setBusca("")
  }, [contrato])

  return (
    <section>
      <div className="mb-5 flex items-center gap-3 text-foreground/82">
        <MapPin className="size-5 text-emerald-700 dark:text-emerald-200" />
        <h2 className="text-lg font-medium">Unidade afetada</h2>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {contrato && (
          <span className="chip-context-glass">
            <Building2 className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
            {contrato}
          </span>
        )}
        {mesReferencia && totalConvocacoes > 0 && (
          <span className="chip-context-glass tone-emerald">
            {totalConvocacoes} convocações ativas em {mesReferencia}
          </span>
        )}
      </div>

      {carregando && (
        <div className="space-y-2.5">
          <p className="px-1 text-xs text-foreground/45">Carregando unidades oficiais do RM…</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-glass min-h-14"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        </div>
      )}

      {erro && (
        <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100">
          {erro}
        </p>
      )}

      {semUnidades && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.02)] px-5 py-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/55">
            <UserX className="size-5" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground/78">
            Não há unidades cadastradas para este contrato
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-foreground/45">
            O Plan não tem unidade preenchida para esse contrato. Volte e escolha
            outro contrato ou confira o cadastro no monday.
          </p>
        </div>
      )}

      {todasVazias && (
        <div className="rounded-2xl border border-dashed border-amber-200/25 bg-amber-300/[0.06] px-5 py-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-amber-200/30 bg-amber-300/15 text-amber-700 dark:text-amber-200">
            <UserX className="size-5" />
          </div>
          <p className="mt-4 text-sm font-medium text-amber-700 dark:text-amber-50">
            Nenhuma unidade tem intermitentes convocados em {mesReferencia ?? "este mês"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-amber-700/65 dark:text-amber-100/65">
            Volte e escolha outro contrato — ou aguarde novas convocações serem cadastradas no Plan.
          </p>
        </div>
      )}

      {!carregando && unidades.length > 0 && !todasVazias && (
        <div className="space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar unidade"
              className="h-12 w-full rounded-2xl border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.04)] pl-10 pr-4 text-sm text-foreground outline-none transition placeholder:text-foreground/30 focus:border-emerald-200/45 focus:bg-[rgb(var(--ink)/0.07)]"
            />
          </label>

          <div className="flex items-center justify-between gap-3 text-xs text-foreground/45">
            <span>
              {unidadesFiltradas.length} unidades · {totalComPessoas} com convocações
            </span>
            <span>{unidades.length} cadastradas no RM</span>
          </div>

          {unidadesFiltradas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.02)] px-5 py-8 text-center">
              <p className="text-sm font-medium text-foreground/78">
                Nenhuma unidade encontrada para esse termo
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-foreground/45">
                Tente buscar por uma parte do nome, sem acento ou abreviação.
              </p>
            </div>
          ) : (
            <div className="grid max-h-[25rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {unidadesFiltradas.map((u, i) => {
                const vazia = u.qtdIntermitentes === 0
                const selected = unidade === u.label
                return (
                  <button
                    key={u.label}
                    type="button"
                    disabled={vazia}
                    onClick={(e) => {
                      // Captura coords do click pra ancorar ripple
                      const target = e.currentTarget
                      const rect = target.getBoundingClientRect()
                      target.style.setProperty("--ripple-x", `${e.clientX - rect.left}px`)
                      target.style.setProperty("--ripple-y", `${e.clientY - rect.top}px`)
                      onSelecionar(u.label)
                    }}
                    title={vazia ? "Nenhum intermitente convocado nesta unidade este mês" : undefined}
                    className={`fade-up tile-unidade ${vazia ? "" : "tile-ripple-emerald"} flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left backdrop-blur-md transition ${
                      selected
                        ? "border-emerald-200/55 bg-emerald-200/16 text-emerald-700 dark:text-emerald-50 shadow-[0_0_18px_-6px_rgba(110,231,183,0.55)]"
                        : vazia
                          ? "tile-unidade-vazio cursor-not-allowed border-[rgb(var(--ink)/0.08)] bg-[rgb(var(--ink)/0.02)] text-foreground/35"
                          : "border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.035)] text-foreground/82 hover:border-emerald-200/35 hover:bg-emerald-200/[0.07] hover:text-foreground/95"
                    }`}
                    style={{ animationDelay: `${50 + Math.min(i, 12) * 20}ms` }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium leading-snug">
                        {u.label}
                        {u.foraRm && (
                          <span className="ml-1.5 align-middle text-[9px] uppercase tracking-wider text-amber-700/65 dark:text-amber-200/65">
                            fora-rm
                          </span>
                        )}
                      </span>
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          vazia
                            ? "border-[rgb(var(--ink)/0.08)] bg-[rgb(var(--ink)/0.02)] text-foreground/30"
                            : "border-emerald-300/35 bg-emerald-300/10 text-emerald-700/95 dark:text-emerald-200/95"
                        }`}
                      >
                        {vazia
                          ? "sem convocações"
                          : `${u.qtdIntermitentes} ${u.qtdIntermitentes === 1 ? "pessoa" : "pessoas"}`}
                      </span>
                    </div>
                    {!vazia && <ChevronRight className="size-4 shrink-0 text-foreground/35" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <ChoiceButton onClick={onVoltar}>Voltar</ChoiceButton>
      </div>
    </section>
  )
}

function EtapaData({
  data,
  contrato,
  onVoltar,
  onSelecionar,
}: {
  data: string | null
  contrato: string | null
  onVoltar: () => void
  onSelecionar: (data: string) => void
}) {
  return (
    <section>
      <div className="mb-5 flex items-center gap-3 text-foreground/82">
        <CalendarDays className="size-5 text-emerald-700 dark:text-emerald-200" />
        <h2 className="text-lg font-medium">Dia do mês atual</h2>
      </div>
      <CalendarioMesAtual data={data} contrato={contrato} onSelecionar={onSelecionar} />
      <div className="mt-6">
        <ChoiceButton onClick={onVoltar}>Voltar</ChoiceButton>
      </div>
    </section>
  )
}

function CalendarioMesAtual({
  data,
  contrato,
  onSelecionar,
}: {
  data: string | null
  contrato: string | null
  onSelecionar: (data: string) => void
}) {
  useFeriados()
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
    <div className="rounded-2xl border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.03)] p-4">
      <p className="text-display mb-4 text-center text-2xl capitalize text-foreground">
        {format(hoje, "MMMM 'de' yyyy", { locale: ptBR })}
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={`${d}-${i}`} className="py-1 text-center text-[10px] uppercase tracking-wider text-foreground/38">
            {d}
          </div>
        ))}
        {dias.map((d) => {
          const iso = format(d, "yyyy-MM-dd")
          const noMes = isSameMonth(d, hoje)
          const domingo = d.getDay() === 0
          const feriado = nomeFeriado(iso, contrato)
          const disabled = !noMes || domingo || isFeriado(iso, contrato)
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
                    ? "cursor-not-allowed text-foreground/16"
                    : "text-foreground/88 hover:bg-emerald-300/12 hover:text-emerald-700 dark:text-emerald-100"
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
      <p className="mt-4 text-xs leading-relaxed text-foreground/45">
        Domingos e feriados nacionais ficam bloqueados. Sábados seguem
        liberados porque algumas convocações têm sábado ativo ou extra.
      </p>
    </div>
  )
}

function EtapaBeneficios({
  contrato,
  unidade,
  data,
  beneficios,
  erro,
  carregando,
  onToggle,
  onVoltar,
  onPreview,
}: {
  contrato: ContratoPontoFacultativo | null
  unidade: string | null
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
      <div className="mb-5 flex items-center gap-3 text-foreground/82">
        <WalletCards className="size-5 text-emerald-700 dark:text-emerald-200" />
        <h2 className="text-lg font-medium">Benefícios a descontar</h2>
      </div>

      {/* Chips do contexto — substitui a barra vazia anterior */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {contrato && (
          <span className="chip-context-glass">
            <Building2 className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
            {contrato}
          </span>
        )}
        {unidade && (
          <span className="chip-context-glass">
            <MapPin className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
            {unidade}
          </span>
        )}
        {data && (
          <span className="chip-context-glass">
            <CalendarDays className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
            {formatarData(data)}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TileBeneficio
          icone={UtensilsCrossed}
          tone="emerald"
          titulo="VR"
          descricao="Vale refeição"
          selecionado={beneficios.includes("VR")}
          onClick={() => onToggle("VR")}
        />
        <TileBeneficio
          icone={Coins}
          tone="sky"
          titulo="VT"
          descricao="Vale transporte"
          selecionado={beneficios.includes("VT")}
          onClick={() => onToggle("VT")}
        />
      </div>

      {erro && (
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100">
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

function TileBeneficio({
  icone: Icone,
  tone,
  titulo,
  descricao,
  selecionado,
  onClick,
}: {
  icone: typeof UtensilsCrossed
  tone: "emerald" | "sky"
  titulo: string
  descricao: string
  selecionado: boolean
  onClick: () => void
}) {
  const tones = TONE_CLASSES[tone]

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
      data-tone={tone}
      data-selected={selecionado || undefined}
      className="tile-contrato tile-beneficio group relative flex w-full items-center gap-4 rounded-2xl border border-[rgb(var(--ink)/0.12)] px-4 py-5 text-left"
    >
      <div
        className={`icon-3d-host flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 ${tones.iconBg} ${tones.iconRing}`}
      >
        <Icone className={`size-5 ${tones.iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold leading-tight text-foreground">
          {titulo}
        </p>
        <p className="mt-0.5 text-xs text-foreground/55">{descricao}</p>
      </div>
      <div
        aria-hidden
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border transition ${
          selecionado
            ? tone === "emerald"
              ? "border-emerald-300/70 bg-emerald-300/25"
              : "border-sky-300/70 bg-sky-300/25"
            : "border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.03)]"
        }`}
      >
        {selecionado && (
          <CheckCircle2
            className={`size-4 ${tone === "emerald" ? "text-emerald-700 dark:text-emerald-200" : "text-sky-700 dark:text-sky-200"}`}
          />
        )}
      </div>
    </button>
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
  const vazio = preview.itens.length === 0
  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-foreground/82">
          <Users className="size-5 text-emerald-700 dark:text-emerald-200" />
          <h2 className="text-lg font-medium">Prévia de afetados</h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
            vazio
              ? "border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.04)] text-foreground/65"
              : "border-emerald-200/35 bg-emerald-200/14 text-emerald-700 dark:text-emerald-100"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              vazio ? "bg-[rgb(var(--ink)/0.4)]" : "bg-emerald-300 shadow-[0_0_8px_2px_rgba(110,231,183,0.55)]"
            }`}
          />
          {preview.totalColaboradores} convocados
        </span>
      </div>

      <ContextoPreview preview={preview} />
      <ResumoTotais preview={preview} />

      <div className="mt-5 max-h-[22rem] space-y-2.5 overflow-y-auto pr-1">
        {vazio ? (
          <EstadoVazio aviso={preview.aviso} />
        ) : (
          preview.itens.map((item, i) => (
            <div
              key={`${item.itemEntradaId}-${item.chapa}`}
              className="fade-up"
              style={{ animationDelay: `${60 + i * 50}ms` }}
            >
              <CardIntermitente item={item} />
            </div>
          ))
        )}
      </div>

      {erro && (
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100">
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
          disabled={carregando || vazio}
        >
          {carregando && <Loader2 className="size-4 animate-spin" />}
          Confirmar ponto facultativo
        </ChoiceButton>
      </div>
    </section>
  )
}

function EstadoVazio({ aviso }: { aviso: string | null }) {
  const { titulo, detalhe } = legendaAviso(aviso)
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.02)] px-5 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/55">
        <UserX className="size-6" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground/78">{titulo}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-foreground/45">
        {detalhe}
      </p>
      {aviso && (
        <p className="mt-3 inline-flex rounded-full border border-[rgb(var(--ink)/0.08)] bg-[rgb(var(--ink)/0.03)] px-2 py-0.5 font-mono text-[10px] text-foreground/35">
          {aviso}
        </p>
      )}
    </div>
  )
}

function ContextoPreview({ preview }: { preview: PontoFacultativoPreview }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="chip-context-glass">
        <Building2 className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
        {preview.contrato}
      </span>
      <span className="chip-context-glass">
        <MapPin className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
        {preview.unidade}
      </span>
      <span className="chip-context-glass">
        <CalendarDays className="size-3.5 text-emerald-700/85 dark:text-emerald-200/85" />
        {formatarData(preview.data)}
      </span>
    </div>
  )
}

function CardIntermitente({ item }: { item: PontoFacultativoItem }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.035)] p-4 transition hover:border-[rgb(var(--ink)/0.2)] hover:bg-[rgb(var(--ink)/0.05)]">
      {/* halo lateral discreto na cor do total */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-emerald-300/60 via-emerald-300/20 to-transparent" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground/92">{item.nome}</p>
          <p className="mt-1 text-xs text-foreground/45">
            {item.chapa}
            {item.funcao ? ` · ${item.funcao}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground/38">
            {item.unidade}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground/35">
            {item.periodoInicio} a {item.periodoFim}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/35">Total</p>
          <p className="mt-0.5 text-base font-semibold text-emerald-700 dark:text-emerald-100">
            {moeda(item.total)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        <BadgeBeneficio aplicado={item.aplicaVR} tone="emerald" label="VR" valor={item.valorVR} />
        <BadgeBeneficio aplicado={item.aplicaVT} tone="sky" label="VT" valor={item.valorVT} />
        {item.avisos.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-amber-700 dark:text-amber-100"
          >
            <Sparkles className="size-3" />
            {a}
          </span>
        ))}
      </div>
    </div>
  )
}

function BadgeBeneficio({
  aplicado,
  tone,
  label,
  valor,
}: {
  aplicado: boolean
  tone: "emerald" | "sky"
  label: string
  valor: number
}) {
  const cls = aplicado
    ? tone === "emerald"
      ? "border-emerald-300/35 bg-emerald-300/12 text-emerald-700 dark:text-emerald-100"
      : "border-sky-300/35 bg-sky-300/12 text-sky-700 dark:text-sky-100"
    : "border-[rgb(var(--ink)/0.08)] bg-[rgb(var(--ink)/0.03)] text-foreground/32 line-through decoration-white/20"
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${cls}`}>
      <span className="font-semibold">{label}</span>
      <span className="opacity-85">{moeda(valor)}</span>
    </span>
  )
}

function ResumoTotais({ preview }: { preview: PontoFacultativoPreview }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <CardTotal
        icone={UtensilsCrossed}
        label="VR"
        valor={preview.totalVR}
        tone="emerald"
      />
      <CardTotal
        icone={Coins}
        label="VT"
        valor={preview.totalVT}
        tone="sky"
      />
      <CardTotal
        icone={WalletCards}
        label="Total"
        valor={preview.total}
        tone="total"
      />
    </div>
  )
}

function CardTotal({
  icone: Icone,
  label,
  valor,
  tone,
}: {
  icone: typeof UtensilsCrossed
  label: string
  valor: number
  tone: "emerald" | "sky" | "total"
}) {
  const styles =
    tone === "total"
      ? {
          wrap: "border-emerald-200/30 bg-gradient-to-br from-emerald-300/12 via-emerald-200/[0.04] to-transparent shadow-[0_8px_28px_-12px_rgba(110,231,183,0.45)]",
          label: "text-emerald-700/75 dark:text-emerald-100/75",
          valor: "text-emerald-700 dark:text-emerald-50",
          iconBg: "bg-emerald-300/14 ring-emerald-300/35 text-emerald-700 dark:text-emerald-200",
        }
      : tone === "emerald"
        ? {
            wrap: "border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.035)]",
            label: "text-foreground/45",
            valor: "text-foreground",
            iconBg: "bg-emerald-300/10 ring-emerald-300/25 text-emerald-700/85 dark:text-emerald-200/85",
          }
        : {
            wrap: "border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.035)]",
            label: "text-foreground/45",
            valor: "text-foreground",
            iconBg: "bg-sky-300/10 ring-sky-300/25 text-sky-700/85 dark:text-sky-200/85",
          }
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${styles.wrap}`}
    >
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ${styles.iconBg}`}
      >
        <Icone className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] uppercase tracking-[0.22em] ${styles.label}`}>
          {label}
        </p>
        <p className={`mt-0.5 font-mono text-base font-semibold ${styles.valor}`}>
          {moeda(valor)}
        </p>
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
      <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-emerald-200/30 bg-emerald-200/12 text-emerald-700 dark:text-emerald-100">
        <CheckCircle2 className="size-7" />
      </div>
      <h2 className="text-display mt-5 text-4xl text-foreground">Aplicado</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-foreground/58">
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
