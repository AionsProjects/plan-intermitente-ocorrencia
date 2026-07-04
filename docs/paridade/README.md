# Código-principal ↔ n8n (reserva)

PREMISSA (invertida em 03/07/2026, Isaac): **o código é o PRINCIPAL** — roda
sozinho, escreve board Monday + PG. **n8n é a reserva/escape** (congelado; volta
só por flip manual `modo='n8n'` em `pi.rotas_processo` via `PATCH /api/rotas/:processo`).

**Regra de ouro: regra de negócio muda no CÓDIGO (commit + testes). Se o n8n
precisar acompanhar (reserva quente), replicar via script .cjs + atualizar esta tabela.**

| Processo | Rota código (principal) | WF n8n (reserva) | Estado | Último check |
|---|---|---|---|---|
| ler / protocolo / convocacoes-empregado | espelhoIntermitente.ts + intermitente.ts (Monday→PG fallback) | WHtIQDf8 / m5GIJMo0 / 8l69E6Z9 | código ✓ | 2026-07-04 |
| convocar | convocar.ts (`/api/intermitente-convocar`) — cria item Monday + PG + link + termo + Drive | dX8OZzxr (WF7) | código ✓ (Drive aguarda credencial) | 2026-07-04 |
| ativar/link (WF1) | gatilhos.ts (`/api/convocar/ativar`, idempotente) + webhook Monday | rkIBahkH | código ✓ (webhook do board ainda aponta pro n8n) | 2026-07-04 |
| cancelar | espelhoIntermitente.ts — Monday (Histórico+Entrada+Descontos+grupo) + PG; ledger engine fiel (total-sobre-parcial, dedupe percentuais) | sbKoeewb | código ✓ | 2026-07-04 |
| split | espelhoIntermitente.ts — split no Histórico (snake, WF3 lê) + PG | ZagUa2yu | código ✓ | 2026-07-04 |
| descontos manual (ler/registrar/gerar-link) | descontos.ts — residual/descontado/status financeiro completos | sr4xxXLx / EXuqosXX / BCgD9f1b | código ✓ | 2026-07-04 |
| pontofac (opcoes/preview/aplicar) | pontofac.ts — dedupe via LEDGER do Histórico + board Descontos (origem PF) + PG | JXpJ / 7gHm / Xybr | código ✓ | 2026-07-04 |
| lançar documentos (atestados) | atestados.ts (`/api/intermitente-lancar-documentos`) + Drive async | kVpn69JF | código ✓ | 2026-07-04 |
| validar atestado (Nexti) | nextiAtestado.ts + services/validarAtestado.ts — Nexti OAuth/persons/absences, dedupe PROCESSADOS, celetista acumulador, ledger+desconto intermitente | 6efSZQYz | código ✓ (repontar automação Monday) | 2026-07-04 |
| unidades RM / buscar empregado / celetista | rmLookups.ts + convocar.ts (ponte AIONS read-only) | OggzTr5x / Dt0p1T6O / 0ljExfCN | código ✓ | 2026-07-04 |
| feriados | espelhoIntermitente.ts + repo/feriados (board 18415442661) | QzZ02GG | código ✓ | 2026-07-04 |
| drive arquivar / planilha | drive.ts + services/driveArquivar.ts + clients/xlsx.ts | XRdAYO9d / aBXCqYHP | código pronto — **aguarda GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON(+_BASE64) e GOOGLE_DRIVE_ROOT_FOLDER_ID** | 2026-07-04 |
| **registro (finalizar/WF3)** | espelho PG only (`intermitente-finalizar`) | rlxTk4VZ | **FICA no n8n** (decisão Isaac 03/07 — webhook Registrar dias) | 2026-07-04 |
| **pagamento pontual FIFO** | — | E1XAdr + subworkflows | **FICA no n8n** (decisão Isaac) | 2026-07-04 |
| **pagamento mensal** | consultas/mensal_run em mensal.ts/mensalRun.ts | krRj3 + subworkflows (Caju/RM/Integrar) | **FICA no n8n** (decisão Isaac) | 2026-07-04 |

## Flip (pós-deploy)

`pi.rotas_processo`: migration 013 semeia os 7 processos em `n8n`. Depois do
deploy + teste real, flipar pra `api` (código principal): `convocar`, `cancelar`,
`split`, `descontos`, `atestados`, `pontofac`. `registro` PERMANECE `n8n`.
Ações manuais no flip: repontar automação Monday do Controle de Atestados
(nexti-validar-atestado) e o webhook create_item/ativar dos boards pro backend.

## Credenciais no backend (.env / Vercel)

- `MONDAY_TOKEN`, `RM_BRIDGE_URL`, `RM_AIONS_AUTH` — ok em prod.
- `NEXTI_BASIC_AUTH` — extraída do WF 6efSZ pro .env local (04/07). **Falta subir no Vercel.**
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (ou `_BASE64`) + `GOOGLE_DRIVE_ROOT_FOLDER_ID` — **pendente (Isaac cria a service account e compartilha a pasta raiz).**

Regra de não-desconto (03/07/2026, Isaac): **DETRAN, TRE PB e SEDUC*** (prefixo)
declaram falta/atraso/atestado/PF mas desconto VR/VT = 0. **Cancelamento
total/parcial desconta SEMPRE** (`aplicarRegraNaoDesconta: false`). Fonte:
`domain/desconto.ts::naoDesconta`. Os WFs (reserva) ainda precisam do patch
`seduc_nao_desconta.cjs` (bloqueado por key n8n expirada — renovar).
