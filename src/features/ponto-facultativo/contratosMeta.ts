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
  /** Override do keyframe de hover do ícone. Quando ausente, fallback usa
   *  o keyframe default do `data-tone` (heart-beat / cap-swing / car-drive
   *  / vote-stamp / book-flip). Usado pra subgrupos SEDUC ter anim própria. */
  animOverride?: "cap-swing" | "building-rise" | "tree-sway"
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
    animOverride: "cap-swing",
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
      animOverride: "cap-swing",
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
      animOverride: "building-rise",
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
      animOverride: "tree-sway",
    },
  },
]

/** Classes visuais dos tiles — TODAS derivam do accent do esquema escolhido
 *  pelo usuário (tokens --accent-rgb). O `tone` continua existindo só pra
 *  selecionar o keyframe de animação do ícone no CSS ([data-tone]); a
 *  identidade de cada contrato vem do ícone + animação, não de cor própria. */
const ACCENT_TONE = {
  border: "border-[rgb(var(--accent-rgb)/0.25)]",
  bg: "bg-[rgb(var(--accent-rgb)/0.04)]",
  bgHover: "hover:bg-[rgb(var(--accent-rgb)/0.09)]",
  text: "text-[rgb(var(--accent-rgb))]",
  iconBg: "bg-[rgb(var(--accent-rgb)/0.12)]",
  iconRing: "ring-[rgb(var(--accent-rgb)/0.38)]",
  iconColor: "text-[rgb(var(--accent-rgb))]",
  glow: "hover:shadow-[0_8px_28px_-8px_rgb(var(--accent-rgb)/0.45)]",
} as const

export const TONE_CLASSES: Record<ContratoMeta["tone"], typeof ACCENT_TONE> = {
  emerald: ACCENT_TONE,
  amber: ACCENT_TONE,
  sky: ACCENT_TONE,
  rose: ACCENT_TONE,
  violet: ACCENT_TONE,
}
