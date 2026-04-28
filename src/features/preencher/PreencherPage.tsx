import { useParams } from "react-router-dom"

import { FormularioWizard } from "./FormularioWizard"
import { TelaCarregando } from "./TelaCarregando"
import { TelaErro } from "./TelaErro"
import { TelaObrigado } from "./TelaObrigado"
import { useProcessamento } from "./useProcessamento"

export function PreencherPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const { data, isLoading, isError, error } = useProcessamento(uuid)

  if (!uuid) {
    return (
      <TelaErro
        titulo="Link inválido"
        mensagem="O link acessado não possui identificador."
      />
    )
  }

  if (isLoading) return <TelaCarregando />

  if (isError) {
    const status = (error as Error & { status?: number })?.status
    if (status === 404) {
      return (
        <TelaErro
          titulo="Link não encontrado"
          mensagem="Esse link não é válido ou já não existe mais."
        />
      )
    }
    return (
      <TelaErro
        titulo="Erro ao carregar"
        mensagem="Não foi possível carregar os dados agora. Tente novamente em alguns minutos."
      />
    )
  }

  if (!data) return <TelaCarregando />

  if (data.status === "expirado") {
    return (
      <TelaErro
        titulo="Link expirado"
        mensagem="Esse link de preenchimento expirou. Solicite um novo ao gestor responsável."
      />
    )
  }

  if (data.status === "concluido") {
    return <TelaObrigado dados={data} />
  }

  return <FormularioWizard dados={data} />
}
