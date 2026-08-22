import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, ExternalLink, EyeOff, Loader2 } from "lucide-react"

import { useAuth } from "@/components/AuthContext"
import { copiarTexto } from "@/lib/copiar"
import { reduzirMotion } from "@/lib/motion"
import { nomeLimpo } from "@/lib/texto"
import { buscarDetalheExecucao, reconhecerErro } from "./api"
import { linkArtefato, rotuloTipoArtefato } from "./artefatos"
import {
  corDaFase, dataHoraManaus, duracaoCurta, fasesDobradas,
  horaComSegundosManaus, LABEL_ESTADO_FASE, rotuloEtapa,
} from "./etapas"
import { ehFalha, LABEL_ESTADO, rotuloAcao, type ArtefatoExecucao, type Execucao } from "./types"
import { fraseDesfecho, totalResumo } from "./resumoHumano"

/**
 * Painel de detalhe da linha expandida: trilho de fases, resumo, artefatos gerados e
 * a timeline.
 *
 * ⚠️ Montado SÓ quando a linha está aberta, e o detalhe é buscado só dela. 200
 * painéis no DOM (ou 200 requests) é auto-DDoS — e é por isso que o acordeão é de um
 * só aberto por vez, o que também é o contrato da URL (`?exec=` guarda um id).
 */

/**
 * Rótulos pt-BR das chaves do payload_resumo. Sem isto vaza `board_id` como UX.
 *
 * A ORDEM aqui é a ordem de exibição. `payload_resumo` é `jsonb`, e jsonb NÃO preserva
 * a ordem de inserção (o Postgres reordena por tamanho de chave e depois alfabética) —
 * sem isto o resumo saía com "Fim" antes de "Início".
 */
const LABEL_RESUMO: Record<string, string> = {
  chapa: "Chapa",
  data_inicio: "Início",
  data_fim: "Fim",
  unidade: "Unidade",
  papel: "Mês",
  solicitante: "Solicitante",
  optante_vt: "Vale transporte",
  competencia: "Competência",
  caixa: "Caixa",
  modo: "Modo",
  escopo: "Escopo",
  contratos: "Contratos",
  contratos_total: "Contratos no total",
  pessoas: "Pessoas",
  protocolo: "Protocolo",
  tipo: "Tipo",
  qtd_faltas: "Faltas",
  qtd_atrasos: "Atrasos",
  // pagamento pontual (felipeta) — os valores viram a tabela VR/VT/Total; aqui ficam
  // só as marcas que não são dinheiro.
  sem_saldo: "Desconto consumiu tudo",
  recalculado: "Recalculado na confirmação",
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

/** Chaves de dinheiro: saem da lista e viram a tabela de valores. */
const CHAVES_DINHEIRO = [
  "vr", "vt", "credito", "boleto", "desconto",
  "credito_vr", "credito_vt", "boleto_vr", "boleto_vt", "desconto_vr", "desconto_vt",
] as const

/**
 * Tabela de dinheiro por benefício. VR e VT em colunas porque é assim que a Caju (pedidos
 * separados) e o RM (eventos 100/110) tratam — o DP confere um contra o outro.
 *
 * As chaves `credito`/`boleto`/`desconto` sem sufixo são o formato ANTIGO (totais); as
 * execuções gravadas antes de 13/08 só têm elas, e aí a coluna de total é a única com valor.
 */
function linhasDinheiro(r: Record<string, unknown>): Array<{ rotulo: string; vr: number | null; vt: number | null; total: number }> {
  const n = (k: string): number => Number(r[k]) || 0
  // O TOTAL sai do mesmo helper que a frase de desfecho usa. Quando as duas contas viviam
  // separadas, a tabela mostrou R$ 138 e a frase disse "Pago: nada" na mesma tela.
  const par = (base: string): { vr: number | null; vt: number | null; total: number } => {
    const temSeparado = r[`${base}_vr`] != null || r[`${base}_vt`] != null
    return temSeparado
      ? { vr: n(`${base}_vr`), vt: n(`${base}_vt`), total: totalResumo(r, base) }
      : { vr: null, vt: null, total: totalResumo(r, base) }
  }
  const aPagar = { vr: r.vr != null ? n("vr") : null, vt: r.vt != null ? n("vt") : null, total: n("vr") + n("vt") }
  return [
    { rotulo: "A pagar", ...aPagar },
    { rotulo: "Crédito no cartão", ...par("credito") },
    { rotulo: "Boleto PIX", ...par("boleto") },
    { rotulo: "Desconto abatido", ...par("desconto") },
  ].filter((l) => l.total > 0)
}

/** Chaves puramente técnicas: só aparecem com o detalhe técnico aberto. */
const CHAVES_TECNICAS = new Set(["item_origem_id", "modo", "execucao_id", "run_id", "board_id"])

const brl = (v: unknown): string =>
  `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "2026-08-13" → "13/08". Data ISO na cara do usuário é dado de banco. */
const dataBr = (v: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""))
  return m ? `${m[3]}/${m[2]}` : String(v ?? "")
}

function valorLegivel(chave: string, v: unknown): string {
  if (v == null) return "—"
  if (chave === "data_inicio" || chave === "data_fim") return dataBr(v)
  if (chave === "competencia") {
    const m = String(v).match(/^(\d{4})-(\d{2})$/)
    if (m) return `${MESES[Number(m[2]) - 1] ?? m[2]}/${m[1]}`
  }
  if (chave === "papel") {
    const mapa: Record<string, string> = { atual: "mês atual", proximo: "próximo mês", passado: "mês passado", teste: "board de teste" }
    return mapa[String(v)] ?? String(v)
  }
  if (chave === "escopo") {
    const mapa: Record<string, string> = { todos: "todos os contratos", conjunto: "contratos selecionados", contrato: "1 contrato" }
    return mapa[String(v)] ?? String(v)
  }
  if (chave === "modo") return v === "producao" ? "PRODUÇÃO (efeitos reais)" : `${v} (simulado)`
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "sim" : "não"
  return String(v)
}

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copiarTexto(texto)) {
          setCopiado(true)
          setTimeout(() => setCopiado(false), 1800)
        }
      }}
      className="pill-soft inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px]"
      aria-label={`Copiar ${rotulo}`}
    >
      {copiado ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copiado ? "copiado" : "copiar"}
    </button>
  )
}

/**
 * Um artefato. `mostrarId` fecha o problema de densidade: 8 pedidos Caju viram 8 UUIDs de
 * 36 caracteres, que ocupavam metade do painel e não dizem nada a quem lê. Fechado, a linha
 * é o rótulo + "abrir"; com o técnico aberto, o id aparece pra conferência.
 */
function LinhaArtefato({ a, mostrarId }: { a: ArtefatoExecucao; mostrarId: boolean }) {
  const url = linkArtefato(a)
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/70">
        {a.rotulo && a.rotulo !== a.chave ? a.rotulo : rotuloTipoArtefato(a.tipo)}
      </span>
      {mostrarId && (
        <span className="min-w-0 max-w-[55%] truncate text-right font-mono text-[11px] text-foreground/50">
          {a.chave}
        </span>
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[rgb(var(--accent-rgb))] underline underline-offset-2"
        >
          abrir <ExternalLink className="size-3" />
        </a>
      ) : (
        // rm_idfinanc e afins não têm URL — link falso faria quem clica concluir que
        // a automação gravou errado. Sem id à vista, o valor vai no rótulo.
        <span className="inline-flex shrink-0 items-center gap-2">
          {!mostrarId && <span className="font-mono text-[11px] text-foreground/70">{a.chave}</span>}
          <BotaoCopiar texto={a.chave} rotulo={rotuloTipoArtefato(a.tipo)} />
        </span>
      )}
    </div>
  )
}

/** Texto que o operador cola de volta no WhatsApp ao responder o alerta. */
function textoDiagnostico(
  exec: Execucao,
  etapas: Array<{ etapa: string; estado: string; tentativa: number; mensagem: string | null; criado_em: string }>,
  artefatos: ArtefatoExecucao[],
): string {
  const l: string[] = [
    `${rotuloAcao(exec.acao)} — ${LABEL_ESTADO[exec.estado]}`,
    `Quando: ${dataHoraManaus(exec.criado_em)} (Manaus)`,
  ]
  if (exec.pessoa_nome) l.push(`Pessoa: ${exec.pessoa_nome}${exec.contrato ? ` — ${exec.contrato}` : ""}`)
  if (exec.operador_nome) l.push(`Por: ${nomeLimpo(exec.operador_nome)}`)
  if (exec.erro_etapa || exec.erro_msg) {
    l.push(`Quebrou em: ${rotuloEtapa(exec.erro_etapa)}`)
    if (exec.erro_msg) l.push(`Erro: ${exec.erro_msg}`)
  }
  if (etapas.length) {
    l.push("", "Fases:")
    for (const e of etapas) {
      l.push(`  ${horaComSegundosManaus(e.criado_em)} ${rotuloEtapa(e.etapa)} — ${LABEL_ESTADO_FASE[e.estado] ?? e.estado}` +
        (e.tentativa > 1 ? ` (tentativa ${e.tentativa})` : "") +
        (e.mensagem ? `: ${e.mensagem}` : ""))
    }
  }
  if (artefatos.length) {
    l.push("", "Gerado:")
    for (const a of artefatos) l.push(`  ${rotuloTipoArtefato(a.tipo)}: ${a.chave}`)
  }
  l.push("", `id: ${exec.id}`)
  return l.join("\n")
}

export function DetalheExecucao({ exec, aoVivo }: { exec: Execucao; aoVivo: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["atividade-detalhe", exec.id],
    queryFn: () => buscarDetalheExecucao(exec.id),
    // Execução em andamento recarrega sozinha; encerrada não precisa.
    refetchInterval: aoVivo ? 3000 : false,
    staleTime: aoVivo ? 0 : 30_000,
  })
  const [soErros, setSoErros] = useState(exec.estado === "erro")
  // Abre sozinho quando quebrou: aí o técnico É a informação de rotina, e quem chegou pelo
  // link do alerta veio justamente ler isso.
  const [tecnicoAberto, setTecnicoAberto] = useState(ehFalha(exec.estado))
  const [faseSobCursor, setFaseSobCursor] = useState<{ etapa: string; estado: string } | null>(null)

  // Reconhecer erro: DP/admin. Invalida a lista pra o banner e o contador recalcularem na
  // hora — sem isso o botão parece não ter feito nada.
  const { podeVer } = useAuth()
  const podeReconhecer = podeVer("dp")
  const qc = useQueryClient()
  const { mutate: reconhecer, isPending: reconhecendo } = useMutation({
    mutationFn: (opts: { nota?: string; desfazer?: boolean }) => reconhecerErro(exec.id, opts),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["atividade"] })
      void qc.invalidateQueries({ queryKey: ["atividade-fixada"] })
    },
  })
  const refErro = useRef<HTMLDivElement | null>(null)

  const etapas = data?.etapas ?? []
  const artefatos = data?.artefatos ?? []
  const fases = fasesDobradas(etapas)

  // Numa execução com erro, a timeline já abre rolada até o evento que quebrou —
  // senão o operador chega pelo link e cai numa lista de 30 linhas pra garimpar.
  useEffect(() => {
    if (!refErro.current) return
    refErro.current.scrollIntoView({ block: "center", behavior: reduzirMotion() ? "auto" : "smooth" })
  }, [etapas.length])

  const resumo = (exec.payload_resumo ?? {}) as Record<string, unknown>
  // Escalares e arrays entram; objeto aninhado fica fora (viraria "[object Object]").
  const exibivel = (v: unknown): boolean =>
    v != null && (typeof v !== "object" || Array.isArray(v))
  // Ordem de LABEL_RESUMO primeiro; o que não tem rótulo vai depois, em ordem alfabética.
  const ordem = Object.keys(LABEL_RESUMO)
  const camposResumo = Object.entries(resumo)
    .filter(([k, v]) => {
      if (!exibivel(v)) return false
      // Dinheiro sai da lista: vira o grid de valores acima.
      if ((CHAVES_DINHEIRO as readonly string[]).includes(k)) return false
      // Técnico só com o painel técnico aberto.
      if (CHAVES_TECNICAS.has(k) && !tecnicoAberto) return false
      // Booleano FALSE não é informação — "Desconto consumiu tudo: não" e "Recalculado:
      // não" eram duas linhas dizendo que nada de especial aconteceu.
      if (typeof v === "boolean" && !v) return false
      return true
    })
    .sort(([a], [b]) => {
      const ia = ordem.indexOf(a), ib = ordem.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })

  // Só o que ESTA execução tem, e só se tem valor > 0.
  const valores = linhasDinheiro(resumo)
  const temColunas = valores.some((l) => l.vr != null || l.vt != null)
  const visiveis = soErros ? etapas.filter((e) => e.estado === "erro" || e.estado === "aviso") : etapas

  return (
    <div
      id={`det-${exec.id}`}
      role="region"
      aria-labelledby={`lin-${exec.id}`}
      className="log-detalhe mt-1.5 rounded-[16px] px-4 py-3.5"
      style={{ background: "var(--glass-inset)", boxShadow: "inset 0 1px 3px rgb(var(--shadow) / 0.3)" }}
    >
      {isLoading && (
        <p className="flex items-center gap-2 text-xs text-foreground/50">
          <Loader2 className="size-3.5 animate-spin" /> Carregando detalhe…
        </p>
      )}
      {isError && (
        <p className="text-xs text-[var(--status-red)]">
          Não foi possível carregar o detalhe desta execução.
        </p>
      )}

      {data && (
        <>
          {/* DESFECHO em português, no topo: responde "e aí, o que aconteceu?" sem obrigar
              ninguém a interpretar nome de etapa do RM. É o que a Thifany lê. */}
          <p
            className={`mb-3 text-[13px] leading-relaxed ${
              exec.estado === "erro" ? "text-[var(--status-red)]"
              : exec.estado === "recusado" ? "text-[var(--muted-foreground)]"
              : exec.estado === "parcial" || exec.estado === "abandonada" ? "text-[var(--status-yellow)]"
              : "text-foreground/85"
            }`}
          >
            {fraseDesfecho(exec)}
          </p>

          {/* "Já vi isso" — só em quem falhou, e só pra DP/admin. Um erro antigo parado no
              banner vermelho ensina a ignorar o banner; aí a quebra nova passa batida. */}
          {ehFalha(exec.estado) && podeReconhecer && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {exec.erro_reconhecido_em ? (
                <>
                  <span className="text-[12px] text-foreground/55">
                    Marcado como tratado
                    {exec.erro_reconhecido_por ? ` por ${exec.erro_reconhecido_por}` : ""}
                    {exec.erro_reconhecido_nota ? ` — ${exec.erro_reconhecido_nota}` : ""}
                  </span>
                  <button
                    type="button"
                    className="pill-soft px-3 py-1.5 text-[11px]"
                    disabled={reconhecendo}
                    onClick={() => reconhecer({ desfazer: true })}
                  >
                    reabrir
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="pill-soft inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px]"
                  disabled={reconhecendo}
                  onClick={() => {
                    const nota = window.prompt("O que foi feito? (opcional)") ?? undefined
                    reconhecer({ nota })
                  }}
                >
                  <EyeOff className="size-3" aria-hidden />
                  {reconhecendo ? "marcando…" : "já vi, está tratado"}
                </button>
              )}
            </div>
          )}

          {/* Trilho de fases: uma barra por fase, sem rótulo técnico. Serve como sinal de
              progresso/quebra — o nome de cada uma vive no title e no detalhe técnico. */}
          {fases.length > 0 && (
            <div className="mb-4">
              {/* Cada barra é focável e nomeia a própria fase na linha de baixo — o `title`
                  nativo obriga a parar 1s em cima e não existe no toque. Aqui o nome troca
                  no hover/foco, e some pro texto de progresso quando o cursor sai. */}
              <div className="flex gap-1" onMouseLeave={() => setFaseSobCursor(null)}>
                {fases.map((f) => (
                  <button
                    key={f.etapa}
                    type="button"
                    onMouseEnter={() => setFaseSobCursor(f)}
                    onFocus={() => setFaseSobCursor(f)}
                    onBlur={() => setFaseSobCursor(null)}
                    aria-label={`${rotuloEtapa(f.etapa)} — ${LABEL_ESTADO_FASE[f.estado] ?? f.estado}`}
                    className={`h-[7px] flex-1 rounded-full transition-[transform,opacity] duration-150 hover:scale-y-150 focus-visible:scale-y-150 focus-visible:outline-none ${corDaFase(f.estado)} ${
                      faseSobCursor && faseSobCursor.etapa !== f.etapa ? "opacity-40" : ""
                    }`}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-[11px] text-foreground/70">
                  {faseSobCursor ? (
                    <>
                      {rotuloEtapa(faseSobCursor.etapa)}
                      <span
                        className={
                          faseSobCursor.estado === "erro" ? "text-[var(--status-red)]"
                          : faseSobCursor.estado === "aviso" ? "text-[var(--status-yellow)]"
                          : "text-foreground/45"
                        }
                      >
                        {" · "}{LABEL_ESTADO_FASE[faseSobCursor.estado] ?? faseSobCursor.estado}
                      </span>
                    </>
                  ) : (
                    <span className="text-foreground/55">
                      {fases.filter((f) => f.estado === "ok").length} de {fases.length} etapas concluídas
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground/35">
                  {exec.duracao_ms != null ? duracaoCurta(exec.duracao_ms) : ""}
                </span>
              </div>
            </div>
          )}

          {/* DINHEIRO em tabela VR / VT / Total. Em lista chave-valor saía "VR a pagar 122.5"
              — dado de banco; e só com o total, conferir contra a Caju (pedidos separados por
              benefício) ou o RM (eventos 100/110) exigia fazer a conta de cabeça. */}
          {valores.length > 0 && (
            <div className="mb-4 rounded-[14px] px-4 py-3" style={{ background: "var(--glass-inset)" }}>
              <table className="w-full text-[13px]">
                {temColunas && (
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-foreground/40">
                      <th className="pb-1.5 text-left font-medium">&nbsp;</th>
                      <th className="pb-1.5 text-right font-medium">VR</th>
                      <th className="pb-1.5 text-right font-medium">VT</th>
                      <th className="pb-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                )}
                <tbody>
                  {valores.map((l) => (
                    <tr key={l.rotulo} className="border-t border-[rgb(var(--ink)/0.06)] first:border-t-0">
                      <td className="py-1.5 pr-3 text-foreground/55">{l.rotulo}</td>
                      {temColunas && (
                        <>
                          <td className="py-1.5 text-right tabular-nums text-foreground/80">
                            {l.vr == null ? "—" : l.vr > 0 ? brl(l.vr) : "—"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-foreground/80">
                            {l.vt == null ? "—" : l.vt > 0 ? brl(l.vt) : "—"}
                          </td>
                        </>
                      )}
                      <td className="py-1.5 pl-3 text-right font-medium tabular-nums text-foreground">
                        {brl(l.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Contexto restante — o que não é dinheiro nem técnico. */}
          {camposResumo.length > 0 && (
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              {camposResumo.map(([k, v]) => (
                <div key={k} className="col-span-2 grid grid-cols-subgrid">
                  <dt className="text-foreground/45">{LABEL_RESUMO[k] ?? k.replaceAll("_", " ")}</dt>
                  <dd
                    className={
                      k === "modo" && v === "producao"
                        ? "rounded-md bg-[rgb(var(--status-red-rgb)/0.14)] px-1.5 text-[var(--status-red)]"
                        : "tabular-nums text-foreground/85"
                    }
                  >
                    {valorLegivel(k, v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {artefatos.length > 0 && (
            <div className="mb-4">
              <p className="mb-1.5 text-[12px] font-medium text-foreground/70">
                {artefatos.length === 1 ? "Onde isso foi registrado" : `Onde isso foi registrado (${artefatos.length})`}
              </p>
              <div className="divide-y divide-[rgb(var(--ink)/0.06)]">
                {artefatos.map((a) => <LinhaArtefato key={a.id} a={a} mostrarId={tecnicoAberto} />)}
              </div>
            </div>
          )}

          {/* TÉCNICO — fechado por padrão, aberto sozinho quando quebrou. Fases com
              timestamp, nome de etapa e id são ferramenta de diagnóstico, não informação
              de rotina: na frente, ensinavam a Thifany a ignorar o painel inteiro. */}
          {etapas.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="glass-chip px-2.5 py-1 text-[11px]"
                  aria-expanded={tecnicoAberto}
                  onClick={() => setTecnicoAberto((v) => !v)}
                >
                  {tecnicoAberto ? "ocultar detalhe técnico" : "ver detalhe técnico"}
                </button>
                {tecnicoAberto && etapas.some((e) => e.estado === "erro" || e.estado === "aviso") && (
                  <button
                    type="button"
                    className="glass-chip px-2.5 py-1 text-[11px]"
                    data-on={soErros ? "true" : "false"}
                    aria-pressed={soErros}
                    onClick={() => setSoErros((v) => !v)}
                  >
                    só problemas
                  </button>
                )}
              </div>
              <div
                hidden={!tecnicoAberto}
                className="max-h-52 space-y-1 overflow-y-auto rounded-[16px] px-4 py-3"
                style={{ background: "var(--glass-inset)", boxShadow: "inset 0 1px 3px rgb(var(--shadow) / 0.3)" }}
              >
                {visiveis.map((ev) => (
                  <div
                    key={ev.id}
                    ref={ev.estado === "erro" ? refErro : undefined}
                    className="flex items-baseline gap-2.5 font-mono text-[11px] leading-relaxed"
                  >
                    <span className="shrink-0 tabular-nums text-foreground/30">
                      {horaComSegundosManaus(ev.criado_em)}
                    </span>
                    <span
                      className={`min-w-0 ${
                        ev.estado === "erro" ? "text-[var(--status-red)]"
                        : ev.estado === "aviso" ? "text-[var(--status-yellow)]"
                        : ev.estado === "pulado" ? "text-foreground/35"
                        : "text-foreground/65"
                      }`}
                    >
                      {rotuloEtapa(ev.etapa)}
                      {ev.estado !== "ok" && ev.estado !== "rodando" ? ` (${LABEL_ESTADO_FASE[ev.estado] ?? ev.estado})` : ""}
                      {ev.mensagem ? ` — ${ev.mensagem}` : ""}
                      {ev.tentativa > 1 ? ` · tentativa ${ev.tentativa}` : ""}
                      {ev.duracao_ms != null ? ` · ${duracaoCurta(ev.duracao_ms)}` : ""}
                    </span>
                  </div>
                ))}
                {visiveis.length === 0 && (
                  <p className="text-[11px] text-foreground/40">Nenhuma fase com problema.</p>
                )}
              </div>
            </div>
          )}

          {etapas.length === 0 && artefatos.length === 0 && (
            <p className="text-[12px] text-foreground/50">
              Esta execução não registrou fases.
              {exec.motor === "n8n"
                ? " Ela rodou no n8n, que ainda não reporta passo a passo."
                : ""}
            </p>
          )}

          {/* Rodapé: "copiar link" fica SEMPRE (é como a Thifany manda um caso pra mim);
              o id cru e o diagnóstico só quando o técnico está aberto — eram a última coisa
              do painel e a primeira que ninguém entendia. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--ink)/0.07)] pt-3">
            {tecnicoAberto ? (
              <BotaoCopiar texto={textoDiagnostico(exec, etapas, artefatos)} rotulo="diagnóstico" />
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2 font-mono text-[10px] text-foreground/30">
              {tecnicoAberto && exec.id}
              <BotaoCopiar texto={`${window.location.origin}/atividade?exec=${exec.id}`} rotulo="link" />
            </span>
          </div>
        </>
      )}
    </div>
  )
}
