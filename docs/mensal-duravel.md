# Mensal durável — fonte de verdade

O mensal novo é iniciado exclusivamente pelo backend autenticado. O navegador calcula uma prévia
somente leitura, DP/Admin aprova o snapshot e o Workflow DevKit executa contratos em série. O n8n
não é chamado pelo app e permanece apenas como contingência controlada durante a migração.

## Segurança operacional

- `MENSAL_WORKFLOW_ENABLED=0` impede qualquer início de workflow.
- `MENSAL_MODO=homologacao` executa integrações simuladas e grava o ledger; não chama sistemas externos.
- `MENSAL_PRODUCTION_ENABLED=0` é uma segunda trava obrigatória para produção.
- O efeito de confirmação de crédito Caju não existe no executor e deve continuar desligado no n8n.
- Um advisory lock PostgreSQL impede runs mensais globais concorrentes.
- Prévia sem aprovação expira em 30 minutos. Histórico e ledger expiram em 24 meses pelo cron mensal.

## Estados e retomada

Cada contrato percorre validação, Caju, RM, Monday, solicitação e Drive em série. Cada efeito recebe
uma chave de idempotência por competência, contrato e efeito em `efeitos_externos`. Uma falha definitiva
isola o contrato; erros transitórios usam retry do Workflow DevKit. A retomada seleciona somente itens
falhos/interrompidos e consulta o ledger antes de cada chamada.

## Adaptadores reais (concluídos em 11/07/2026)

Todos os efeitos externos têm adaptador real, GATED por `modo=producao` + `MENSAL_PRODUCTION_ENABLED=1`
+ ledger. Em homologação continuam 100% simulados.

| Efeito | Arquivo | Notas |
| --- | --- | --- |
| Caju (pessoas, crédito, PIX, QR) | `auth-backend/src/clients/caju.ts` | endpoint singular `allowance_order`; token renovado por contrato; crédito NÃO é confirmado (paridade com o nó desligado do n8n) |
| Monday (Plano, Desconto FIFO, Controle Caju, Solicitação, AUTOMAÇÃO-OK) | `auth-backend/src/mensal/mondayEfeitos.ts` | colunas do Plano resolvidas por título (registry); grupo do Controle Caju vem da COMPETÊNCIA do snapshot (corrige o bug `new Date()` do legado); AUTOMAÇÃO-OK é a 12ª etapa, só após todas as demais |
| RM via ponte AIONS (histórico ZMDHSTBENFUNC, FopRotinas, IDFNAN, IntegrarBackOffices) | `auth-backend/src/mensal/rmEfeitos.ts` | serial; histórico em lotes de 50 com espera de 60s; dedup FORTE por IDFINANC no ledger (entre runs — substitui o staticData frágil do n8n); executores aceitam `ambiente=teste` e `dry_run` (AIONS V5) |
| Drive (boleto/comprovante/QR em CAJU/*, link na Solicitação) | `auth-backend/src/mensal/driveEfeitos.ts` | delega ao `services/driveArquivar.ts` já validado no pontual |

O workflow (`workflows/mensal.ts`) tem 12 etapas por contrato e ~19 steps duráveis. `idVR`/`idVT` do RM
fluem para a Solicitação; `orderId`/QR do Caju fluem para Controle Caju, Solicitação e Drive.

## Paridade com o legado (evidência de 11/07/2026)

Harness versionado: `auth-backend/src/scripts/paridade-mensal.ts`. Ele executa o código REAL dos Code
nodes do WF n8n (extraído via API; o JSON dos nós NÃO é versionado por conter segredos do WF) sobre os
mesmos boards Monday e diffa contra `calcularPreviaMensal` + builders.

Resultado na competência 07/2026 (54 pessoas, 6 contratos):

- **160 comparações, 0 divergências** — valores por pessoa (bruto, desconto FIFO, líquido, crédito,
  PIX), totais por contrato, planUpdates (54 itens × 7 colunas), descontoUpdates, payloads Caju
  (crédito+boleto por contrato) e Solicitação (column_values + resumo).
- XMLs RM validados na ponte AIONS com `ambiente=teste` + `dry_run=true`:
  FopRotinas, IntegrarBackOffices e histórico ZMDHSTBENFUNC → `validacao_ok` (3/3), zero chamada ao RM.
- Único desvio encontrado e corrigido: dias-VT informativos zerados para não-optante (igual ao legado;
  sem impacto financeiro).
- Nota: a antifraude do legado (`contrato_ja_solicitado`) é neutralizada no harness só para comparar o
  cálculo; o bloqueio por competência processada é testado à parte (runs de homologação).

Como re-rodar antes do corte:

```
# 1) extrair os Code nodes do WF krRj3mXCM3F1CCYN via API n8n para um JSON local
# 2) com o backend local de pé (porta 3000):
cd auth-backend
npx tsx --env-file=.env src/scripts/paridade-mensal.ts <caminho do JSON>
```

## Controles de teste (homologação)

- Prévia aceita `bypassAntifraude: true` (honrado SÓ em homologação) — processa contratos já pagos.
- Aprovar aceita `somenteContratos: [..]` — roda um subconjunto.
- A UI expõe ambos quando `GET /api/mensal/config` retorna `modo=homologacao`
  (painel "Modo teste" na conferência + checklist de contratos na confirmação).
- Acompanhamento: `GET /runs/ativo` (reatar após reload) e `GET /runs/:id/ao-vivo` (run+itens+eventos
  numa chamada); tracker passo N/12 com rótulos amigáveis.

## Ativação segura

1. Aplicar a migration `014_mensal_duravel.sql`. *(feito)*
2. Configurar `CRON_SECRET` e manter as três travas mensais nos valores seguros acima.
3. ~~Executar uma prévia e comparar o snapshot com o n8n~~ **feito — paridade 160/160 (ver acima).**
4. ~~Definir `MENSAL_WORKFLOW_ENABLED=1` em homologação e validar~~ **feito — múltiplos runs de
   homologação concluídos (Preview e local), idempotência entre runs comprovada.**
5. ~~Implementar cada adaptador externo~~ **feito — 4/4 (tabela acima).**
6. Pendências restantes antes de produção financeira:
   - `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64` e `CRON_SECRET` no Vercel;
     `RM_BRIDGE_URL`/`RM_AIONS_AUTH` também em Preview se for ensaiar lá.
   - Ensaio de restart/retomada em cada etapa (o ledger já provou dedup entre runs;
     falta o teste sistemático etapa a etapa).
   - Plano de rollback e conciliação documentado.
   - Re-rodar o harness de paridade na competência do corte.
   - Só então virar, em sequência controlada: `MENSAL_PRODUCTION_ENABLED=1` e `MENSAL_MODO=producao`.
   - Reconfirmar que o nó `Mensal Confirmar Pedido CREDITO Caju` segue desligado no n8n.

O documento `docs/n8n/wf-mensal-fifo.md` descreve o legado e não é a fonte de verdade do fluxo novo.
