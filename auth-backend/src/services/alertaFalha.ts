// Escape de erro: quando uma FASE da automação não conclui, avisa no WhatsApp com um
// link que abre a linha do log exatamente onde quebrou.
//
// O objetivo declarado é descobrir ANTES de o funcionário reclamar que não recebeu o
// benefício. Por isso o alerta nasce do log (services/execucao.ts) e não de logging
// solto: sem registro de falha não há do que avisar.
//
// ⚠️ DISPARA SÓ QUANDO ESGOTA O RETRY. jobs/repo.ts tenta 5× com backoff de 30s porque
// blip da ponte AIONS (ngrok free) se autocura; alertar na 1ª faria o grupo virar ruído
// e o fusível engolir as falhas reais. Exceção: erro definitivo (FatalError) e run de
// dinheiro pela metade avisam na hora, porque não vão se autocurar.
import { createHash } from "node:crypto"
import { config } from "../config.js"
import { query } from "../db.js"
import { enviarTexto } from "../clients/evolution.js"
import { limparTexto } from "../domain/sanitizar.js"
import { rotuloAcao, rotuloEtapa } from "../domain/rotulosAtividade.js"
import {
  mensagemFalha, mensagemFalhaAgrupada, normalizarErro,
  type DadosFalha, type OrigemAlerta,
} from "../domain/mensagemFalha.js"

/** Ações de negócio que valem alerta. Leitura que deu 502 não é alerta. */
const ACOES_RELEVANTES = new Set([
  "convocacao", "registro", "cancelamento", "split",
  "atestado", "ponto_facultativo", "desconto", "mensal", "mensal_fechamento",
])

export interface EntradaAlerta {
  execucaoId?: string | null
  origem: OrigemAlerta
  acao?: string | null
  etapa?: string | null
  erro?: unknown
  pessoa?: string | null
  contrato?: string | null
  tentativa?: number | null
  maxTentativas?: number | null
  eventoId?: number | null
  /** Pula o filtro de relevância — usado por job/workflow, que já são de negócio. */
  sempre?: boolean
}

export interface ResultadoAlerta {
  gravado: boolean
  enviado: boolean
  deduplicado: boolean
  colapsado: boolean
  motivo?: string
}

const assinaturaDe = (acao: string, etapa: string, erro: string): string =>
  createHash("md5").update(`${acao}|${etapa}|${normalizarErro(erro)}`).digest("hex")

const textoErro = (e: unknown): string =>
  (e instanceof Error ? limparTexto(e.message, 240) : limparTexto(e, 240)) ?? ""

/**
 * Registra e (talvez) envia um alerta de falha. NUNCA lança — alerta é secundário ao
 * fluxo de negócio, igual ao log.
 */
export async function alertarFalha(inp: EntradaAlerta): Promise<ResultadoAlerta> {
  const base: ResultadoAlerta = { gravado: false, enviado: false, deduplicado: false, colapsado: false }
  try {
    const acao = inp.acao ?? ""
    if (!inp.sempre && !ACOES_RELEVANTES.has(acao)) {
      return { ...base, motivo: "acao_irrelevante" }
    }
    const etapa = inp.etapa ?? ""
    const erro = textoErro(inp.erro)
    const assinatura = assinaturaDe(acao, etapa, erro)

    const dados: DadosFalha = {
      execucaoId: inp.execucaoId ?? null,
      origem: inp.origem,
      acao,
      acaoLabel: rotuloAcao(acao),
      etapa,
      etapaLabel: rotuloEtapa(etapa),
      erro,
      pessoa: inp.pessoa ?? null,
      contrato: inp.contrato ?? null,
      tentativa: inp.tentativa ?? null,
      maxTentativas: inp.maxTentativas ?? null,
      quando: new Date().toISOString(),
      eventoId: inp.eventoId ?? null,
    }
    const corpo = mensagemFalha(dados, config.publicBaseUrl)
    const link = inp.execucaoId
      ? `${config.publicBaseUrl.replace(/\/$/, "")}/atividade?exec=${inp.execucaoId}`
      : null
    const destino = config.evolution.destinoErros

    // DEDUPE — e ele vem ANTES do fusível de propósito. RM fora do ar durante o mensal
    // dá 100+ falhas idênticas (uma por contrato). Se o teto agisse primeiro, ele
    // colapsaria as 100 cópias do MESMO erro e engoliria a falha DIFERENTE que veio
    // depois — perdendo exatamente a que importava.
    const { rows } = await query<{ id: string; qtd: number; enviado_em: Date | null }>(
      `INSERT INTO alerta_falha
         (execucao_id, evento_id, origem, acao, etapa, assinatura, destino, corpo, link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (assinatura, janela)
         DO UPDATE SET qtd = alerta_falha.qtd + 1
       RETURNING id, qtd, enviado_em`,
      [
        inp.execucaoId ?? null, inp.eventoId ?? null, inp.origem,
        acao || null, etapa || null, assinatura, destino, corpo, link,
      ],
    )
    const linha = rows[0]
    if (!linha) return { ...base, motivo: "insert_falhou" }

    if (linha.qtd > 1) {
      // A primeira mensagem desta assinatura já saiu (e já leva o link). Repetir não
      // acrescenta nada.
      return { ...base, gravado: true, deduplicado: true, motivo: `repetida_${linha.qtd}x` }
    }

    // FUSÍVEL: acima do teto na última hora, o excedente vira UMA mensagem agrupada que
    // avisa que colapsou. Sem isso um dia sistêmico silencia o grupo.
    const { rows: janela } = await query<{ n: number }>(
      `SELECT count(*)::int n FROM alerta_falha
        WHERE enviado_em IS NOT NULL AND enviado_em > now() - interval '1 hour'`,
    )
    const jaEnviadas = janela[0]?.n ?? 0
    if (jaEnviadas >= config.evolution.tetoErrosHora) {
      const colapsado = await enviarColapsado(linha.id, destino, dados)
      return { ...base, gravado: true, colapsado: true, enviado: colapsado, motivo: "teto_hora" }
    }

    // Grava ANTES de enviar (já feito acima): envio que falha registra o erro em vez de
    // a mensagem sumir. Ordem herdada de services/notificarAlteracao.ts.
    return { ...base, gravado: true, ...(await entregar(linha.id, destino, corpo)) }
  } catch (e) {
    console.warn("[alerta] falhou (alerta é secundário):", (e as Error)?.message ?? e)
    return { ...base, motivo: "excecao" }
  }
}

async function entregar(id: string, destino: string, corpo: string): Promise<{ enviado: boolean; motivo?: string }> {
  const r = await enviarTexto(destino, corpo)
  if (r.enviado) {
    await marcar(id, null)
    return { enviado: true }
  }
  if (r.motivo === "desabilitado" || r.motivo === "sem_credencial") {
    // Não é falha: o envio está deliberadamente fechado (MONITOR_ENVIO_HABILITADO).
    // Fica gravado sem `enviado_em` — é o modo de homologação, pra ler pi.alerta_falha
    // e conferir o que sairia antes de soltar.
    await marcar(id, `nao_enviado:${r.motivo}`)
    return { enviado: false, motivo: r.motivo }
  }
  await marcar(id, r.detalhe ?? "erro_desconhecido")
  return { enviado: false, motivo: "erro_envio" }
}

async function enviarColapsado(id: string, destino: string, dados: DadosFalha): Promise<boolean> {
  const { rows } = await query<{ acao: string | null; etapa: string | null; execucao_id: string | null }>(
    `SELECT acao, etapa, execucao_id FROM alerta_falha
      WHERE criado_em > now() - interval '1 hour' ORDER BY criado_em DESC LIMIT 50`,
  )
  const itens: DadosFalha[] = rows.map((r) => ({
    origem: "execucao",
    acao: r.acao, acaoLabel: rotuloAcao(r.acao ?? ""),
    etapa: r.etapa, etapaLabel: rotuloEtapa(r.etapa ?? ""),
    execucaoId: r.execucao_id,
  }))
  const corpo = mensagemFalhaAgrupada(itens.length ? itens : [dados], config.publicBaseUrl)
  await query(`UPDATE alerta_falha SET corpo = $2, colapsada = true WHERE id = $1`, [id, corpo])
  const r = await entregar(id, destino, corpo)
  return r.enviado
}

async function marcar(id: string, erro: string | null): Promise<void> {
  await query(
    `UPDATE alerta_falha
        SET enviado_em = CASE WHEN $2::text IS NULL THEN now() ELSE enviado_em END,
            erro = $2, tentativas = tentativas + 1
      WHERE id = $1`,
    [id, erro],
  )
}

// Rótulos em domain/rotulosAtividade.ts — compartilhados com o relatório XLSX.

/**
 * Varredura de execuções ABANDONADAS: abriram e nunca fecharam.
 *
 * É o payoff de abrir a execução antes do efeito — "aba fechada no meio" ou função
 * encerrada antes do fim deixam de produzir NENHUM log e passam a produzir uma linha
 * explícita.
 *
 * ⚠️ `pisoIso` é obrigatório e existe pra varredura NUNCA tocar o histórico: as 413
 * linhas anteriores à migration 018 foram marcadas 'ok' no backfill, mas qualquer
 * defeito futuro que deixe linha velha em 'aberta' faria a primeira passada alertar
 * sobre o passado inteiro.
 */
export async function varrerAbandonadas(
  pisoIso: string,
  minutos = 15,
): Promise<{ marcadas: number; alertadas: number }> {
  const { rows } = await query<{
    id: string; acao: string; etapa_atual: string | null
    pessoa_nome: string | null; contrato: string | null; irma_ok: boolean
  }>(
    `UPDATE audit_lancamentos a
        SET estado = 'abandonada', finalizado_em = now(),
            erro_etapa = COALESCE(erro_etapa, etapa_atual),
            erro_msg = COALESCE(erro_msg, 'execucao_abandonada: aberta sem fechar')
      WHERE a.estado = 'aberta'
        AND a.criado_em < now() - ($2 || ' minutes')::interval
        AND a.criado_em > $1::timestamptz
      RETURNING a.id, a.acao, a.etapa_atual, a.pessoa_nome, a.contrato,
        -- O trabalho foi feito por OUTRA execução do mesmo alvo? Então marca como
        -- abandonada (é história) mas NÃO alerta.
        --
        -- Dois casos reais: (1) o front abre a execucao, o teto de tempo cancela tarde e a
        -- rota abre a propria — sobra uma linha fantasma pra uma convocacao que deu certo
        -- (aconteceu em 12/08 20:08, item 12788484122); (2) o operador tenta, falha, tenta
        -- de novo e funciona. Nos dois o alerta seria mentira.
        EXISTS (
          SELECT 1 FROM audit_lancamentos irma
           WHERE irma.id <> a.id
             AND irma.acao = a.acao
             AND irma.uuid_alvo IS NOT NULL
             AND irma.uuid_alvo = a.uuid_alvo
             AND irma.estado IN ('ok', 'parcial')
             AND irma.criado_em BETWEEN a.criado_em - interval '1 hour'
                                    AND a.criado_em + interval '1 hour'
        ) AS irma_ok`,
    [pisoIso, String(minutos)],
  )
  let alertadas = 0
  for (const r of rows) {
    if (r.irma_ok) continue
    const res = await alertarFalha({
      execucaoId: r.id,
      origem: "abandonada",
      acao: r.acao,
      etapa: r.etapa_atual,
      erro: "a execução abriu e nunca fechou",
      pessoa: r.pessoa_nome,
      contrato: r.contrato,
    })
    if (res.gravado) alertadas++
  }
  return { marcadas: rows.length, alertadas }
}
