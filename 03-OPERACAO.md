# 🛠️ Operação & Manutenção — Intermitentes

> Para quem **mantém** o sistema: estado atual, fixes, pendências, armadilhas e diagnóstico. Guia de uso (o que o DP/Operacional faz) → **Guia DP & OP**. Arquitetura/plataforma → **Visão & Plataforma**. Mapa dos WFs → **Automações**.

## 1. Fixes aplicados (22–24/06/2026)
- **Ponte RM** offline por conflito de porta (motor-fiscal tomou a 8000 → AIONS em crash-loop `WinError 10048` → 404 em todo RM). **Fix:** AIONS movida pra **porta exclusiva 8077** (`AIONS-API.xml` + `AIONS-NGROK.xml`), serviços reiniciados. **ONLINE** (`/health` ok).
- **Lançamento "1 pessoa só"** (idVR/idVT com valor de 1): era `chapaPivot=chapas[0]` no `<Chapa>` do SOAP. **Fix:** `chapasXmlSelecao` = todas as chapas (bph9/KxysR).
- **Mobilidade × VT:** regra casava código exato; **fix:** por contrato base (TRE PB `79`, Barco `15`, SEDUC INTERIOR `11.02`) + coluna `Interior?`.
- **Data Vencimento** vinha = emissão; **fix:** vem da planilha (cél. A2 `cod - NOME - DD/MM/YYYY`); AppScript manda `data_vencimento`.
- **RM caía em folha grande:** envio em **lotes** (SplitInBatches 50 + retry); o lançamento lê todos (`Definir Benefícios.all()`), não o lote.
- **Drive não anexava:** 3 bugs (state-overwrite do Resolver Board · binary `file0`→`data` · upload via nó nativo Google Drive + retry 5×). **Anexa certo.**
- **Pontual não disparava** (webhook sumiu): recriado `create_item` nos boards junho (#598984491) e julho (#598984508); boleto QR com retry (Wait 10s + re-GET).
- **bph9 paired-item error** no node final: `.item` → `.first()` em `Coletar Resultado`.

## 2. Pendências / próximos passos
1. **DETRAN 87792:** Caju pagou **R$ 114.882 (199 pessoas)** mas o RM não recebeu (caiu na ponte morta). **Completar só o RM** rodando a partir do `Gerar XMLs RM Mensal` (Code node) — **sem re-Caju**.
2. **Mensal Intermitente (migração `krRj3`/`KxysR`)**: falta trigger web + frontend pra rodar E2E (board dinâmico + adaptador já feitos, OFF).
3. **Rotacionar segredos** expostos (Postgres pw, RM, API_KEYS AIONS, Monday token, n8n key).
4. **Publicar AppScript corrigido** (manda `data_vencimento`, limpa nome do contrato).
5. Incluir o webhook pontual no `garantir-webhook`/virada (senão some na virada).

## 3. ⚠️ Armadilhas (não repetir)
- **Salvar WF no editor n8n com canvas DESATUALIZADO sobrescreve mudanças feitas via API E perde credenciais** (aconteceu no rY4 24/06 — perdeu loop+mobilidade+credencial Monday). **Dê refresh antes de editar.**
- **ngrok-free derruba volume** → RM sempre em lotes (SplitInBatches).
- **Boleto vazio** = `pixCode.encodedImage` é assíncrono no Caju → precisa retry no GET.
- **Re-rodar WF de pagamento pelo trigger duplica Caju** (PIX real). Pra completar só o RM, rode a partir do Code node.

## 4. Diagnóstico rápido
- **RM 404 / connection-closed** → `GET .../health` deve dar `status:ok`; senão, conflito de porta na VM (Visão §7).
- **Board errado após virada** → `GET .../api/boards/resolver?papel=atual` aponta o board certo? Re-registrar se não.
- **WF1 não gera link** → conferir webhook `ativar` (`color_mm2pxmak`) no board → `/webhook/Intermitentehaha`.
- **Execuções/erros** → n8n `/api/v1/executions?workflowId=<id>` (precisa key válida).

## 5. Manutenção dos docs
- Re-minerar grafo dos WFs: `node plano-intermitentes/.wfmine/analyze.cjs`. Regenerar o HTML: `node plano-intermitentes/scripts/gen_docs_html.cjs`.
- Backups de WF: `plano-intermitentes/wf_*.backup-*.json`.
