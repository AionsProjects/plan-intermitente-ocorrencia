import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { registrarAtividade } from "@/lib/atividade"

import { useConfirmarMensal, usePreviewMensal } from "./useMensal"
import type { MensalContrato, MensalPayload, PapelMensal } from "./types"

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function competenciaPadrao(): string {
  // mês corrente como YYYY-MM (o fechamento normalmente é da competência atual)
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export function MensalPage() {
  const [competencia, setCompetencia] = useState<string>(competenciaPadrao())
  const [papel, setPapel] = useState<PapelMensal>("atual")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sucesso, setSucesso] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)

  const previewMut = usePreviewMensal()
  const confirmarMut = useConfirmarMensal()
  const preview = previewMut.data ?? null

  const payload: MensalPayload | null = useMemo(
    () => (/^\d{4}-\d{2}$/.test(competencia) ? { competencia, papel } : null),
    [competencia, papel],
  )

  function rodarPreview() {
    if (!payload) return
    setSucesso(false)
    previewMut.mutate(payload)
  }

  function confirmar() {
    if (!payload) return
    confirmarMut.mutate(payload, {
      onSuccess: () => {
        setConfirmOpen(false)
        setSucesso(true)
        registrarAtividade("mensal_fechamento", {
          alvo: competencia,
          resumo: {
            competencia,
            papel,
            contratos: preview?.totalContratos ?? null,
            pessoas: preview?.totalPessoas ?? null,
          },
        })
      },
    })
  }

  const erroPreview =
    previewMut.error instanceof Error ? previewMut.error.message : null

  if (sucesso) {
    return (
      <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="glass-strong card-shimmer relative w-full max-w-xl p-8 text-center sm:p-10">
          <p className="eyebrow-fade-in text-[11px] uppercase text-emerald-700/70 dark:text-emerald-200/70">
            Fechamento mensal
          </p>
          <h1 className="text-display mt-2 text-3xl text-foreground sm:text-4xl">
            Fechamento disparado
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-foreground/65">
            O fechamento de <strong>{preview?.competencia ?? competencia}</strong> foi
            enviado. Os pedidos Caju, lançamentos RM e a solicitação no Monday são
            processados em segundo plano. Acompanhe no board de Solicitação de Pagamento.
          </p>
          <Button className="mt-7" onClick={() => { setSucesso(false); previewMut.reset() }}>
            Novo fechamento
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="glass-strong card-shimmer relative w-full max-w-3xl p-8 sm:p-10">
        <header className="mb-7">
          <p className="eyebrow-fade-in text-[11px] uppercase text-emerald-700/70 dark:text-emerald-200/70">
            Fechamento mensal
          </p>
          <h1 className="text-display mt-2 text-4xl leading-tight text-foreground sm:text-5xl">
            Intermitente mensal
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-foreground/58">
            Escolha a competência e pré-visualize o que será lançado por contrato —
            valores, crédito Caju (3 dias), PIX/boleto e descontos. Nada é gravado até
            confirmar.
          </p>
        </header>

        {/* seletor */}
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="competencia">Competência</Label>
            <Input
              id="competencia"
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="papel">Board</Label>
            <select
              id="papel"
              value={papel}
              onChange={(e) => setPapel(e.target.value as PapelMensal)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="atual">Atual</option>
              <option value="proximo">Próximo</option>
            </select>
          </div>
          <Button onClick={rodarPreview} disabled={!payload || previewMut.isPending}>
            {previewMut.isPending ? "Calculando…" : "Pré-visualizar"}
          </Button>
        </div>

        {erroPreview && (
          <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {erroPreview}
          </div>
        )}

        {preview && !erroPreview && (
          <div className="mt-7 space-y-5">
            {preview.totalContratos === 0 ? (
              <div className="rounded-lg border border-border bg-card/50 px-4 py-6 text-center text-sm text-foreground/65">
                Nenhum intermitente mensal a lançar nesta competência.
              </div>
            ) : (
              <>
                {/* totais */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Totais label="Contratos" valor={String(preview.totalContratos)} />
                  <Totais label="Pessoas" valor={String(preview.totalPessoas)} />
                  <Totais label="Crédito Caju (3d)" valor={brl(preview.totalCredito)} />
                  <Totais label="PIX / boleto" valor={brl(preview.totalPix)} />
                  <Totais label="Total VR" valor={brl(preview.totalVR)} />
                  <Totais label="Total VT" valor={brl(preview.totalVT)} />
                  <Totais label="Descontos a aplicar" valor={String(preview.descontosAtualizar)} />
                  <Totais label="Ignorados" valor={String(preview.ignorados)} />
                </div>

                {/* contratos */}
                <div className="space-y-2">
                  {preview.contratos.map((c) => (
                    <ContratoCard
                      key={c.contrato}
                      contrato={c}
                      aberto={expandido === c.contrato}
                      onToggle={() =>
                        setExpandido((cur) => (cur === c.contrato ? null : c.contrato))
                      }
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between gap-4 pt-2">
                  <p className="text-xs text-foreground/55">
                    Confirmar dispara pedidos Caju, lançamentos no RM e a solicitação no
                    Monday.
                  </p>
                  <Button onClick={() => setConfirmOpen(true)}>
                    Confirmar fechamento
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* dialog confirmação */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar fechamento de {preview?.competencia}?</DialogTitle>
              <DialogDescription>
                Isto dispara o fechamento real: cria pedidos Caju, lança o histórico no
                RM e a solicitação no Monday para{" "}
                <strong>{preview?.totalContratos} contratos</strong> /{" "}
                <strong>{preview?.totalPessoas} pessoas</strong>. Não pode ser desfeito
                pela tela.
              </DialogDescription>
            </DialogHeader>
            {confirmarMut.error instanceof Error && (
              <p className="text-sm text-red-300">{confirmarMut.error.message}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={confirmar} disabled={confirmarMut.isPending}>
                {confirmarMut.isPending ? "Disparando…" : "Confirmar e disparar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  )
}

function Totais({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-foreground/50">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{valor}</p>
    </div>
  )
}

function ContratoCard({
  contrato,
  aberto,
  onToggle,
}: {
  contrato: MensalContrato
  aberto: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">{contrato.contrato}</p>
          <p className="text-[11px] text-foreground/50">
            {contrato.pessoas} pessoas · seção {contrato.codSecao}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-[10px] uppercase text-foreground/45">Crédito</p>
            <p className="text-xs font-medium text-foreground">{brl(contrato.credito)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-foreground/45">PIX</p>
            <p className="text-xs font-medium text-foreground">{brl(contrato.pix)}</p>
          </div>
          <span className="text-foreground/40">{aberto ? "▲" : "▼"}</span>
        </div>
      </button>
      {aberto && (
        <div className="border-t border-border px-4 py-3">
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-foreground/50">
                  <th className="pb-2 text-left font-medium">Nome</th>
                  <th className="pb-2 text-left font-medium">Chapa</th>
                  <th className="pb-2 text-right font-medium">VR</th>
                  <th className="pb-2 text-right font-medium">VT</th>
                  <th className="pb-2 text-right font-medium">Crédito</th>
                  <th className="pb-2 text-right font-medium">PIX</th>
                  <th className="pb-2 text-right font-medium">Desc.</th>
                </tr>
              </thead>
              <tbody>
                {contrato.detalhe.map((p, i) => (
                  <tr key={`${p.chapa}-${i}`} className="border-t border-border/40">
                    <td className="py-1.5 pr-2 text-foreground/85">{p.nome}</td>
                    <td className="py-1.5 pr-2 text-foreground/60">{p.chapa}</td>
                    <td className="py-1.5 text-right text-foreground/75">{brl(p.liquidoVR)}</td>
                    <td className="py-1.5 text-right text-foreground/75">{brl(p.liquidoVT)}</td>
                    <td className="py-1.5 text-right text-emerald-300/80">{brl(p.credito)}</td>
                    <td className="py-1.5 text-right text-sky-300/80">{brl(p.pix)}</td>
                    <td className="py-1.5 text-right text-foreground/55">
                      {p.descontoVR || p.descontoVT
                        ? brl(p.descontoVR + p.descontoVT)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
