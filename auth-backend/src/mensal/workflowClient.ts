import type { SnapshotPreviaMensal } from "./types.js"

interface MensalWorkflowInput {
  runId: string
  modo: "homologacao" | "producao"
  snapshot: SnapshotPreviaMensal
  somenteContratos?: string[]
}

type WorkflowClient = ((input: MensalWorkflowInput) => Promise<{ runId: string }>) & {
  workflowId: string
}

// Equivalente ao client-mode transform do Workflow SDK. A implementação real
// é compilada a partir de /workflows/mensal.ts pelo plugin workflow/vite.
export const executarMensalWorkflowClient = Object.assign(
  async (_input: MensalWorkflowInput): Promise<{ runId: string }> => {
    throw new Error("workflow_nao_deve_ser_invocado_diretamente")
  },
  { workflowId: "workflow//./workflows/mensal//executarMensalWorkflow" },
) as WorkflowClient
