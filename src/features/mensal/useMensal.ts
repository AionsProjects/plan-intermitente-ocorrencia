import { useMutation } from "@tanstack/react-query"

import { confirmarFechamentoMensal, previewMensal } from "./api"
import type { MensalPayload } from "./types"

export function usePreviewMensal() {
  return useMutation({
    mutationFn: (payload: MensalPayload) => previewMensal(payload),
  })
}

export function useConfirmarMensal() {
  return useMutation({
    mutationFn: (payload: MensalPayload) => confirmarFechamentoMensal(payload),
  })
}
