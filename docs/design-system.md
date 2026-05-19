# Aionscorp · Frontend Design System

Guia para reutilizar a estética **"midnight liquid glass"** deste projeto em
outros apps. Cobre tokens de design, sistema de glass, componentes-chave,
animações e um checklist pra subir um projeto novo do zero.

> Os exemplos nesse doc são copiáveis: as classes mencionadas existem em
> [`src/index.css`](../src/index.css) deste repo, e os componentes em
> [`src/components/`](../src/components/) e [`src/features/`](../src/features/).

---

## 1. Visão geral

A linguagem visual é construída em volta de 3 princípios:

1. **Vidro líquido (Apple "Liquid Glass")** — modais, cards e tiles têm
   borda biselada, refração de lente nas quinas (SVG `feDisplacementMap`)
   e um leve frosted glass no centro.
2. **Fundo escurecido com aurora** — gradiente noite profunda + 4 orbes
   coloridas animadas que se movem lentamente. Cria profundidade sem
   roubar atenção dos elementos.
3. **Botões iluminados** — cores fortes (dourado, azul, vermelho) com
   halos em camadas, parecem **emitir luz** sobre o fundo escuro.

**Paleta**: midnight blue + gold accent + status colors.
**Tipografia**: Geist (sans) + Instrument Serif (display).
**Border radius**: 1.25rem como base (variável `--radius`).

---

## 2. Stack mínima

```json
{
  "react": "^19.x",
  "vite": "^8.x",
  "tailwindcss": "^4.x",
  "@tailwindcss/vite": "^4.x",
  "tw-animate-css": "^1.x",
  "radix-ui": "^1.x",
  "lucide-react": "*",
  "class-variance-authority": "*",
  "clsx": "*",
  "tailwind-merge": "*"
}
```

Tailwind v4 e `@theme inline` usados pra exportar tokens como classes
utility automaticamente. O `radix-ui` único pacote (não os scoped antigos
`@radix-ui/react-*`).

Tipografia via Google Fonts no `index.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&display=swap");
```

---

## 3. Design Tokens

Definir em `:root` no `index.css`. Todas as cores e medidas referenciadas
no resto do CSS usam estas variáveis.

### Cores base

```css
:root {
  --radius: 1.25rem;

  /* Midnight palette (fundo) */
  --aurora-bg-1: #02040b;   /* mais escuro */
  --aurora-bg-2: #050b18;
  --aurora-bg-3: #08122a;   /* menos escuro */

  /* Aurora accents */
  --aurora-blue:       #4a7dff;
  --aurora-blue-soft:  #6ea0ff;
  --aurora-blue-deep:  #1e3a8a;
  --aurora-gold:       #e8c275;
  --aurora-gold-deep:  #b8862e;
  --aurora-steel:      #94a3b8;

  /* Status */
  --status-red:    #f87171;
  --status-yellow: #facc15;
  --status-green:  #4ade80;

  /* Glass tokens */
  --glass-bg:            rgba(255, 255, 255, 0.07);
  --glass-bg-strong:     rgba(255, 255, 255, 0.12);
  --glass-border:        rgba(255, 255, 255, 0.18);
  --glass-border-strong: rgba(255, 255, 255, 0.28);
  --glass-shadow:        0 20px 60px -10px rgba(8,5,30,0.55),
                         0 8px 24px -8px rgba(8,5,30,0.35);
}
```

### Semantic (shadcn-compatible)

```css
:root {
  --background: transparent;
  --foreground: #f5f3ff;
  --primary: #eef2ff;
  --primary-foreground: #050912;
  --secondary: rgba(255, 255, 255, 0.06);
  --muted: rgba(255, 255, 255, 0.05);
  --muted-foreground: rgba(226, 232, 240, 0.6);
  --accent: rgba(232, 194, 117, 0.12);
  --destructive: #f87171;
  --border: rgba(232, 240, 255, 0.12);
  --ring: rgba(232, 194, 117, 0.55);
}
```

### Tipografia

```css
@theme inline {
  --font-sans:    "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Instrument Serif", ui-serif, Georgia, serif;
}

.text-display {
  font-family: "Instrument Serif", ui-serif, Georgia, serif;
  font-weight: 400;
  letter-spacing: -0.01em;
}
```

Use `text-display` para títulos grandes (`text-3xl+`), Geist (sans) para
todo o resto. Itálico do Instrument Serif tem caráter forte — perfeito
pra destacar palavras-chave dentro de um título:

```jsx
<h1 className="text-display text-5xl text-white">
  Marque os dias com <em className="italic text-[#e8c275]">ocorrência</em>
</h1>
```

---

## 4. Background (`AuroraBackground`)

Wallpaper compartilhado em todas as telas. Inclui também os filtros SVG
de liquid glass usados no resto do app.

```tsx
// src/components/AuroraBackground.tsx
export function AuroraBackground() {
  return (
    <>
      {/* Filtros SVG globais (referenciados via backdrop-filter: url(#liquid-glass)) */}
      <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id="liquid-glass" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.005 0.007"
              numOctaves="1" seed="3" result="turb" />
            <feGaussianBlur in="turb" stdDeviation="4" result="softTurb" />
            <feDisplacementMap in="SourceGraphic" in2="softTurb"
              scale="35" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="liquid-glass-soft" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.024"
              numOctaves="2" seed="3" result="turb" />
            <feGaussianBlur in="turb" stdDeviation="1.5" result="softTurb" />
            <feDisplacementMap in="SourceGraphic" in2="softTurb"
              scale="8" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* Orbe 1 — azul, canto sup-dir */}
        <div className="aurora-orb" style={{
          width: 540, height: 540, top: "-130px", right: "-90px",
          background: "radial-gradient(circle at 30% 30%, #6ea0ff 0%, #2a4fd0 45%, transparent 70%)",
          opacity: 0.38,
          animation: "orb-drift-1 14s ease-in-out infinite",
        }} />
        {/* Orbe 2 — dourado grande, canto inf-esq */}
        <div className="aurora-orb" style={{
          width: 460, height: 460, bottom: "-150px", left: "-110px",
          background: "radial-gradient(circle at 40% 40%, #f0d28a 0%, #c8943a 50%, transparent 72%)",
          opacity: 0.25,
          animation: "orb-drift-2 18s ease-in-out infinite",
        }} />
        {/* Orbe 3 — dourado pequeno, centro-dir */}
        <div className="aurora-orb" style={{
          width: 380, height: 380, top: "55%", right: "10%",
          background: "radial-gradient(circle at 50% 50%, #e8c275 0%, #8a6420 55%, transparent 75%)",
          opacity: 0.18,
          animation: "orb-drift-3 22s ease-in-out infinite",
        }} />
        {/* Orbe 4 — prata, canto sup-esq */}
        <div className="aurora-orb" style={{
          width: 340, height: 340, top: "18%", left: "8%",
          background: "radial-gradient(circle at 50% 50%, #b8c5d6 0%, #5a6b85 55%, transparent 78%)",
          opacity: 0.20,
          animation: "orb-drift-4 20s ease-in-out infinite",
        }} />
      </div>
    </>
  )
}
```

Renderizar **uma vez** no `App.tsx`, fora das rotas. As orbes ficam
fixas (não scrollam).

```tsx
function App() {
  return (
    <>
      <AuroraBackground />
      <Routes>...</Routes>
    </>
  )
}
```

---

## 5. Sistema de Liquid Glass

Quatro variantes principais de "vidro" — escolha conforme o caso de uso.

| Classe | Quando usar | Backdrop |
|---|---|---|
| `.glass` | Cards leves de feedback (loading) | `blur(28px) saturate(160%)` |
| `.glass-strong` | Cards principais (hero, formulário) | `blur(40px) saturate(180%)` |
| `.glass-modal` | Modais de Dialog (`DialogContent`) | `blur(10px)` + lente nas quinas |
| `.glass-tile` | Itens de lista, tiles clicáveis | `url(#liquid-glass-soft) blur(6px)` |
| `.glass-banner-danger` | Banner de ação destrutiva (modo apagar) | `url(#liquid-glass-soft) blur(8px)` + tint vermelho |

### `.glass-modal` (a vedete — efeito de lente nas quinas)

```css
.glass-modal {
  background: rgba(255, 255, 255, 0.04);
  border: 1.5px solid rgba(255, 255, 255, 0.32);
  backdrop-filter: blur(10px) saturate(140%) brightness(1.05);
  box-shadow:
    0 60px 130px -20px rgba(0, 0, 0, 0.95),
    0 25px 50px -8px rgba(0, 0, 0, 0.7),
    0 0 100px 18px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(255, 255, 255, 0.25),
    0 0 0 3px rgba(0, 0, 0, 0.45),
    /* Borda afundada (inset shadows projetando pra dentro) */
    inset 0 10px 26px -6px rgba(0, 0, 0, 0.65),
    inset 0 -8px 20px -6px rgba(0, 0, 0, 0.5),
    inset 10px 0 22px -8px rgba(0, 0, 0, 0.5),
    inset -10px 0 22px -8px rgba(0, 0, 0, 0.5),
    inset 0 2px 0 0 rgba(255, 255, 255, 0.6),
    inset 1.5px 0 0 0 rgba(255, 255, 255, 0.3);
  border-radius: var(--radius);
  position: relative;
  isolation: isolate;
}

/* Lente: backdrop-filter de displacement só nas quinas (mask radial) */
.glass-modal::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
  backdrop-filter: url(#liquid-glass) brightness(1.05) saturate(115%);
  mask-image: radial-gradient(
    ellipse 78% 72% at center,
    transparent 50%,
    rgba(0, 0, 0, 0.4) 75%,
    black 95%
  );
  background:
    radial-gradient(ellipse 70% 45% at 0% 0%, rgba(255, 255, 255, 0.18), transparent 55%),
    radial-gradient(ellipse 35% 30% at 100% 100%, rgba(255, 255, 255, 0.1), transparent 60%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, transparent 2px);
}

.glass-modal > * {
  position: relative;
  z-index: 2; /* conteúdo acima do ::after */
}
```

**Regra-chave**: o `feDisplacementMap` com frequência baixa (0.005) e 1
octave produz **ondas longas e coerentes** parecidas com curvatura de
lente real. Frequências altas (>0.02) viram ruído tipo "água em
movimento" — evitar.

### Glass edge (borda biselada universal)

Aplicada automaticamente em `.glass-tile`, `.glass-banner-danger`,
`.btn-action-expand` e na utility `.glass-edge`:

```css
.glass-edge::after,
.glass-tile::after,
.glass-banner-danger::after,
.btn-action-expand::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 2;
  background:
    radial-gradient(ellipse 70% 45% at 0% 0%, rgba(255, 255, 255, 0.22), transparent 55%),
    radial-gradient(ellipse 35% 30% at 100% 100%, rgba(255, 255, 255, 0.12), transparent 60%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, transparent 1.5px),
    linear-gradient(0deg, rgba(0, 0, 0, 0.18) 0%, transparent 2px);
  mix-blend-mode: overlay;
  opacity: 0.85;
}
```

---

## 6. Componentes principais

### 6.1 Dialog / Modal

Use `radix-ui`'s Dialog primitive como base, customizando `Overlay` e
`Content`:

```tsx
// DialogOverlay: tint escuro, sem blur (deixa o efeito de lente do modal aparecer)
function DialogOverlay({ className, ...props }) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-[#03060f]/55", className)}
      {...props}
    />
  )
}

// DialogContent: aplica .glass-modal
<DialogContent className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md">
  ...
</DialogContent>
```

### 6.2 ChoiceButton (com tilt 3D + variants)

Botões com efeito de "afundar" seguindo o cursor (CSS vars `--mx`/`--my`
setadas via `mousemove`):

```tsx
function ChoiceButton({ variant = "ghost", onMouseMove, onMouseLeave, ...props }) {
  function handleMove(e) {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty("--mx", String(((e.clientX - r.left) / r.width) * 100))
    e.currentTarget.style.setProperty("--my", String(((e.clientY - r.top) / r.height) * 100))
  }
  function handleLeave(e) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }
  const variantClass =
    variant === "primary" ? "choice-btn--primary"
    : variant === "danger" ? "choice-btn--danger"
    : ""
  return (
    <button
      {...props}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`choice-btn ${variantClass}`}
    />
  )
}
```

CSS principal:

```css
.choice-btn {
  --mx: 50;
  --my: 50;
  /* visual base: glass + bevel + lente soft */
  backdrop-filter: url(#liquid-glass-soft) blur(8px) saturate(140%);
  /* tilt 3D segue cursor */
  transform:
    perspective(700px)
    rotateY(calc((var(--mx) - 50) * 0.16deg))
    rotateX(calc((50 - var(--my)) * 0.16deg));
  transition: transform 90ms ease-out, ...;
}

/* halo escuro no ponto do cursor — "polegar afundando" */
.choice-btn::before {
  background: radial-gradient(
    circle at calc(var(--mx) * 1%) calc(var(--my) * 1%),
    rgba(0, 0, 0, 0.22) 0%, transparent 38%
  );
  /* ... */
}

/* gleam claro no ponto oposto — "salto contrário" */
.choice-btn::after {
  background: radial-gradient(
    circle at calc((100 - var(--mx)) * 1%) calc((100 - var(--my)) * 1%),
    rgba(255, 255, 255, 0.12) 0%, transparent 35%
  );
  /* ... */
}

/* afunda no click */
.choice-btn:active {
  transform: ... translateZ(-4px) scale(0.97);
  box-shadow: inset 0 6px 14px rgba(0, 0, 0, 0.3);
}
```

**Variants:**
- `--primary`: gradiente dourado + halo dourado distante (40px) + glow próximo
- `--danger`: neutro → red-950 escuro no hover → red-600 vivo no active, com halos vermelhos crescendo conforme o estado

### 6.3 NumStepper (input number sem spinner nativo)

```tsx
<div className="num-stepper">
  <input type="number" {...} />
  <div className="num-stepper-controls">
    <button onClick={() => bump(step)}><ChevronUp /></button>
    <button onClick={() => bump(-step)}><ChevronDown /></button>
  </div>
</div>
```

Esconder spinner nativo globalmente:
```css
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none; margin: 0;
}
input[type="number"] {
  appearance: textfield;
}
```

### 6.4 btn-action-expand (botão circular que expande no hover)

Ícone-só por default (36px circular), hover/active expande pra mostrar
o label:

```tsx
<button className="btn-action-expand btn-add" title="Adicionar dias">
  <Plus className="size-4 shrink-0" />
  <span className="btn-label">Adicionar dias</span>
</button>
```

CSS faz o `width` transicionar entre `2.25rem` e `auto`, com `max-width`
no `.btn-label` interpolando entre `0` e `10rem`.

### 6.5 Scrollbar custom (track invisível, thumb de vidro)

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track,
::-webkit-scrollbar-track-piece { background: transparent; }
::-webkit-scrollbar-thumb {
  background-color: rgba(180, 195, 220, 0.28);
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: 9999px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}
::-webkit-scrollbar-thumb:hover {
  background-color: rgba(232, 194, 117, 0.4);
  box-shadow: 0 0 8px 1px rgba(232, 194, 117, 0.35);
}
::-webkit-scrollbar-button { display: none; }

/* Firefox */
html {
  scrollbar-width: thin;
  scrollbar-color: rgba(180, 195, 220, 0.32) transparent;
}
```

> ⚠️ **Nunca** agrupe `html, body, *::-webkit-scrollbar { width: 10px }`
> — o `width` aplica em html/body também e quebra layout. Mantenha as
> regras separadas.

---

## 7. Botões "iluminados"

Padrão de halos em camadas pra simular luz emanando do botão. 2-3
shadows com diferentes spreads/blurs criam profundidade real:

```css
.choice-btn--primary {
  box-shadow:
    0 0 40px 4px rgba(232, 194, 117, 0.35),  /* halo distante */
    0 16px 36px -6px rgba(232, 194, 117, 0.65), /* glow próximo */
    inset 0 1px 0 0 rgba(255, 255, 255, 0.5),  /* face brilha */
    inset 0 -1px 0 0 rgba(138, 100, 32, 0.4);
}

.choice-btn--primary:hover {
  /* halo expande pra "luz mais intensa" */
  box-shadow:
    0 0 60px 8px rgba(232, 194, 117, 0.5),
    0 20px 44px -6px rgba(232, 194, 117, 0.75),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.55),
    inset 0 -1px 0 0 rgba(138, 100, 32, 0.4);
}
```

Mesma técnica nas variantes:
- **Gold/Primary** — `rgba(232, 194, 117, ...)` (Sim, Adicionar, Confirmar, Finalizar)
- **Blue/Add** — `rgba(110, 160, 255, ...)` (Adicionar dias)
- **Red/Danger** — `rgba(220, 38, 38, ...)` (Não, faltou; Apagar dias)

---

## 8. Animações

Todas em `index.css`. Use sparingly — não anime tudo, só elementos que
precisam de feedback.

### `fade-up` (entrada padrão)

```css
@keyframes fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-up { animation: fade-up 700ms cubic-bezier(0.22, 1, 0.36, 1) both; }
```

Aplicar em containers que entram na tela. Stagger via `animationDelay`
em listas:

```jsx
{items.map((item, i) => (
  <li className="fade-up" style={{ animationDelay: `${200 + i * 60}ms` }}>
```

### `bubble-pop` (saída de items deletados)

```css
@keyframes bubble-pop {
  0%   { transform: scale(1); opacity: 1; }
  60%  { transform: scale(1.12); opacity: 0.8; }
  100% { transform: scale(0.3); opacity: 0; }
}
.bubble-pop { animation: bubble-pop 380ms cubic-bezier(0.5, 0, 0.7, 0) both; }
```

### `shake-tremble` (modo edição/perigo)

Items "tremem" sutilmente quando entram em modo apagar:

```css
@keyframes shake-tremble {
  0%, 100% { transform: rotate(0deg) translate(0, 0); }
  20%      { transform: rotate(-0.25deg) translate(-0.3px, 0.15px); }
  /* ... */
}
.shake-mode { animation: shake-tremble 0.75s ease-in-out infinite; }
.shake-mode:nth-child(even) { animation-delay: 0.1s; animation-duration: 0.85s; }
```

### Aurora orbs (drift)

4 keyframes `orb-drift-1..4` com diferentes velocidades (14-22s) e
direções, criando movimento orgânico do background.

---

## 9. Cookbook: novo projeto do zero

### 9.1 Setup inicial

```bash
npm create vite@latest meu-app -- --template react-ts
cd meu-app
npm install tailwindcss @tailwindcss/vite tw-animate-css \
  radix-ui lucide-react clsx tailwind-merge class-variance-authority
```

### 9.2 Vite config

```ts
// vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
})
```

### 9.3 Copiar do projeto-mãe

Da [pasta `src/`](../src/) deste repo, copie:

- [`src/index.css`](../src/index.css) — todos os tokens, classes glass, animações
- [`src/components/AuroraBackground.tsx`](../src/components/AuroraBackground.tsx) — wallpaper + filtros SVG
- [`src/components/ui/`](../src/components/ui/) — Dialog, Button, Input, Label, etc. (shadcn customizados)
- [`src/lib/utils.ts`](../src/lib/utils.ts) — `cn()` helper

### 9.4 main.tsx

```tsx
import "./index.css"
import { createRoot } from "react-dom/client"
import App from "./App"

createRoot(document.getElementById("root")!).render(<App />)
```

### 9.5 App.tsx mínimo

```tsx
import { AuroraBackground } from "@/components/AuroraBackground"

function App() {
  return (
    <>
      <AuroraBackground />
      <main className="relative z-10 min-h-svh">
        {/* sua app aqui */}
      </main>
    </>
  )
}
```

### 9.6 Primeiro card

```tsx
<div className="glass-strong p-10">
  <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
    Subtítulo
  </p>
  <h1 className="text-display mt-3 text-5xl text-white">
    Título com <em className="italic text-[#e8c275]">destaque</em>
  </h1>
  <p className="mt-4 text-sm text-white/65">Corpo do texto.</p>
</div>
```

### 9.7 Primeiro modal

```tsx
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md">
    <DialogTitle className="text-display text-3xl text-white">
      Olá, mundo
    </DialogTitle>
  </DialogContent>
</Dialog>
```

---

## 10. Checklist de qualidade

Antes de declarar um app no padrão Aionscorp:

- [ ] `AuroraBackground` renderizado uma vez no App, fora das rotas
- [ ] SVG `#liquid-glass` e `#liquid-glass-soft` carregados (vêm com AuroraBackground)
- [ ] `index.css` importado no `main.tsx`
- [ ] Body com gradiente midnight (default do `index.css`)
- [ ] Tipografia: `text-display` em títulos, Geist em texto corrido
- [ ] Modais usam `glass-modal` (Dialog do radix customizado)
- [ ] Botões primários usam `.choice-btn--primary` ou estilo equivalente com halo dourado
- [ ] Scrollbar custom aplicada (track invisível, thumb cinza-vidro)
- [ ] Cores de status (red/yellow/green) usam `--status-*`
- [ ] Animações de entrada via `.fade-up`
- [ ] Sem `box-shadow` plano (sempre 2+ camadas pra criar profundidade)

---

## 11. Lições aprendidas (não cometa de novo)

- **`feDisplacementMap` com frequência alta** = ruído aleatório, parece água ondulada. Use `baseFrequency="0.005 0.007"` + `numOctaves="1"` + blur de 4px no mapa pra obter curvatura coerente de lente.
- **Distorção uniforme** no modal inteiro fica artificial. Aplique displacement só na quina via `::after` com `mask-image: radial-gradient` (transparente no centro).
- **`mask-composite: exclude`** é instável em alguns Chromium. Pra "buracos" no overlay, prefira renderizar 4 retângulos posicionados ao redor do alvo via JS.
- **Scrollbar regra agrupada** (`html, body, *::-webkit-scrollbar`) aplica `width` no html/body e quebra layout. Manter selectors separados.
- **Clipboard API** só funciona em HTTPS/localhost. Pra HTTP intranet, fallback com `document.execCommand('copy')` + `<textarea>` selecionado.
- **`VITE_*` envs são build-time**: mudar `.env` em prod exige rebuild da imagem Docker (`docker compose up -d --build`).
- **`backdrop-filter` em pseudo-element** não compõe direto com `mix-blend-mode` no mesmo elemento — escolha um.
- **Tailwind v4 + `@theme inline`** auto-gera utilities das vars, mas só dentro do `@theme` block, não de `:root` arbitrário.

---

### Dock flutuante macOS-like (preview ao hover)

Botão fixed canto inferior que, ao hover, revela card-preview acima com lista compacta + setinha tipo callout do dock macOS. Click no botão abre dialog completo.

Pattern usado pelo `ResumoSessao` em `/atestados` (`src/features/atestados/ResumoSessao.tsx`). Aplicável a qualquer botão fixed que acumula estado (carrinho, fila, contador de notificações).

#### Estrutura HTML

```jsx
<div className="resumo-dock group fixed bottom-6 right-6 z-40">
  <div className="resumo-dock-preview">
    <div className="resumo-dock-preview-card">
      <p className="text-[9px] uppercase tracking-[0.28em] text-amber-100/65">
        Sessão · {total} docs
      </p>
      <ul className="mt-2 space-y-1.5">
        {grupos.slice(0, 4).map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 text-xs text-white/85">
            <span className="truncate">{g.nome}</span>
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
              {g.count}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[9px] uppercase tracking-[0.22em] text-amber-100/55">
        Clique pra abrir
      </p>
    </div>
  </div>

  <button onClick={onAbrir} className="floating-resumo ...">
    {/* botão flutuante padrão */}
  </button>
</div>
```

#### CSS (cole em `index.css`)

```css
.resumo-dock-preview {
  position: absolute;
  bottom: calc(100% + 12px);
  right: 0;
  pointer-events: none;
  opacity: 0;
  transform: translateY(8px) scale(0.85);
  transform-origin: bottom right;
  transition:
    opacity 280ms cubic-bezier(0.34, 1.46, 0.5, 1),
    transform 320ms cubic-bezier(0.34, 1.46, 0.5, 1);
  filter: drop-shadow(0 16px 32px rgba(0, 0, 0, 0.55));
}
.resumo-dock:hover .resumo-dock-preview {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
.resumo-dock-preview-card {
  min-width: 220px;
  max-width: 280px;
  border-radius: 16px;
  padding: 14px 16px;
  background: rgba(10, 18, 36, 0.92);
  border: 1px solid rgba(232, 194, 117, 0.32);
  box-shadow:
    inset 0 1px 0 0 rgba(255, 236, 194, 0.16),
    0 0 24px rgba(232, 194, 117, 0.18);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
}
/* Setinha apontando pro botão (estilo callout dock) */
.resumo-dock-preview-card::after {
  content: "";
  position: absolute;
  bottom: -6px;
  right: 36px;
  width: 12px;
  height: 12px;
  background: rgba(10, 18, 36, 0.92);
  border-right: 1px solid rgba(232, 194, 117, 0.32);
  border-bottom: 1px solid rgba(232, 194, 117, 0.32);
  transform: rotate(45deg);
}
/* Magnification — botão "respira" quando dock abre */
.resumo-dock:hover .floating-resumo {
  transform:
    perspective(600px)
    rotateY(calc((var(--mx, 50) - 50) * 0.1deg))
    rotateX(calc((50 - var(--my, 50)) * 0.1deg))
    translateZ(4px) translateY(-3px) scale(1.04);
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.6),
    0 0 32px rgba(232, 194, 117, 0.35);
}
```

#### Regras críticas

- **`transform-origin: bottom right`** — card cresce do canto inferior direito (origem do botão). Sem isso vira fade simples sem efeito dock.
- **`cubic-bezier(0.34, 1.46, 0.5, 1)`** — overshoot leve (max 1.46) simula spring do macOS sem virar bobby spring. Easing diferente pra opacity (280ms) e transform (320ms) cria "ele se ilumina antes de chegar".
- **`pointer-events: none` no estado fechado** — preview não bloqueia cliques no que está atrás.
- **`pointer-events: auto` ao abrir** — recupera clicabilidade pra usuário interagir com preview sem fechar.
- **Setinha via `::after rotate(45deg)`** — triangle CSS clássico mas com `border-right + border-bottom` (não `solid`) pra integrar com o glass border do card.
- **Magnification do botão (`scale 1.04 + translateZ`)** — segue mesma física dos tiles 3D do projeto. Não exagerar (acima de 1.08 vira cartoonish).
- **Filter `drop-shadow` no preview** — projeta sombra respeitando bordas arredondadas do card. Diferente de `box-shadow` que cria caixa retangular invisível.

#### Quando usar / não usar

**Use:**
- Botão fixed com contador (carrinho, fila, sessão acumulada, notificações)
- Conteúdo do preview cabe em ~280px width / 4-5 itens
- Click no botão abre experiência completa (dialog/painel)

**Não use:**
- Conteúdo precisa de mais que 5 linhas → vira painel, não preview
- Botão único não-fixed sem acúmulo (use Tooltip do Radix)
- Mobile only — hover não existe em touch (fallback: tap mostra preview, second tap abre)

#### Variações sugeridas

- **Tom violet** pra notificações: trocar `rgba(232, 194, 117, *)` → `rgba(167, 143, 255, *)` em border/glow/badge.
- **Esquerda em vez de direita**: invertir `transform-origin: bottom left` + `left: 0` no preview + setinha em `left: 36px`.
- **Pulse on add**: combinar com `@keyframes pulse-add` (ver `src/index.css`) — animação dispara via classe condicional quando contador incrementa.

---

## 12. Referências externas inspiradoras

- Apple "Liquid Glass" (WWDC 2025) — efeito-mãe
- Apple macOS Dock — magnification + spring (pattern do dock flutuante acima)
- Linear, Raycast — uso disciplinado de glass + dark + accent dourado
- shadcn/ui — primitives base do design system
- Radix UI — primitives sem estilo (Dialog, Popover, etc.)

---

**Última atualização**: 2026-05. Mantido por Aionscorp Frontend.
