// Rótulos pt-BR das ações, fases e desfechos do log de execuções — no SERVIDOR.
//
// Duplicam de propósito os do front (src/features/atividade/types.ts e etapas.ts): o
// corpo do alerta de WhatsApp e o relatório XLSX são montados aqui e não podem depender
// de bundle do browser. Nasceu de dentro de services/alertaFalha.ts quando o relatório
// virou o segundo consumidor.

export const LABEL_ACAO: Record<string, string> = {
  convocacao: "Convocação",
  registro: "Registro de ocorrência",
  cancelamento: "Cancelamento",
  split: "Divisão de convocação",
  atestado: "Atestado / Declaração",
  ponto_facultativo: "Ponto facultativo",
  desconto: "Registro de desconto",
  mensal: "Pagamento mensal",
  mensal_fechamento: "Pagamento mensal",
}

export const LABEL_ETAPA: Record<string, string> = {
  // convocação (routes/convocar.ts)
  antifraude: "Checando conflito de período",
  criar_item_monday: "Criando item no Plano",
  convocacao_rm: "Convocação no RM (eSocial)",
  upload_termo: "Anexando termos",
  arquivar_drive: "Arquivando no Drive",
  resolver_board: "Resolvendo board do mês",
  // registro / cancelamento / split (routes/espelhoIntermitente.ts)
  validacao: "Validando dados",
  ledger: "Calculando desconto",
  gravar_convocacao: "Gravando a convocação",
  desconto: "Gravando na Base de Desconto",
  valores: "Resolvendo valores do contrato",
  calculo: "Calculando cancelamento",
  monday_historico: "Atualizando o Histórico",
  monday_entrada: "Atualizando o Plano",
  desconto_board: "Gravando na Base de Desconto",
  encurtar_rm: "Encurtando convocação no RM",
  cancelar_rm: "Removendo convocação do RM",
  split_board: "Gravando o split no Histórico",
  split_rm: "Substituindo convocação no RM",
  espelho_pg: "Espelhando no banco",
  // mensal (workflows/mensal.ts)
  caju_pessoas: "Buscando pessoas no Caju",
  caju_credito: "Pedido de crédito Caju",
  caju_pix: "Pedido PIX Caju",
  rm_gerar: "Gerando lançamento no RM",
  rm_aguardar: "Aguardando RM processar",
  rm_integrar: "Integrando no RM",
  monday_plano: "Atualizando o Plano",
  monday_controle_caju: "Registrando no Controle Caju",
  monday_solicitacao: "Criando Solicitação de Pagamento",
  monday_status_ok: "Marcando AUTOMAÇÃO - OK",
  drive: "Arquivando no Drive",
  contrato: "Contrato",
  finalizado: "Finalizado",
  // jobs
  convocacao_rm_pontual: "Convocação no RM (fila)",
  convocacao_rm_remover: "Removendo convocação do RM",
  convocacao_rm_substituir: "Substituindo convocação no RM",
}

export const LABEL_ESTADO_EXECUCAO: Record<string, string> = {
  aberta: "em andamento",
  ok: "concluída",
  erro: "com erro",
  parcial: "concluída com pendência",
  abandonada: "interrompida",
}

export const rotuloAcao = (a: string): string => LABEL_ACAO[a] ?? a.replaceAll("_", " ")
export const rotuloEtapa = (e: string): string => LABEL_ETAPA[e] ?? e.replaceAll("_", " ")
export const rotuloEstadoExecucao = (e: string): string => LABEL_ESTADO_EXECUCAO[e] ?? e
