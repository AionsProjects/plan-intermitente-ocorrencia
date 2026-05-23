# Plano de Intermitentes — Registro de Ocorrências

App web acessado por **link único** que o RH usa pra registrar dia a dia
se um intermitente faltou, atrasou ou cumpriu o expediente normalmente.

- **Frontend**: Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui
- **Storage**: board monday (`Plan. de Intermitentes — Histórico de Ocorrências`)
- **Orquestração**: n8n Cloud (4 workflows)

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — visão geral, stack, contratos das APIs, decisões.
- [`DEPLOY.md`](DEPLOY.md) — passo a passo pra subir o frontend numa VM.
- [`docs/n8n/monday-board-schema.md`](docs/n8n/monday-board-schema.md) — schema completo do board com column IDs e payload templates.
- [`docs/especificacao.md`](docs/especificacao.md) — especificação funcional original.
- [`docs/n8n/wf*.json`](docs/n8n/) — workflows do n8n (importáveis no n8n cloud).

- [`docs/n8n/ponto-facultativo.md`](docs/n8n/ponto-facultativo.md) - mapeamento atual da feature Ponto Facultativo, endpoints, boards e pendencias.

## Comandos

```bash
npm install        # instalar dependências
npm run dev        # dev server na porta 5173
npm run build      # build de produção (saída em dist/)
npm run lint       # eslint
npx tsc -b         # só typecheck, sem build
```

## Modo mock vs real

- `.env` vazio (`VITE_N8N_BASE_URL=`) → modo mock (UUIDs `mock-aguardando`, `mock-concluido`, `mock-correcao`, `mock-expirado`).
- `.env` apontando pro n8n → backend real.

Crie um `.env.local` (ignorado pelo git) pra forçar modo mock em dev sem mexer no `.env`.
