import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react"

import { copiarTexto } from "@/lib/copiar"
import { reduzirMotion } from "@/lib/motion"
import { nomeLimpo } from "@/lib/texto"
import { buscarDetalheExecucao } from "./api"
import { linkArtefato, rotuloTipoArtefato } from "./artefatos"
import {
  corDaFase, dataHoraManaus, duracaoCurta, fasesDobradas,
  horaComSegundosManaus, LABEL_ESTADO_FASE, rotuloEtapa,
} from "./etapas"
import { LABEL_ESTADO, rotuloAcao, type ArtefatoExecucao, type Execucao } from "./types"

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
  // pagamento pontual (felipeta)
  vr: "VR a pagar",
  vt: "VT a pagar",
  desconto: "Desconto abatido",
  credito: "Crédito no cartão",
  boleto: "Boleto PIX",
  sem_saldo: "Desconto consumiu tudo",
  recalculado: "Recalculado na confirmação",
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

function valorLegivel(chave: string, v: unknown): string {
  if (v == null) return "—"
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

function LinhaArtefato({ a }: { a: ArtefatoExecucao }) {
  const url = linkArtefato(a)
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[12px] text-foreground/45">{rotuloTipoArtefato(a.tipo)}</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-foreground/85">
        {a.rotulo && a.rotulo !== a.chave ? `${a.rotulo} · ` : ""}
        {a.chave}
      </span>
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
        // a automação gravou errado.
        <BotaoCopiar texto={a.chave} rotulo={rotuloTipoArtefato(a.tipo)} />
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
    .filter(([, v]) => exibivel(v))
    .sort(([a], [b]) => {
      const ia = ordem.indexOf(a), ib = ordem.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })
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
          {/* Trilho de fases — data-driven: vem do que ESTA execução emitiu. */}
          {fases.length > 0 && (
            <div className="mb-4">
              <div className="flex gap-1">
                {fases.map((f) => (
                  <span
                    key={f.etapa}
                    title={`${rotuloEtapa(f.etapa)} — ${LABEL_ESTADO_FASE[f.estado] ?? f.estado}`}
                    className={`h-[5px] flex-1 rounded-full ${corDaFase(f.estado)}`}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-[11px] text-foreground/70">
                  {rotuloEtapa(exec.erro_etapa ?? exec.etapa_atual ?? fases[fases.length - 1]?.etapa)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-foreground/35">
                  {fases.length} {fases.length === 1 ? "fase" : "fases"}
                  {exec.duracao_ms != null ? ` · ${duracaoCurta(exec.duracao_ms)}` : ""}
                </span>
              </div>
            </div>
          )}

          {camposResumo.length > 0 && (
            <div className="mb-4">
              <p className="eyebrow mb-2">Resumo</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                {camposResumo.map(([k, v]) => (
                  <div key={k} className="col-span-2 grid grid-cols-subgrid">
                    <dt className="text-foreground/45">{LABEL_RESUMO[k] ?? k.replaceAll("_", " ")}</dt>
                    <dd
                      className={
                        k === "modo" && v === "producao"
                          ? "rounded-md bg-[rgb(var(--status-red-rgb)/0.14)] px-1.5 text-[var(--status-red)]"
                          : "text-foreground/85"
                      }
                    >
                      {valorLegivel(k, v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {artefatos.length > 0 && (
            <div className="mb-4">
              <p className="eyebrow mb-1.5">O que foi gerado</p>
              <div className="divide-y divide-[rgb(var(--ink)/0.06)]">
                {artefatos.map((a) => <LinhaArtefato key={a.id} a={a} />)}
              </div>
            </div>
          )}

          {etapas.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <p className="eyebrow">Fases</p>
                {etapas.some((e) => e.estado === "erro" || e.estado === "aviso") && (
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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--ink)/0.07)] pt-3">
            <BotaoCopiar texto={textoDiagnostico(exec, etapas, artefatos)} rotulo="diagnóstico" />
            <span className="flex items-center gap-2 font-mono text-[10px] text-foreground/30">
              {exec.id}
              <BotaoCopiar texto={`${window.location.origin}/atividade?exec=${exec.id}`} rotulo="link" />
            </span>
          </div>
        </>
      )}
    </div>
  )
}
