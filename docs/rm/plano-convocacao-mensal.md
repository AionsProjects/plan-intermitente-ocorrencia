# Plano — MENSAL grava convocações no RM (S-2260)

> Decisões tomadas pelo Isaac em 10/08/2026. Análise-base: 5 mapas + crítica (workflow `analise-mensal-rm`).
> Pontual já validado em produção (C03S003779, gravado e revertido no mesmo dia).

## Decisões de negócio (fechadas)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Quem recebe S-2260 | **Todo o grupo MENSAL** — inclusive líquido zero (trabalhou, 100% descontado) e cancelado parcial (período truncado até `Cancelamento Início − 1`). Consequência: a etapa **lê o board**, não confia só no snapshot da prévia (que filtra líquido zero e não vê o grupo CANCELADOS PARCIAL). |
| 2 | Posição no contrato | **Antes do financeiro RM** — ordem eSocial: convocação precede pagamento. Início do bloco RM do `processarContrato`. |
| 3 | Convocação CANCELADA no RM (lançada à mão pelo DP) | **Esperar aprovação humana.** A automação NÃO regrava nem pula calado: pessoa vira `requer_decisao_dp` no relatório e o contrato marca erro com motivo claro. Caminho do DP: deletar a cancelada no RM (retomada regrava) ou lançar a válida à mão (pré-voo adota). Override "ignorar de vez" fica pra v2 — lacuna registrada. |
| 4 | Falha parcial | **Contrato marca ERRO.** AUTOMAÇÃO-OK só com 100%. Retomada re-roda só o que faltou; idempotência pula quem já gravou. |

## Fases

**F1 — `services/convocacaoMensal.ts`** (arquivo novo — zero conflito com o WIP do split Caju)
`processarConvocacaoMensalContrato()`: lê grupo MENSAL + CANCELADOS PARCIAL do board (registry) → 1 pré-voo do grupo (ReadView em lotes de chapas; **nunca pular entre runs** — é a única barreira contra board recopiado e lançamento manual) → 1 leitura de atestados do contrato (`CHAPA='%'` + filtro client-side por Set de chapas; nova `ausenciasDoContrato` com guarda de forasteiras, falha-fechado) → por item: `effectivePeriod` (cancelado parcial) → quebra por atestado → `gravarConvocacaoRm({pularPreVoo: true, origemAcao: 'mensal'})` → eco acumulado. Pré-voo filtra `ESTADOCONVOCACAO` cancelada → `requer_decisao_dp`. Pedaço mudo → job `convocacao_rm_pontual` **passo 1**. Agregado por contrato: `{gravados, jaExistiam, cobertos, requerDecisao[], falhas[]}`.

**F2 — Step no workflow** (região livre de `workflows/mensal.ts`, ~225–394 + 1 linha de chamada)
`etapaConvocacaoRm(runId, contrato, lote)` com `"use step"`, **lotes de ~10 pessoas** (pior caso 10×20s=200s; SEMSA 27 num step só = 540s, estoura), chave `mensal:<competência>:<contrato>:convocacao_rm:<lote>` (nome NOVO — nunca reusar nome de etapa do ledger), `reservarOuPular` + `maxRetries`. Chamada no início do bloco RM (decisão 2) — fica a ~4 linhas de um hunk do WIP: coordenar o merge com a outra sessão. Etapa nova no trilho da UI (`ETAPAS_ORDEM`/`ETAPA_LABEL` + `demoRun`). Flag `CONVOCACAO_RM_MENSAL_HABILITADA=0`.

**F3 — Bordas**
Virada de 14/08: garantir coluna `Código Convocação RM` na cópia e setembro sem códigos herdados de agosto; conferir registry (`registrar-boards`). Atestado retroativo entre passadas: v1 não substitui registro sozinho (`planejarSubstituicaoRm` existe, plugar é fase própria — registrado).

**F4 — Verificação**
Testes DI → run homologação (efeitos simulados, chave por run) → produção **TRE PB (1 item)** com DP → contratos grandes.

## Fatos medidos que sustentam o desenho

- Grupo MENSAL: 63 itens (SEMSA 27, CETAM 15, DETRAN 10, SEDUC ESCOLA 8, SEDUC INTERIOR 2, TRE PB 1); CANCELADOS PARCIAL: 2.
- Retry do MESMO run: índice `uq_convocacoes_rm_vivo` cobre. Run novo sobre board recopiado (itemIds novos): **só o pré-voo cobre**.
- Só 34/63 itens terminam em 31/08 — período vem do ITEM, nunca de "mês inteiro".
- WIP da outra sessão (split Caju VR×VT) cerca o fim do `processarContrato`; região `etapaRm*` está limpa.
