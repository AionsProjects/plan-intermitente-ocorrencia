/**
 * Metadados visuais dos contratos pra tela de escolha do Ponto Facultativo.
 *
 * Cada contrato ganha ícone Lucide + paleta tonal sutil. Padrão coerente
 * com Hub (tiles 3D + cor por feature) e /atestados (chips coloridos).
 *
 * Contagem `ativos`/`hoje` ficam mock hardcoded até endpoint Codex
 * `/ponto-facultativo-contratos-ativos` ficar pronto.
 */

import type { LucideIcon } from "lucide-react"
import {
  BookOpen,
  Building2,
  Car,
  GraduationCap,
  HeartPulse,
  TreePine,
  Vote,
} from "lucide-react"

import type { ContratoPontoFacultativo } from "./types"

export type GrupoContratoId =
  | "SEMSA"
  | "SEDUC"
  | "DETRAN"
  | "TRE PB"
  | "CETAM"

export type ContratoMeta = {
  /** Label exibido no tile (curto) */
  label: string
  icon: LucideIcon
  /** Token de paleta — usado em classes Tailwind condicionais */
  tone: "emerald" | "amber" | "sky" | "rose" | "violet"
  /** Descrição curta abaixo do nome (no tile principal) */
  descricao: string
  /** TODO Codex: substituir por endpoint /ponto-facultativo-contratos-ativos */
  ativos?: number
  hoje?: number
}

export const GRUPO_META: Record<GrupoContratoId, ContratoMeta> = {
  SEMSA: {
    label: "SEMSA",
    icon: HeartPulse,
    tone: "emerald",
    descricao: "Saúde municipal",
    ativos: 247,
    hoje: 12,
  },
  SEDUC: {
    label: "SEDUC",
    icon: GraduationCap,
    tone: "amber",
    descricao: "Educação — escolha o subgrupo",
    ativos: 412,
    hoje: 34,
  },
  DETRAN: {
    label: "DETRAN",
    icon: Car,
    tone: "sky",
    descricao: "Trânsito",
    ativos: 89,
    hoje: 5,
  },
  "TRE PB": {
    label: "TRE PB",
    icon: Vote,
    tone: "rose",
    descricao: "Tribunal eleitoral",
    ativos: 56,
    hoje: 3,
  },
  CETAM: {
    label: "CETAM",
    icon: BookOpen,
    tone: "violet",
    descricao: "Centro técnico",
    ativos: 134,
    hoje: 8,
  },
}

/** Subgrupos SEDUC — exibidos quando user clica no tile "SEDUC" principal. */
export const SEDUC_SUBGRUPOS: Array<{
  contrato: ContratoPontoFacultativo
  meta: ContratoMeta
}> = [
  {
    contrato: "SEDUC ESCOLA",
    meta: {
      label: "Escola",
      icon: GraduationCap,
      tone: "amber",
      descricao: "Unidades escolares",
      ativos: 287,
      hoje: 24,
    },
  },
  {
    contrato: "SEDUC SEDE",
    meta: {
      label: "Sede",
      icon: Building2,
      tone: "amber",
      descricao: "Administração central",
      ativos: 58,
      hoje: 6,
    },
  },
  {
    contrato: "SEDUC INTERIOR",
    meta: {
      label: "Interior",
      icon: TreePine,
      tone: "amber",
      descricao: "Unidades do interior",
      ativos: 67,
      hoje: 4,
    },
  },
]

/** Classes Tailwind por tone — pre-computadas pra evitar template strings
 *  dinâmicas que o Tailwind JIT não consegue tree-shake. */
export const TONE_CLASSES: Record<
  ContratoMeta["tone"],
  {
    border: string
    bg: string
    bgHover: string
    text: string
    iconBg: string
    iconRing: string
    iconColor: string
    glow: string
  }
> = {
  emerald: {
    border: "border-emerald-300/25",
    bg: "bg-emerald-300/[0.04]",
    bgHover: "hover:bg-emerald-300/[0.09]",
    text: "text-emerald-100",
    iconBg: "bg-emerald-300/12",
    iconRing: "ring-emerald-300/35",
    iconColor: "text-emerald-300",
    glow: "hover:shadow-[0_8px_28px_-8px_rgba(110,231,183,0.45)]",
  },
  amber: {
    border: "border-amber-300/25",
    bg: "bg-amber-300/[0.04]",
    bgHover: "hover:bg-amber-300/[0.09]",
    text: "text-amber-100",
    iconBg: "bg-amber-300/12",
    iconRing: "ring-amber-300/35",
    iconColor: "text-amber-300",
    glow: "hover:shadow-[0_8px_28px_-8px_rgba(232,194,117,0.45)]",
  },
  sky: {
    border: "border-sky-300/25",
    bg: "bg-sky-300/[0.04]",
    bgHover: "hover:bg-sky-300/[0.09]",
    text: "text-sky-100",
    iconBg: "bg-sky-300/12",
    iconRing: "ring-sky-300/35",
    iconColor: "text-sky-300",
    glow: "hover:shadow-[0_8px_28px_-8px_rgba(125,211,252,0.45)]",
  },
  rose: {
    border: "border-rose-300/25",
    bg: "bg-rose-300/[0.04]",
    bgHover: "hover:bg-rose-300/[0.09]",
    text: "text-rose-100",
    iconBg: "bg-rose-300/12",
    iconRing: "ring-rose-300/35",
    iconColor: "text-rose-300",
    glow: "hover:shadow-[0_8px_28px_-8px_rgba(252,165,165,0.45)]",
  },
  violet: {
    border: "border-violet-300/25",
    bg: "bg-violet-300/[0.04]",
    bgHover: "hover:bg-violet-300/[0.09]",
    text: "text-violet-100",
    iconBg: "bg-violet-300/12",
    iconRing: "ring-violet-300/35",
    iconColor: "text-violet-300",
    glow: "hover:shadow-[0_8px_28px_-8px_rgba(196,181,253,0.45)]",
  },
}
