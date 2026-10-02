import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { GoogleIcon } from "@/features/auth/GoogleIcon"

const MENSAGEM_ERRO: Record<string, string> = {
  popup_bloqueado:
    "O navegador bloqueou a janela de login. Libere pop-ups para este site ou use CPF e senha.",
  dominio_nao_permitido: "Use uma conta @contatoserv.com.br. Contas de fora não têm acesso.",
  email_nao_verificado: "Email Google não verificado.",
  conta_desativada: "Conta desativada. Fale com um administrador.",
  state_invalido: "O login expirou antes de terminar. Tente de novo.",
  erro_interno: "Erro no login com Google. Tente de novo.",
}

/**
 * Mostrado por cima da tela quando uma chamada /api devolve 401 e o /auth/me confirma que a
 * sessão caiu. Não navega nem desmonta nada: o rascunho da convocação, os anexos e o resto
 * continuam na página, e a pessoa só repete o clique depois de entrar. Não fecha por Esc nem
 * por clique fora — fechar deixaria o 401 cru à vista sem saída.
 */
export function SessaoExpiradaDialog({
  aberto,
  erro,
  onGoogle,
}: {
  aberto: boolean
  /** Código do último erro de login (ver MENSAGEM_ERRO), ou null. */
  erro: string | null
  onGoogle: () => void
}) {
  return (
    <Dialog open={aberto}>
      <DialogContent
        className="dialogo sm:max-w-md"
        overlayClassName="bg-[rgba(20,20,20,0.35)]"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="dialogo-titulo">Sua sessão expirou</DialogTitle>
          <DialogDescription className="dialogo-desc">
            Entre de novo para continuar. O que você preencheu nesta tela continua aqui e nada
            foi enviado — depois de entrar, é só repetir a ação.
          </DialogDescription>
        </DialogHeader>
        {erro && (
          <p className="aviso aviso--erro">{MENSAGEM_ERRO[erro] ?? "Não foi possível entrar. Tente de novo."}</p>
        )}
        <div className="acoes">
          <button type="button" className="btn-primario" onClick={onGoogle}>
            <GoogleIcon className="size-4" />
            Entrar com Google
          </button>
          <a
            className="btn-secundario no-underline"
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
          >
            Entrar com CPF e senha
          </a>
        </div>
        <p className="text-xs text-[var(--shell-text-muted)]">
          O login com CPF abre em outra aba. Depois de entrar, volte para esta — o aviso some sozinho.
        </p>
      </DialogContent>
    </Dialog>
  )
}
