#!/usr/bin/env node
/**
 * Codemod: troca os literais de "ouro de marca" por tokens do esquema de cor,
 * para que botões/ícones/itálicos sigam o esquema escolhido (ouro SÓ no aurora).
 *
 * Converte (acento de marca):
 *   #e8c275 / #ffe6b0 / #d4a64a            -> rgb(var(--accent-rgb))
 *   #6ea0ff                                 -> rgb(var(--surface-rgb))  (ponta fria do gradiente)
 *   rgba(232,194,117, A)                    -> rgb(var(--accent-rgb) / A)
 *   ]/NN  (modificador de opacidade Tailwind logo após um valor convertido)
 *         -> move o alpha pra dentro do rgb(): rgb(var(--accent-rgb)/0.NN)]
 *
 * MANTEM (semanticos, nao sao o ouro de marca):
 *   amber- emerald- sky- rose- violet- (Tailwind), #a78fff / #b6a4ff (CLT),
 *   #0a1224 (texto escuro), status, e TODO o contratosMeta.ts.
 */
const fs = require("fs")
const path = require("path")

const SRC = path.join(__dirname, "..", "src")
const EXCLUDE_FILE = /contratosMeta\.ts$/
const EXCLUDE_PATH = /\.bak/
const EXTS = new Set([".tsx", ".ts"])

/** Walk recursivo de src/. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (EXCLUDE_PATH.test(full)) continue
    if (e.isDirectory()) walk(full, out)
    else if (EXTS.has(path.extname(e.name)) && !EXCLUDE_FILE.test(full)) out.push(full)
  }
  return out
}

const ACCENT = "rgb(var(--accent-rgb))"
const SURFACE = "rgb(var(--surface-rgb))"

function transform(code) {
  let s = code

  // 1) rgba(232,194,117, A) -> rgb(var(--accent-rgb)/A)  (sem espaços: vale
  //    em classe Tailwind arbitrária E em CSS inline)
  s = s.replace(
    /rgba\(\s*232\s*,\s*194\s*,\s*117\s*,\s*([\d.]+)\s*\)/g,
    (_m, a) => `rgb(var(--accent-rgb)/${a})`,
  )

  // 2) hex de acento -> token (case-insensitive)
  s = s.replace(/#e8c275/gi, ACCENT)
  s = s.replace(/#ffe6b0/gi, ACCENT)
  s = s.replace(/#d4a64a/gi, ACCENT)
  s = s.replace(/#6ea0ff/gi, SURFACE)

  // 3) Modificador de opacidade Tailwind logo após um valor convertido:
  //    `rgb(var(--accent-rgb))]/12` -> `rgb(var(--accent-rgb)/0.12)]`
  //    (cobre accent e surface; NN ou N vira NN/100)
  s = s.replace(
    /rgb\(var\((--accent-rgb|--surface-rgb)\)\)\]\/(\d{1,3})/g,
    (_m, varname, nn) => {
      const alpha = (parseInt(nn, 10) / 100).toString()
      return `rgb(var(${varname})/${alpha})]`
    },
  )

  // 4) Normaliza qualquer ` / ` residual dentro dos tokens (de execução
  //    anterior) -> sem espaços, p/ valer em classe Tailwind arbitrária.
  s = s.replace(/rgb\(var\(--accent-rgb\)\s*\/\s*/g, "rgb(var(--accent-rgb)/")
  s = s.replace(/rgb\(var\(--surface-rgb\)\s*\/\s*/g, "rgb(var(--surface-rgb)/")

  return s
}

let changed = 0
const files = walk(SRC)
for (const f of files) {
  const before = fs.readFileSync(f, "utf8")
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(f, after, "utf8")
    changed++
    console.log("  ✓", path.relative(path.join(__dirname, ".."), f))
  }
}
console.log(`\nCodemod concluído: ${changed} arquivo(s) alterado(s) de ${files.length} varrido(s).`)
