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
| **validar atestado (Nexti)** | — | 6efSZQYz | **FICA no n8n** (decisão Isaac 06/07 — automação Nexti só no n8n) | 2026-07-06 |
| unidades RM / buscar empregado / celetista | rmLookups.ts + convocar.ts (ponte AIONS read-only) | OggzTr5x / Dt0p1T6O / 0ljExfCN | código ✓ | 2026-07-04 |
| feriados | espelhoIntermitente.ts + repo/feriados (board 18415442661) | QzZ02GG | código ✓ | 2026-07-04 |
| drive arquivar / planilha | drive.ts + services/driveArquivar.ts + clients/xlsx.ts | XRdAYO9d / aBXCqYHP | código pronto — **aguarda GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON(+_BASE64) e GOOGLE_DRIVE_ROOT_FOLDER_ID** | 2026-07-04 |
| **registro (finalizar/WF3)** | espelhoIntermitente.ts (`intermitente-finalizar`) — Histórico + Base de Desconto + espelho no Plano + subitems do split + PG | rlxTk4VZ | **código ✓ desde 31/08/2026** (`modo='escape'`) — revoga a decisão de 03/07 | 2026-08-31 |
| **pagamento pontual FIFO** | — | E1XAdr + subworkflows | **FICA no n8n** (decisão Isaac) | 2026-07-04 |
| **pagamento mensal** | consultas/mensal_run em mensal.ts/mensalRun.ts | krRj3 + subworkflows (Caju/RM/Integrar) | **FICA no n8n** (decisão Isaac) | 2026-07-04 |

## Flip (pós-deploy)

`pi.rotas_processo`: migration 013 semeia os 7 processos em `n8n`. Depois do
deploy + teste real, flipar pra `api` (código principal): `convocar`, `cancelar`,
`split`, `descontos`, `atestados` (lançar documentos), `pontofac`. `registro`
foi flipado para `escape` em **31/08/2026** (decisão do Isaac) — a automação Nexti do Controle
de Atestados continua no n8n.

O flip foi feito **sem** o teste comparativo de `teste-registro.md`: o motivo foi um defeito
visível em produção, não uma janela de teste. O que motivou está no §Flip de 31/08 abaixo.
Ação manual no flip: webhook create_item/ativar dos boards pro backend.

## Credenciais no backend (.env / Vercel)

- `MONDAY_TOKEN`, `RM_BRIDGE_URL`, `RM_AIONS_AUTH` — ok em prod.
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (ou `_BASE64`) + `GOOGLE_DRIVE_ROOT_FOLDER_ID` — **pendente (Isaac cria a service account e compartilha a pasta raiz).**

Regra de não-desconto (03/07/2026, Isaac): **DETRAN, TRE PB e SEDUC*** (prefixo)
declaram falta/atraso/atestado/PF mas desconto VR/VT = 0. **Cancelamento
total/parcial desconta SEMPRE** (`aplicarRegraNaoDesconta: false`). Fonte:
`domain/desconto.ts::naoDesconta`. Os WFs (reserva) ainda precisam do patch
`seduc_nao_desconta.cjs` (bloqueado por key n8n expirada — renovar).


## Flip de 31/08/2026 — por que o `registro` saiu do n8n

O que se via em produção, no caso do LUAN VICTOR (SEDUC INTERIOR, 31/08):

```
12:10  cancelamento | backend | 11 etapas, artefatos, desconto rastreado
12:18  registro     | app     | 0 etapas, resumo {"protocolo":..., "eh_correcao":false}
```

O `registro` era a ÚNICA ação sem rastro no `/atividade` — 78 execuções, todas com motor
`app`, nenhuma com etapa. Motivo: quem executava era o WF3, que não reporta nada; o front só
carimbava "voltou 200". O DP abre o `/atividade`, vê o cancelamento com 7/7 barras e o
lançamento da ocorrência como uma linha muda, e não tem como saber o que foi gravado.

Junto disso, o WF1 (que também sai do caminho com o flip) vinha criando **itens duplicados no
Histórico**: dois webhooks no board de Entrada disparam o mesmo gatilho — o
`change_specific_column_value` na coluna `ativar` e um `change_column_value` sem filtro
nenhum, que dispara em QUALQUER edição. 9 casos em 217 itens; o DP abria o gêmeo vazio e via
formulário sem as ocorrências que o board já mostrava.

`SET modo='escape' WHERE processo='registro'` em `pi.rotas_processo`.

Pendências que o flip NÃO resolve, e seguem abertas:

- apagar o webhook duplicado do board de Entrada (`change_column_value` sem `columnId`) e os
  equivalentes nos boards de meses anteriores;
- os gêmeos órfãos já criados continuam `Aguardando` no Histórico — marcar `Expirado`;
- as duas divergências conhecidas do §5 de `teste-registro.md` (`dias_perde_vr` fracionário e
  `ANOREF/MESREF` do sábado extra) continuam sem decisão escrita do DP.
