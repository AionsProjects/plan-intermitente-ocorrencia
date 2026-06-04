import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Props = {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  placeholder?: string
  disabled?: boolean
  emptyMessage?: string
}

export function GlassSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Selecione...",
  disabled = false,
  emptyMessage = "Nenhuma opção disponível.",
}: Props) {
  const [aberto, setAberto] = useState(false)

  function escolher(opt: string) {
    if (disabled) return
    onChange(opt)
    setAberto(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!disabled) setAberto(true)
        }}
        disabled={disabled}
        className={`flex w-full items-center justify-between rounded-xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-left text-sm backdrop-blur transition hover:border-[rgb(var(--ink)/0.2)] hover:bg-[rgb(var(--ink)/0.06)] ${
          aberto ? "border-[#e8c275]/55 bg-[rgb(var(--ink)/0.08)]" : ""
        } ${disabled ? "cursor-not-allowed opacity-55 hover:border-[rgb(var(--ink)/0.12)] hover:bg-[rgb(var(--ink)/0.04)]" : ""}`}
      >
        <span className={value ? "text-foreground" : "text-foreground/40"}>
          {value || placeholder}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-foreground/55 transition-transform ${
            aberto ? "rotate-180" : ""
          }`}
        />
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          className="glass-modal border-0 bg-transparent p-8 text-foreground sm:max-w-md"
          style={{
            backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
          }}
        >
          <DialogHeader>
            <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
              Escolher opção
            </p>
            <DialogTitle className="text-display text-3xl text-foreground">
              {label}
            </DialogTitle>
            <DialogDescription className="text-foreground/60">
              Selecione uma das opções abaixo.
            </DialogDescription>
          </DialogHeader>

          <div className="my-2 h-px bg-[rgb(var(--ink)/0.12)]" />

          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {options.length === 0 && (
              <p className="rounded-2xl border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.04)] px-5 py-4 text-sm text-foreground/55">
                {emptyMessage}
              </p>
            )}
            {options.map((opt) => {
              const sel = opt === value
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => escolher(opt)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-5 py-3.5 text-left text-sm font-medium transition ${
                    sel
                      ? "border-[#e8c275]/45 bg-[#e8c275]/12 text-[#ffe6b0]"
                      : "border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/90 hover:border-[rgb(var(--ink)/0.25)] hover:bg-[rgb(var(--ink)/0.08)]"
                  }`}
                >
                  <span>{opt}</span>
                  {sel && <Check className="size-4 text-[#e8c275]" />}
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
