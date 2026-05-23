import { useMutation } from "@tanstack/react-query"

import {
  aplicarPontoFacultativo,
  previewPontoFacultativo,
} from "./api"

export function usePreviewPontoFacultativo() {
  return useMutation({
    mutationFn: previewPontoFacultativo,
  })
}

export function useAplicarPontoFacultativo() {
  return useMutation({
    mutationFn: aplicarPontoFacultativo,
  })
}
