import { Navigate, useParams } from "react-router-dom"

/**
 * Alias tolerante `/atividade/:id` → `/atividade?exec=:id`.
 *
 * Existe só como rede de segurança: o link canônico do alerta é `?exec=`, mas link
 * mangled por WhatsApp, alerta antigo ou alguém digitando à mão não podem cair em
 * tela branca. Não monta nada — só redireciona.
 *
 * A expansão NÃO pode morar no pathname: `PageTransition` usa
 * `slideKey={location.pathname}`, então cada abrir/fechar de linha deslizaria a tela
 * inteira.
 */
export function RedirParaExec() {
  const { id } = useParams<{ id: string }>()
  return <Navigate replace to={id ? `/atividade?exec=${encodeURIComponent(id)}` : "/atividade"} />
}
