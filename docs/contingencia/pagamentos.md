# Runbook — Pagamentos com o n8n FORA (contingência)

> Premissa: n8n é o PRIMÁRIO dos pagamentos (pontual E1XAdrEbPy5lZhNS, mensal krRj3mXCM3F1CCYN).
> Este runbook cobre o n8n indisponível. **Nunca** flip automático em pagamento.
> Panorama rápido: `GET /api/contingencia/pagamentos` (sessão DP) — runs, residuais, concluídas.

## 1. n8n caiu NO MEIO de um pagamento mensal

1. **Ver onde parou:** tela /mensal mostra o run travado ("sem atualização há minutos");
   detalhe em `GET /api/mensal/run/<runId>` — contratos `ok` = pagos completos;
   `rodando`/`pendente` = incompletos.
2. **Checar o contrato "rodando" (pode ter pago parcialmente):**
   - **Caju:** procurar pedidos por nome determinístico
     `INTERMITENTE-MENSAL-<CONTRATO>-<mm>.<yy> 3 DIAS CREDITO` / `... BOLETO`
     no console (empresa.caju.com.br). Existe → crédito/boleto JÁ criados.
   - **RM:** conferir lançamentos de benefício da competência (ZMDHSTBENFUNC) por chapa;
     financeiro: IDFNANs gerados (FopRotinas) da seção do contrato.
   - **Board plan:** colunas CREDITO CAJU/VR-MENSAL preenchidas = contrato chegou ao write-back.
3. **Decisão por contrato incompleto:**
   - Nada no Caju → contrato NÃO foi pago: fica pendente pro retorno do n8n.
   - Caju criado mas RM não → completar manual o RM (lotes ≤50 via ponte AIONS) e
     registrar em `pi.efeitos_externos` (`chave='caju:pedido:<contrato>:<comp>'`,
     `tipo='caju_pix'`, `status='confirmado'`, `ref_externa=<orderId>`), pra o n8n
     NÃO recriar quando voltar (dedupe por solicitação também protege: só re-roda
     contrato SEM solicitação MENSAL processada).
4. **Quando o n8n voltar:** re-disparar a competência. O dedupe (solicitação MENSAL
   já processada por contrato) pula os contratos completos automaticamente.

## 2. Precisa PAGAR com o n8n fora (execução manual)

1. **Quanto pagar:** os valores vêm do board Valores + dias úteis — conferir a prévia da
   última execução boa OU calcular: VR/VT dia × dias úteis do período (contratos VR-mensal
   — DETRAN/TRE PB — usam valor mensal proporcional), menos FIFO dos residuais
   (`/api/contingencia/pagamentos` → `descontos_residuais_por_contrato`).
2. **Caju manual:** criar pedidos no console com os MESMOS nomes determinísticos
   (o padrão acima) — vira a chave de reconciliação.
3. **RM manual:** lançamentos por lote via console RM/ponte.
4. **Registrar TUDO em `pi.efeitos_externos`** (uma linha por efeito, chave natural).
   É o que impede o n8n de duplicar ao voltar.
5. **Abater FIFO:** atualizar `pi.descontos` (residual_vr/vt, descontado_vr/vt, status)
   dos itens consumidos.

## 3. Pontual com n8n fora

Convocação concluída sem pagamento: registrar a ocorrência normalmente (o espelho
`/api/intermitente-finalizar` funciona com flip `registro=api`); o PAGAMENTO pontual
fica pendente e roda quando o n8n voltar (o WF é disparado por criação de item —
recriar o gatilho = mover/recriar o item, ou disparar o webhook `intermitentes/pontual`
manualmente com o payload do item).

## 4. Reconciliação pós-contingência

1. `npm run importar:convocacoes` (board→PG).
2. Writes feitos SÓ no PG durante a janela (registro/cancelar/split via espelho):
   **replay manual no board** (lista = `pi.atividade`/`efeitos_externos` da janela).
3. Conferir webhooks do board (`query{ webhooks(board_id) }`) — duplicatas disparam 2×.
