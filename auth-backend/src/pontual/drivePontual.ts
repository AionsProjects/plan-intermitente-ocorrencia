// Drive do PONTUAL — arquivos 1-pessoa (boleto TXT + QR PNG por benefício, comprovante TXT)
// arquivados na pasta da convocação JÁ RESOLVIDA pela fase 1 (`pastas_resolvidas`), o que a
// variante do mensal não sabe fazer. `pasta_estado='pendente'` → resolve na hora e faz o
// back-fill do snapshot (mesmo caminho do sweep).
import { arquivarDrive, type ArquivarResultado } from "../services/driveArquivar.js"
import { safeNomeArquivo, type ArquivoDriveMensal } from "../mensal/driveEfeitos.js"
import { summaryUrlCaju, type PedidosCajuIds } from "../clients/caju.js"
import type { PessoaPreviaMensal } from "../mensal/types.js"
import {
  gerarRelatorioPagamentoPdf,
  nomeArquivoRelatorio,
  type DadosRelatorioPagamento,
} from "../services/relatorioPagamento.js"
import { anotarPastaDrive, type PrePagamentoCompleto } from "./prepagamento.js"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

export interface RefsDrivePontual extends PedidosCajuIds {
  idVR?: string | null
  idVT?: string | null
  qrBoletoVRBase64?: string
  qrBoletoVTBase64?: string
  /** PIX copia-e-cola do boleto (`pixCode.emv`) — quem paga pelo celular não lê QR de PNG. */
  pixCopiaECola?: string
  resumoSolicitacao?: string
  solicitacaoId?: string | null
  /** Dados do relatório. Presente = o PDF vai junto, em RELATORIOS/. */
  relatorio?: DadosRelatorioPagamento
}

export function montarArquivosDrivePontual(
  pessoa: PessoaPreviaMensal,
  refs: RefsDrivePontual,
): ArquivoDriveMensal[] {
  const sufixo = `${safeNomeArquivo(pessoa.nome)}-${pessoa.dataInicio}`
  const temBoleto = (Number(pessoa.pixVR) || 0) + (Number(pessoa.pixVT) || 0) > 0

  const cabecalho = [
    `Intermitente PONTUAL - ${pessoa.nome}`,
    `Chapa: ${pessoa.chapa || "-"} | CPF: ${pessoa.cpf || "-"} | Contrato: ${pessoa.contrato}`,
    `Periodo: ${pessoa.dataInicio} a ${pessoa.dataFim}`,
  ]

  const arquivos: ArquivoDriveMensal[] = []

  if (temBoleto) {
    const boletoTxt = [
      ...cabecalho,
      `Boleto VR: R$ ${r2(pessoa.pixVR || 0)} | Boleto VT: R$ ${r2(pessoa.pixVT || 0)}`,
      `Pedido PIX VR: ${refs.pedidoPixVR || "-"}`,
      `Summary PIX VR: ${summaryUrlCaju(refs.pedidoPixVR ?? null) || "-"}`,
      `Pedido PIX VT: ${refs.pedidoPixVT || "-"}`,
      `Summary PIX VT: ${summaryUrlCaju(refs.pedidoPixVT ?? null) || "-"}`,
      refs.pixCopiaECola ? `\nPIX copia e cola:\n${refs.pixCopiaECola}` : "",
    ].join("\n")
    arquivos.push({
      tipo: "caju_boleto",
      nome_arquivo: `boleto-caju-pontual-${sufixo}.txt`,
      mime: "text/plain",
      conteudoBase64: Buffer.from(boletoTxt, "utf8").toString("base64"),
    })
    for (const [ben, qr] of [["vr", refs.qrBoletoVRBase64], ["vt", refs.qrBoletoVTBase64]] as const) {
      if (!qr) continue
      arquivos.push({
        tipo: "caju_boleto",
        nome_arquivo: `boleto-pix-qr-${ben}-${sufixo}.png`,
        mime: "image/png",
        conteudoBase64: qr,
      })
    }
  }

  const comprovanteTxt = [
    `Comprovante tecnico pontual`,
    ...cabecalho,
    `VR: R$ ${r2(pessoa.liquidoVR || 0)} | VT: R$ ${r2(pessoa.liquidoVT || 0)}`,
    `Credito Caju: R$ ${r2((pessoa.creditoVR || 0) + (pessoa.creditoVT || 0))}`,
    `Boleto PIX: R$ ${r2((pessoa.pixVR || 0) + (pessoa.pixVT || 0))}`,
    `Desconto abatido: VR R$ ${r2(pessoa.descontoVR || 0)} | VT R$ ${r2(pessoa.descontoVT || 0)}`,
    `Pedido Credito VR: ${refs.pedidoCreditoVR || "-"} | VT: ${refs.pedidoCreditoVT || "-"}`,
    `Pedido PIX VR: ${refs.pedidoPixVR || "-"} | VT: ${refs.pedidoPixVT || "-"}`,
    `RM idVR: ${refs.idVR || "-"} | idVT: ${refs.idVT || "-"}`,
    `Solicitacao: ${refs.solicitacaoId || "-"}`,
    refs.resumoSolicitacao ? `\n${refs.resumoSolicitacao}` : "",
  ].join("\n")
  arquivos.push({
    tipo: "caju_comprovante",
    nome_arquivo: `comprovante-caju-pontual-${sufixo}.txt`,
    mime: "text/plain",
    conteudoBase64: Buffer.from(comprovanteTxt, "utf8").toString("base64"),
  })

  // O relatório é o documento; o TXT acima continua sendo o rastro técnico. Os dois convivem:
  // um serve a pessoa que confere, o outro a quem debuga.
  if (refs.relatorio) {
    arquivos.push({
      tipo: "relatorio",
      nome_arquivo: nomeArquivoRelatorio(refs.relatorio),
      mime: "application/pdf",
      conteudoBase64: gerarRelatorioPagamentoPdf(refs.relatorio).toString("base64"),
    })
  }

  return arquivos
}

/**
 * Executa o arquivamento (ESCRITA REAL — gated no workflow).
 *
 * UMA chamada com os arquivos etiquetados por tipo, não uma por tipo: cada chamada extra
 * re-resolveria a árvore e reescreveria as mesmas colunas de pasta no Monday.
 */
export async function arquivarDrivePontual(
  snapshot: PrePagamentoCompleto,
  pessoa: PessoaPreviaMensal,
  refs: RefsDrivePontual,
): Promise<Array<{ tipo: string; resultado: ArquivarResultado }>> {
  const arquivos = montarArquivosDrivePontual(pessoa, refs)
  const pastasResolvidas =
    snapshot.pasta_estado === "pronta" && snapshot.pasta_pessoa_drive_id && snapshot.pasta_convocacao_drive_id
      ? { pastaPessoaId: snapshot.pasta_pessoa_drive_id, pastaConvocacaoId: snapshot.pasta_convocacao_drive_id }
      : undefined

  const resultado = await arquivarDrive({
    nome: pessoa.nome,
    chapa: pessoa.chapa,
    cpf: pessoa.cpf,
    contrato: pessoa.contrato,
    data_inicio: pessoa.dataInicio,
    data_fim: pessoa.dataFim,
    item_entrada_id: snapshot.item_origem_id,
    board_entrada_id: snapshot.monday_board_id ?? undefined,
    item_solicitacao_id: refs.solicitacaoId ?? undefined,
    atualizar_monday: true,
    pastas_resolvidas: pastasResolvidas,
    arquivos: arquivos.map((a) => ({
      tipo: a.tipo,
      buffer: Buffer.from(a.conteudoBase64, "base64"),
      filename: a.nome_arquivo,
      mime: a.mime,
    })),
  })
  // Pasta estava pendente e acabou de ser resolvida pelo caminho normal → back-fill.
  if (!pastasResolvidas && resultado.pasta_convocacao_drive_id) {
    await anotarPastaDrive(snapshot.id, {
      pastaPessoaId: resultado.pasta_pessoa_drive_id,
      pastaConvocacaoId: resultado.pasta_convocacao_drive_id,
      nome: resultado.pasta_convocacao_nome,
      caminho: resultado.pasta_caminho,
    })
  }
  // Formato de retorno preservado (lista) — `urlDoRelatorio` e o step do workflow varrem `uploads`.
  return [{ tipo: "pacote", resultado }]
}

/**
 * Link do PDF recém-subido, casando pelo NOME do arquivo.
 *
 * Pelo nome e não pela ordem: `arquivarDrive` é chamado uma vez por tipo, e um grupo pode ter
 * vários uploads (boleto TXT + QR PNG). Pegar "o último" acertaria por acidente.
 */
export function urlDoRelatorio(
  resultados: Array<{ tipo: string; resultado: ArquivarResultado }>,
  dados: DadosRelatorioPagamento,
): string | null {
  const nome = nomeArquivoRelatorio(dados)
  for (const r of resultados) {
    const u = r.resultado.uploads.find((x) => x.name === nome)
    if (u?.url) return u.url
  }
  return null
}
