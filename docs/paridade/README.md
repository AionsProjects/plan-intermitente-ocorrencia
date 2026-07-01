# Paridade n8n ↔ backend (Plano de Fuga — contingência)

n8n é PRIMÁRIO. As rotas `/api/<nome-do-webhook>` são espelhos prontos pra assumir
(flip em `pi.rotas_processo` via `PATCH /api/rotas/:processo`, admin). Escrita NUNCA
faz failover automático — só flip manual (`modo='api'`).

**Regra de ouro: mudou regra num WF (via script .cjs) → atualize a rota espelho + esta tabela.**

| Processo | WF n8n | Webhook | Rota espelho | Último check |
|---|---|---|---|---|
| ler | WHtIQDf8oOWinGyx (2. LER) | `intermitente-ler` | espelhoIntermitente.ts (PG) + fallback automático em `/api/intermitente/ler` | 2026-07-01 |
| protocolo | m5GIJMo0ghgSGbh2 (4. BUSCAR) | `intermitente-buscar-protocolo` | idem | 2026-07-01 |
| convocacoes-empregado | 8l69E6Z9ouZAL027 | `intermitente-convocacoes-empregado` | idem | 2026-07-01 |
| registro (finalizar) | rlxTk4VZLM2gTzx7 (WF3) | `intermitente-finalizar` | espelhoIntermitente.ts — PG (status/respostas/ledger/dias_descontados/agregados) + pi.descontos. Regras: Forma-1-ajustada (residual=total−pago), dias só-cancelamento excluídos | 2026-07-01 |
| cancelar | sbKoeewbkS7LNORH | `intermitente-cancelar-convocacao` | espelhoIntermitente.ts — só CANCELADA total bloqueia; total-sobre-parcial = só dias faltantes (testado 7/7) | 2026-07-01 |
| split | ZagUa2yuP6BsAE9i | `intermitente-aplicar-split` | espelhoIntermitente.ts — split jsonb (reverter=NULL) | 2026-07-01 |
| descontos | descontos-registrar | `descontos-registrar-manual` | **SEM espelho ainda** (front já usa chamarProcesso; flip indisponível) | — |
| pontofac | 7gHm/Xybr | `ponto-facultativo-*` | pontofac.ts (preview+aplicar, PG) | 2026-07-01 |
| pagamentos (pontual/mensal) | E1XAdr/krRj3 | — | SEM espelho (decisão: runbook manual + consulta; nunca flip automático) | — |

Front: escritas do preencher (registro/cancelar/split) e descontos usam `chamarProcesso`
(lib/http.ts). Leituras nem passam pelo n8n (backend→Monday com fallback PG automático).

Gaps conhecidos do espelho (aceitos p/ contingência):
- Espelhos de escrita gravam PG (fonte da contingência); board Monday NÃO é atualizado
  pelo fallback (sync PG→Monday = fase futura). Ao religar o n8n, reconciliar com
  `npm run importar:convocacoes` (direção board→PG) — atenção: writes feitos SÓ no PG
  durante a janela de contingência precisam de replay manual no board.
- `descontos-registrar-manual` sem espelho.
