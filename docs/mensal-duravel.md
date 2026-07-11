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

## Ativação segura

1. Aplicar a migration `014_mensal_duravel.sql`.
2. Configurar `CRON_SECRET` e manter as três travas mensais nos valores seguros acima.
3. Executar uma prévia e comparar o snapshot com o n8n sem aprovar produção.
4. Definir `MENSAL_WORKFLOW_ENABLED=1`, ainda em homologação, e validar um contrato de teste.
5. Implementar e validar cada adaptador externo antes de habilitar produção. O executor bloqueia
   produção deliberadamente enquanto esses adaptadores não estiverem concluídos.

O documento `docs/n8n/wf-mensal-fifo.md` descreve o legado e não é a fonte de verdade do fluxo novo.
