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
}

export function GlassSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Selecione...",
}: Props) {
  const [aberto, setAberto] = useState(false)

  function escolher(opt: string) {
    onChange(opt)
    setAberto(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={`flex w-full items-center justify-between rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-left text-sm backdrop-blur transition hover:border-white/20 hover:bg-white/[0.06] ${
          aberto ? "border-[#e8c275]/55 bg-white/[0.08]" : ""
        }`}
      >
        <span className={value ? "text-white" : "text-white/40"}>
          {value || placeholder}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-white/55 transition-transform ${
            aberto ? "rotate-180" : ""
          }`}
        />
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md"
          style={{
            backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
          }}
        >
          <DialogHeader>
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
              Escolher opção
            </p>
            <DialogTitle className="text-display text-3xl text-white">
              {label}
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Selecione uma das opções abaixo.
            </DialogDescription>
          </DialogHeader>

          <div className="my-2 h-px bg-white/12" />

          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
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
                      : "border-white/12 bg-white/[0.04] text-white/90 hover:border-white/25 hover:bg-white/[0.08]"
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
