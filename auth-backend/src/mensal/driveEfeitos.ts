// Arquivos Drive do mensal — porta do nó "Mensal Preparar Arquivos Drive" (krRj3mXCM3F1CCYN).
// Gera os TXT de boleto/comprovante + QR PNG e delega ao serviço arquivarDrive
// (services/driveArquivar.ts, já portado do WF Drive do n8n: CAJU/BOLETOS,
// CAJU/COMPROVANTES, link da pasta na Solicitação de Pagamento).
import { arquivarDrive, type ArquivarResultado } from "../services/driveArquivar.js"
import { summaryUrlCaju, type PedidosCajuIds } from "../clients/caju.js"
import type { ContratoPreviaMensal, PessoaPreviaMensal } from "./types.js"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

/** Sanitiza nome de arquivo (porta do safe() do n8n). */
export function safeNomeArquivo(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

/** Último dia do mês (UTC) — igual ao lastDay() do n8n. */
export function ultimoDiaMes(ano: number, mes: number): string {
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10)
}

function pessoasResumoTxt(pessoas: PessoaPreviaMensal[]): string {
  return pessoas.map((p, idx) => {
    const valorCredito = Number(p.creditoVR || 0) + Number(p.creditoVT || 0)
    const valorPix = Number(p.pixVR || 0) + Number(p.pixVT || 0)
    return `${String(idx + 1).padStart(2, "0")}. ${p.nome} | Chapa: ${p.chapa || "-"} | CPF: ${p.cpf || "-"}` +
      ` | VR: ${p.liquidoVR || 0} | VT: ${p.liquidoVT || 0}` +
      ` | Crédito: ${valorCredito.toFixed(2)} | PIX: ${valorPix.toFixed(2)}`
  }).join("\n")
}

export interface RefsDriveMensal extends PedidosCajuIds {
  idVR?: string | null
  idVT?: string | null
  /** QR do boleto de VR. Desde 08/2026 são dois boletos por contrato, logo dois QRs. */
  qrBoletoVRBase64?: string
  /** QR do boleto de VT. */
  qrBoletoVTBase64?: string
  resumoSolicitacao?: string
}

export interface ArquivoDriveMensal {
  tipo: "caju_boleto" | "caju_comprovante"
  nome_arquivo: string
  mime: string
  conteudoBase64: string
}

export function montarArquivosDriveMensal(
  contrato: ContratoPreviaMensal,
  competencia: string, // YYYY-MM
  competenciaLabel: string,
  refs: RefsDriveMensal,
): { dataInicio: string; dataFim: string; arquivos: ArquivoDriveMensal[] } {
  const [ano, mes] = competencia.split("-").map(Number)
  const dataInicio = `${ano}-${String(mes).padStart(2, "0")}-01`
  const dataFim = ultimoDiaMes(ano!, mes!)
  const resumo = pessoasResumoTxt(contrato.pessoas)
  const sufixo = `${safeNomeArquivo(contrato.contrato)}-${ano}-${String(mes).padStart(2, "0")}`

  const boletoTxt = [
    `Pedido mensal Caju - ${contrato.contrato}`,
    `Competencia: ${competenciaLabel}/${ano}`,
    `Pedido Credito VR: ${refs.pedidoCreditoVR || "-"}`,
    `Summary Credito VR: ${summaryUrlCaju(refs.pedidoCreditoVR ?? null) || "-"}`,
    `Pedido Credito VT: ${refs.pedidoCreditoVT || "-"}`,
    `Summary Credito VT: ${summaryUrlCaju(refs.pedidoCreditoVT ?? null) || "-"}`,
    `Pedido PIX VR: ${refs.pedidoPixVR || "-"}`,
    `Summary PIX VR: ${summaryUrlCaju(refs.pedidoPixVR ?? null) || "-"}`,
    `Pedido PIX VT: ${refs.pedidoPixVT || "-"}`,
    `Summary PIX VT: ${summaryUrlCaju(refs.pedidoPixVT ?? null) || "-"}`,
    `Total VR: ${r2(contrato.totais.vr ?? 0)}`,
    `Total VT: ${r2(contrato.totais.vt ?? 0)}`,
    "",
    "Intermitentes inclusos:",
    resumo || "Nenhum colaborador listado.",
  ].join("\n")

  const comprovanteTxt = [
    `Comprovante tecnico mensal - ${contrato.contrato}`,
    refs.resumoSolicitacao || "",
    "",
    `RM idVR: ${refs.idVR || ""}`,
    `RM idVT: ${refs.idVT || ""}`,
    "",
    "Intermitentes inclusos:",
    resumo || "Nenhum colaborador listado.",
  ].join("\n")

  const arquivos: ArquivoDriveMensal[] = [
    {
      tipo: "caju_boleto",
      nome_arquivo: `boleto-caju-mensal-${sufixo}.txt`,
      mime: "text/plain",
      conteudoBase64: Buffer.from(boletoTxt, "utf8").toString("base64"),
    },
    {
      tipo: "caju_comprovante",
      nome_arquivo: `comprovante-caju-mensal-${sufixo}.txt`,
      mime: "text/plain",
      conteudoBase64: Buffer.from(comprovanteTxt, "utf8").toString("base64"),
    },
  ]
  // Um QR por boleto — o nome do arquivo carrega o benefício, senão os dois se sobrescrevem na pasta.
  for (const [beneficio, qr] of [["vr", refs.qrBoletoVRBase64], ["vt", refs.qrBoletoVTBase64]] as const) {
    if (!qr) continue
    arquivos.push({
      tipo: "caju_boleto",
      nome_arquivo: `boleto-pix-qr-${beneficio}-${sufixo}.png`,
      mime: "image/png",
      conteudoBase64: qr,
    })
  }
  return { dataInicio, dataFim, arquivos }
}

/** Executa o arquivamento no Drive (ESCRITA REAL — GATED no workflow). 1 chamada por tipo. */
export async function arquivarDriveMensal(
  contrato: ContratoPreviaMensal,
  competencia: string,
  competenciaLabel: string,
  refs: RefsDriveMensal & { solicitacaoId?: string | null; nomePrefixo?: string },
): Promise<Array<{ tipo: string; resultado: ArquivarResultado }>> {
  const { dataInicio, dataFim, arquivos } = montarArquivosDriveMensal(contrato, competencia, competenciaLabel, refs)
  const porTipo = new Map<"caju_boleto" | "caju_comprovante", ArquivoDriveMensal[]>()
  for (const a of arquivos) porTipo.set(a.tipo, [...(porTipo.get(a.tipo) ?? []), a])
  const out: Array<{ tipo: string; resultado: ArquivarResultado }> = []
  for (const [tipo, grupo] of porTipo) {
    const resultado = await arquivarDrive({
      tipo,
      // Pasta própria: sem isto o mensal caía dentro de "INTERMITENTE - PONTUAL", que é o default
      // de arquivarDrive (nasceu no pontual e o segmento estava cravado no ensurePath).
      natureza: "INTERMITENTE - MENSAL",
      nome: `${refs.nomePrefixo ?? ""}MENSAL - ${contrato.contrato}`,
      contrato: contrato.contrato,
      data_inicio: dataInicio,
      data_fim: dataFim,
      item_solicitacao_id: refs.solicitacaoId ?? undefined,
      atualizar_monday: true,
      arquivos: grupo.map((a) => ({
        buffer: Buffer.from(a.conteudoBase64, "base64"),
        filename: a.nome_arquivo,
        mime: a.mime,
      })),
    })
    out.push({ tipo, resultado })
  }
  return out
}
