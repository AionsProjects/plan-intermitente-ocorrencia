// Stub client-mode do workflow do pontual — o plugin workflow/vite substitui pela
// implementação compilada de /workflows/pontual.ts (mesmo padrão do mensal).
interface PontualWorkflowInput {
  itemOrigemId: string
  execucaoId: string
  modo: "producao" | "simulacao"
}

type WorkflowClient = ((input: PontualWorkflowInput) => Promise<{ desfecho: string }>) & {
  workflowId: string
}

export const executarPontualWorkflowClient = Object.assign(
  async (_input: PontualWorkflowInput): Promise<{ desfecho: string }> => {
    throw new Error("workflow_nao_deve_ser_invocado_diretamente")
  },
  { workflowId: "workflow//./workflows/pontual//executarPontualWorkflow" },
) as WorkflowClient
