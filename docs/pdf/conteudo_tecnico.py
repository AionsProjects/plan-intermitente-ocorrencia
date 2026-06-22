# -*- coding: utf-8 -*-
"""Conteudo do Manual Tecnico (mantenedor da automacao). Dict DOC."""

DOC_TECNICO = {
    "title": "Plano de Intermitentes — Manual Tecnico da Automacao",
    "version_line": "Para quem mantem a automacao · Contato Serviços · Versao 1.0 · Junho/2026 · Uso interno",
    "header": "Plano de Intermitentes — Manual Tecnico | Uso interno",
    "sections": [
        # 1
        {"n": "1", "title": "Visao geral e arquitetura", "blocks": [
            {"type": "p", "text": "O sistema gerencia convocações de intermitentes: cria a convocação, gera link de preenchimento, registra ocorrências (faltas/atrasos), aplica descontos de benefício (VR/VT), faz lançamento financeiro (RM/Caju) e arquiva documentos. São quatro camadas:"},
            {"type": "li", "text": "<b>Front (Vercel)</b> — aplicação React (SPA). As telas do DP. Conversa com o n8n (escritas/RM/Caju) e com o backend Vercel (leituras + registro de quadros)."},
            {"type": "li", "text": "<b>n8n</b> — orquestração. Cada fluxo (workflow) é disparado por <b>webhook</b> (do front ou do Monday) ou por <b>agendamento</b>. Faz a lógica e grava no Monday / chama RM, Caju, Drive."},
            {"type": "li", "text": "<b>Monday</b> — é o “banco de dados” de negócio (quadros/boards). O DP também edita à mão."},
            {"type": "li", "text": "<b>Backend Vercel</b> (auth-backend) — login/sessão + leituras + <b>registro de quadros</b> (Postgres). Resolve os IDs de colunas/grupos/quadro por mês, o que torna o sistema robusto à virada."},
            {"type": "p", "text": "Postgres (schema <b>pi</b>, cloudfy) guarda só autenticação, log de atividade e o registro de quadros. <b>Não</b> guarda dado de negócio (isso fica no Monday)."},
            {"type": "code", "text": "[ Front React/Vercel ]  --webhook-->  [ n8n (conectores + logica) ]  -->  [ Monday (boards) ]\n      (telas DP)                                                          + [ RM / Caju / Drive ]\n          |                                                                      \n          \\----- /api/* ----->  [ Backend Vercel ]  -->  [ Postgres pi ]\n                                  (auth, leituras, registry)"},
            {"type": "callout", "label": "Dois deploys", "text": "Convivem: <b>VM</b> (http://192.168.0.41:8081, antigo) e <b>Vercel</b> (produção, branch vercel-deploy). O n8n é compartilhado."},
        ]},
        # 2
        {"n": "2", "title": "Quadros (boards) do Monday", "blocks": [
            {"type": "p", "text": "Conta <b>contato-serv</b>, workspace DEPARTAMENTO PESSOAL (id 2739319)."},
            {"type": "table", "header": ["Quadro", "ID", "Funcao", "Virada"], "widths": [26, 20, 38, 16], "rows": [
                ["Entrada / Central", "18413180912 (jun) / 18418191275 (jul)", "Origem da convocação; a coluna <i>ativar</i> dispara o registro", "Duplica todo mês (ID muda)"],
                ["Histórico", "18411141462", "1 item por convocação: respostas, agregados, status", "Fixo"],
                ["Controle de Atestados", "18298015951", "Documental (1 item/atestado + arquivo)", "Fixo"],
                ["Base de Desconto", "18400981023", "Ledger financeiro (PENDENTE/PARCIAL/FINALIZADO)", "Fixo"],
                ["Valores (Parâmetros)", "18413870370", "VR/VT por contrato + função (diário e mensal)", "Fixo"],
                ["Feriados", "18415442661", "Feriados por contrato (NACIONAL/ESTADUAL/MUNICIPAL)", "Fixo"],
                ["Solicitação de Pagamento", "18393673859", "Pedidos de pagamento de benefício", "Fixo"],
                ["Controle Caju", "7833600425", "Débito/saldo Caju", "Fixo"],
            ]},
            {"type": "p", "text": "<b>Colunas-chave da Entrada</b> (IDs estáveis na duplicação): ativar (color_mm2pxmak), OP-Tipo Convocação (color_mkta71ex), Op-Contrato (color_mktcnxwn), Status Convocação (color_mm3a8ana), OP-Interior? (color__1), datas (date_mktayxhb / date_mktasnwq). Grupos: PONTUAL (group_mkta43yr), NÃO CONVOCADOS (group_mm2eqsdr), CANCELADOS (group_mkybnrd1), CANCELADOS PARCIAL (group_mm3hpa19)."},
        ]},
        # 3
        {"n": "3", "title": "Registro de quadros (Postgres pi)", "blocks": [
            {"type": "p", "text": "Tabelas: <b>pi.boards</b> (monday_board_id, competencia, papel = atual|proximo|passado), <b>pi.board_colunas</b> (titulo → column_id) e <b>pi.board_grupos</b> (titulo → group_id). Implementação em <i>auth-backend/src/routes/boards.ts</i>."},
            {"type": "table", "header": ["Endpoint", "O que faz", "Auth"], "widths": [30, 50, 20], "rows": [
                ["GET /api/boards/resolver", "Resolve um quadro por papel, competência ou board_id; retorna board_id + mapa coluna→id + grupo→id. É o que os WFs e o front consultam.", "Aberto (lookup)"],
                ["POST /api/boards/registrar", "Lê colunas+grupos do Monday e grava no registro.", "Admin ou Service-Token"],
                ["POST /api/boards/virada", "Transação da virada: atual→passado, cópia=atual, central=proximo. Aceita dry_run.", "Service-Token"],
                ["POST /api/boards/garantir-webhook", "Cria o webhook ativar no quadro, se não existir.", "Admin"],
            ]},
            {"type": "callout", "label": "Descoberta importante", "text": "A duplicação de quadro do Monday <b>preserva</b> os column_ids e group_ids. Comparando junho→julho: zero mudanças. Logo, na virada <b>só o board_id muda</b> — os WFs só precisam resolver o board_id dinâmico; colunas/grupos hardcoded continuam válidos nos quadros duplicados."},
        ]},
        # 4
        {"n": "4", "title": "Backend Vercel (auth-backend)", "blocks": [
            {"type": "p", "text": "Node + Fastify + Postgres, embrulhado em função serverless (api/index.ts). <b>Atenção:</b> o backend tem rotas de escrita (criar/finalizar/cancelar), mas hoje o front usa o <b>n8n</b> para escritas (foram revertidas por estabilidade). Na prática o backend serve <b>auth + leituras + registro</b>."},
            {"type": "table", "header": ["Categoria", "Rotas"], "widths": [26, 74], "rows": [
                ["Auth", "/auth/google/login · /auth/google/callback · /auth/me · /auth/logout · /auth/mudar-senha · /auth/completar-cadastro · /api/usuarios · /api/atividade"],
                ["Leituras (em uso)", "/api/convocar/opcoes · /api/intermitente/ler · /buscar-protocolo · /convocacoes-empregado · /interior · /api/feriados · /api/descontos/ler · /api/boards/*"],
                ["Escritas (dormentes)", "/api/convocar/criar · /api/intermitente/{finalizar,cancelar,aplicar-split} · /api/atestados/lancar · /api/descontos/registrar · /api/monday/ativar"],
            ]},
            {"type": "p", "text": "<b>/api/intermitente/interior?uuid=</b> → {interior} (coluna OP-Interior? OU contrato TRE PB/SEDUC INTERIOR). Usado pelo WF de Sábados Extras para definir mobilidade no Caju. <b>/api/convocar/opcoes</b> também devolve as unidades por contrato (do RM) e o column_id da unidade (do registro)."},
            {"type": "p", "text": "Variáveis de ambiente: MONDAY_TOKEN, VITE_N8N_BASE_URL, SERVICE_TOKEN (WF de virada → backend), N8N_WEBHOOK_BASE, PUBLIC_BASE_URL, DATABASE_URL."},
        ]},
        # 5 indice de WFs
        {"n": "5", "title": "Workflows n8n — indice", "blocks": [
            {"type": "p", "text": "n8n: aionscorp-n8n.cloudfy.live. Webhooks em .../webhook/&lt;path&gt;. As subseções seguintes detalham cada fluxo."},
            {"type": "table", "header": ["Workflow", "ID", "Gatilho", "Chamado por"], "widths": [30, 22, 26, 22], "rows": [
                ["1. Preparar", "rkIBahkH1h7cqnzE", "webhook Intermitentehaha (Monday: ativar)", "Monday"],
                ["2. Ler", "WHtIQDf8oOWinGyx", "webhook intermitente-ler", "/preencher"],
                ["3. Finalizar", "rlxTk4VZLM2gTzx7", "webhook intermitente-finalizar", "/preencher"],
                ["4. Buscar Protocolo", "m5GIJMo0ghgSGbh2", "webhook intermitente-buscar-protocolo", "/corrigir"],
                ["5. Pontual FIFO", "E1XAdrEbPy5lZhNS", "webhook intermitentes/pontual", "criar item / WF3"],
                ["6. Lançamento Financeiro", "NdUSkYcRT4DkKfzW", "sub-workflow (executeWorkflow)", "WF5 / Sábados"],
                ["7. Convocar", "dX8OZzxr6sh0Upug", "webhook intermitente-convocar", "/convocar"],
                ["8. Buscar Empregado RM", "Dt0p1T6OZECuXRiI", "webhook convocar-buscar-empregado", "/convocar, /atestados"],
                ["9. Opcoes (obsoleto)", "EImlFizH4jDgxW1Z", "webhook intermitente-convocar-opcoes", "legado (VM)"],
                ["Cancelar", "sbKoeewbkS7LNORH", "webhook intermitente-cancelar-convocacao", "/preencher"],
                ["Aplicar Split", "ZagUa2yuP6BsAE9i", "webhook intermitente-aplicar-split", "/preencher"],
                ["Buscar Convocações", "8l69E6Z9ouZAL027", "webhook intermitente-convocacoes-empregado", "/atestados"],
                ["Lançar Documentos", "kVpn69JFUJfR7T7U", "webhook intermitente-lancar-documentos", "/atestados"],
                ["Ponto-Fac Opcoes", "JXpJ6xuSZMcu2IVn", "webhook ponto-facultativo-opcoes", "/ponto-facultativo"],
                ["Ponto-Fac Preview", "7gHmbLcZ5r6D5sXz", "webhook ponto-facultativo-preview", "/ponto-facultativo"],
                ["Ponto-Fac Aplicar", "XybrfnzI11Fw5sX4", "webhook ponto-facultativo-aplicar", "/ponto-facultativo"],
                ["Unidades RM", "OggzTr5xRYc6s3NV", "webhook intermitente-unidades-rm", "opcoes, Ponto-Fac"],
                ["Drive Arquivar", "XRdAYO9dx2jSU8ps", "webhook drive-intermitente-arquivar", "WF5, WF7, Lançar Docs"],
                ["Gerar Planilha", "aBXCqYHPtZNjDMOM", "webhook gerar-planilha-conferencia", "Drive Arquivar"],
                ["Feriados", "QzZ02GGqjs9udBe2", "webhook intermitente-feriados", "front (calendários)"],
                ["Descontos — Gerar Link", "BCgD9f1b3tKebluP", "webhook descontos-gerar-link", "Monday Automation"],
                ["Descontos — Ler", "EXuqosXXOSQNlmqY", "webhook descontos-ler", "/descontos"],
                ["Descontos — Registrar", "sr4xxXLxmZ8EMURF", "webhook descontos-registrar-manual", "/descontos"],
                ["Sábados Extras", "3TAyDuKFkWGvXTHT", "webhook sabados-extras-boleto", "WF3"],
                ["Nexti Validar Atestado", "6efSZQYzLaP304rn", "webhook nexti-validar-atestado", "Monday Automation"],
                ["Virada (BENAUT)", "gm2Ie8pbR2rOK5id", "agendamento dia 14, 17h", "cron"],
            ]},
        ]},
        # 6 detalhe WFs principais
        {"n": "6", "title": "Workflows — detalhe e como replicar", "blocks": [
            {"type": "h2", "text": "WF1 — Preparar (ativar → link)"},
            {"type": "p", "text": "<b>Gatilho:</b> webhook do Monday quando a coluna ativar (color_mm2pxmak) muda. <b>Faz:</b> lê o item de origem na Entrada (nome, contrato, datas, chapa), gera UUID + protocolo, cria 1 item no Histórico e grava o link /preencher/&lt;uuid&gt; na Entrada. Tem nó “Resolver Contexto Board” (usa event.boardId), portanto é robusto à virada. <b>Ligação com o front:</b> o link gravado abre a tela /preencher."},
            {"type": "callout", "label": "Replicar", "text": "Webhook genérico (não Monday Trigger) com path fixo. O gatilho no Monday é um webhook de API (change_specific_column_value em color_mm2pxmak) → URL .../webhook/Intermitentehaha. Anti-duplicação no nó “Checar conflito”."},

            {"type": "h2", "text": "WF2 — Ler"},
            {"type": "p", "text": "<b>Gatilho:</b> GET intermitente-ler?uuid=. <b>Faz:</b> busca o item no Histórico por UUID e devolve dados + respostas + atestados + status de cancelamento. <b>Ligação:</b> a tela /preencher chama no carregamento. Só lê o Histórico (quadro fixo) → não quebra na virada."},

            {"type": "h2", "text": "WF3 — Finalizar"},
            {"type": "p", "text": "<b>Gatilho:</b> POST intermitente-finalizar. <b>Faz:</b> agrega faltas/atrasos, grava respostas e agregados no Histórico, cria/atualiza o desconto na Base de Desconto, espelha no item da Entrada e dispara o boleto de sábados extras. <b>Idempotente</b> (1 item, change_multiple_column_values). O quadro da Entrada vem do item_origem (link do Histórico) → dinâmico."},
            {"type": "callout", "label": "Regra de desconto", "text": "DETRAN e TRE PB <b>não descontam</b> por falta/atestado (nó “Decidir Desconto”, lista __naoDesconta zera VR/VT). Feriado por contrato é considerado no cálculo."},

            {"type": "h2", "text": "WF5 — Pontual FIFO"},
            {"type": "p", "text": "<b>Gatilho:</b> webhook intermitentes/pontual (create_item da Entrada). <b>Faz:</b> calcula o benefício do período (quadro Valores), abate descontos pendentes por ordem (FIFO) na Base de Desconto, gera o pedido na Caju (crédito FOOD_AID + VT), chama o WF6 (SOAP RM, devolve idVR/idVT), cria a Solicitação de Pagamento, espelha valores no item e dispara o Drive Arquivar. <b>Ligação:</b> roda quando um item é criado/ativado."},
            {"type": "callout", "label": "Mobilidade / VR corrido", "text": "Caju: VR=FOOD_AID; VT normal=TRANSPORTATION_VOUCHER; mobilidade (interior)=TRANSPORTATION. Para DETRAN e TRE PB o VR conta dias corridos (sábado e domingo)."},

            {"type": "h2", "text": "WF6 — Lançamento Financeiro (SOAP RM)"},
            {"type": "p", "text": "<b>Gatilho:</b> sub-workflow (executeWorkflow) chamado pelo WF5 e pelo Sábados. <b>Faz:</b> SOAP no RM (FopRotinas) por evento (100=VR, 110=VT) e devolve os IDs financeiros (idVR/idVT). Não toca Monday — só RM."},

            {"type": "h2", "text": "WF7 — Convocar"},
            {"type": "p", "text": "<b>Gatilho:</b> POST intermitente-convocar (multipart). <b>Faz:</b> trava antifraude de período (busca conflitos por chapa) e cria o item na Entrada (grupo PONTUAL) + upload dos termos. <b>Resolve o quadro/grupo/colunas via registro</b> (nó “Resolver Board”, papel atual|proximo) — totalmente dinâmico à virada. <b>Ligação:</b> chamado pela tela /convocar (etapa de mês escolhe o papel)."},

            {"type": "h2", "text": "WF8 — Buscar Empregado RM"},
            {"type": "p", "text": "<b>Gatilho:</b> GET convocar-buscar-empregado?nome=. <b>Faz:</b> consulta SQL no RM (BEN 2) por nome e devolve nome/chapa/função/admissão/seção. <b>Depende do RM</b> (cred rm mike). Usado por /convocar e /atestados."},

            {"type": "h2", "text": "Cancelar"},
            {"type": "p", "text": "<b>Gatilho:</b> POST intermitente-cancelar-convocacao. <b>Faz:</b> ajusta Status Convocação (total/parcial), grava data de cancelamento, atualiza o Histórico, gera o desconto e <b>move o item para o grupo</b> CANCELADOS / CANCELADOS PARCIAL. O grupo é resolvido por título via registro (group_id é volátil). O quadro da Entrada vem do item_origem."},
            {"type": "callout", "label": "Atenção", "text": "Cancelamento <b>desconta</b> (inclusive DETRAN/TRE PB) — diferente de Finalizar/Ponto-Fac."},

            {"type": "h2", "text": "Ponto Facultativo (Opcoes / Preview / Aplicar)"},
            {"type": "p", "text": "<b>Opcoes</b>: unidades por contrato + contagem de convocados (quadro atual via registro). <b>Preview</b>: calcula afetados e valores por contrato/unidades/data, sem gravar. <b>Aplicar</b>: recalcula e grava o ledger + Base de Desconto. Os três resolvem o quadro atual pelo registro; aceitam <b>lista de unidades</b> (multi-seleção). DETRAN/TRE PB com valor zero."},

            {"type": "h2", "text": "Drive Arquivar + Gerar Planilha"},
            {"type": "p", "text": "<b>Drive Arquivar</b> (drive-intermitente-arquivar): cria/reaproveita as pastas no Drive, sobe boleto/comprovante da Caju e, quando pedido, dispara a <b>Gerar Planilha</b> (gerar-planilha-conferencia), que monta um XLSX com todas as colunas do quadro (do item) na pasta CONFERENCIA. Quadro resolvido via registro."},

            {"type": "h2", "text": "Demais (auxiliares)"},
            {"type": "p", "text": "<b>WF4 Buscar Protocolo</b>: protocolo→UUID (/corrigir). <b>Aplicar Split</b>: grava o Split JSON no Histórico. <b>Buscar Convocações</b>: convocações do empregado no mês (/atestados). <b>Lançar Documentos</b>: cria item no Controle de Atestados + arquivo. <b>Unidades RM</b>: unidades por contrato (SQL RM). <b>Feriados</b>: lê o quadro Feriados. <b>Descontos (Gerar Link/Ler/Registrar)</b>: retirada manual da Caju. <b>Sábados Extras</b>: boleto VT de sábado (mobilidade via /api/intermitente/interior). <b>Nexti Validar Atestado</b>: valida atestado contra o Nexti (disparado por automação nativa do Monday). <b>WF9 Opcoes</b>: <b>obsoleto</b> (substituído por /api/convocar/opcoes; ainda aponta o quadro de maio)."},
        ]},
        # 7 fluxos
        {"n": "7", "title": "Fluxos de ponta a ponta", "blocks": [
            {"type": "h2", "text": "Convocar → Registrar → Finalizar"},
            {"type": "code", "text": "/convocar -> WF8 (busca RM) -> WF7 (cria item na Entrada, grupo PONTUAL, resolve quadro via registro)\n  -> DP muda a coluna 'ativar' no Monday -> WF1 (cria Historico + link /preencher)\n  -> RH abre o link -> /preencher -> WF2 (le) -> WF3 (finaliza: desconto + agregados)"},
            {"type": "h2", "text": "Pontual / financeiro"},
            {"type": "code", "text": "WF5 Pontual: calcula VR/VT (quadro Valores) -> abate FIFO (Base de Desconto)\n  -> Caju (credito + VT) -> WF6 (SOAP RM, idVR/idVT) -> Solicitacao de Pagamento\n  -> espelha no item -> Drive Arquivar -> Gerar Planilha"},
            {"type": "p", "text": "<b>Ponto facultativo:</b> Opcoes → multi-seleção + Prosseguir → Preview → Aplicar (ledger). <b>Cancelar:</b> WF Cancelar → status + desconto + move para o grupo."},
        ]},
        # 8 virada
        {"n": "8", "title": "Virada de mes (WF BENAUT, dia 14 17h)", "blocks": [
            {"type": "p", "text": "Modelo “central fixo”: existe um quadro central (18418191275) que avança de mês. A cada virada o WF de agendamento faz, em ordem:"},
            {"type": "li", "text": "<b>Duplica</b> o central → uma <b>cópia</b> (snapshot do mês corrente)."},
            {"type": "li", "text": "<b>Cria os webhooks na cópia</b> (ativar→WF1, create_item→WF5). O Monday <b>não</b> copia webhooks de API na duplicação, então o WF recria via create_webhook."},
            {"type": "li", "text": "<b>Arquiva</b> os itens do central, <b>renomeia</b> e <b>repovoa</b> com colaboradores frescos do RM (TOTVS → grupo NÃO CONVOCADOS)."},
            {"type": "li", "text": "<b>Salva no registro</b> (POST /api/boards/virada, header Service-Token): atual→passado, cópia=atual, central=proximo."},
            {"type": "p", "text": "<b>Papéis</b> (3 quadros vivos): passado (mês fechado), atual (a cópia, convocações vivas) e proximo (o central, futuro). Convocação funciona em atual + proximo."},
            {"type": "callout", "label": "Estado / cuidado", "text": "Testado de ponta a ponta em quadro de teste isolado: duplicar, criar webhook via automação, arquivar/renomear, salvar registro e despromoção de papéis (SQL) — todos OK. O nó TOTVS (RM) tem <b>Retry on Fail</b> ligado (timeout transitório). A duplicação/criação de quadro exige a credencial n8n “api monday - Isaac” (o MONDAY_TOKEN de leitura não tem permissão)."},
        ]},
        # 9 regras
        {"n": "9", "title": "Regras de negocio", "blocks": [
            {"type": "li", "text": "<b>VR/VT</b> vêm do quadro Valores (18413870370) por contrato + função. Prioridade: VR Mensal (÷ 30 = diário) > VR Diário > PADRÃO. VT é sempre diário/unitário."},
            {"type": "li", "text": "<b>Caju</b>: VR = FOOD_AID; VT normal = TRANSPORTATION_VOUCHER; mobilidade = TRANSPORTATION (a categoria MOBILITY não existe)."},
            {"type": "li", "text": "<b>Mobilidade (interior)</b> = coluna OP-Interior? = SIM OU contrato TRE PB / SEDUC INTERIOR (sempre interior)."},
            {"type": "li", "text": "<b>VR em dias corridos</b> (sábado + domingo) para DETRAN e TRE PB (VR mensal cobre o mês cheio). Só o VR; o VT segue dias úteis (+ sábado se trabalha)."},
            {"type": "li", "text": "<b>DETRAN e TRE PB não descontam</b> por falta/atestado (Finalizar e Ponto Facultativo). <b>Cancelamento desconta</b> normalmente (inclusive eles)."},
            {"type": "li", "text": "<b>Feriado por contrato</b>: NACIONAL bloqueia todos; ESTADUAL/MUNICIPAL só os do contrato; SEDUC* e DETRAN recebem em feriado (não bloqueiam)."},
        ]},
        # 10 credenciais
        {"n": "10", "title": "Credenciais e seguranca", "blocks": [
            {"type": "table", "header": ["Item", "Onde", "Uso"], "widths": [26, 34, 40], "rows": [
                ["Monday “Ray0”", "cred n8n", "Token padrão dos WFs do Monday"],
                ["Monday “api monday - Isaac”", "cred n8n", "Duplicar/criar/excluir quadro (virada) — precisa permissão"],
                ["RM “rm mike”", "cred n8n", "SQL e SOAP no RM TOTVS"],
                ["MONDAY_TOKEN", "env Vercel", "Leitura Monday + registro de quadros"],
                ["SERVICE_TOKEN", "env Vercel + WF virada", "WF de virada chamar /api/boards/virada"],
            ]},
            {"type": "callout", "label": "Risco alto", "text": "Segredos colados em chat (token Monday, chave da API n8n, senha do Postgres, SERVICE_TOKEN) devem ser <b>rotacionados</b> — o repositório é público."},
        ]},
        # 11 como replicar do zero
        {"n": "11", "title": "Como replicar um workflow do zero", "blocks": [
            {"type": "p", "text": "Padrão geral para recriar/portar um WF que toca a Entrada (robusto à virada):"},
            {"type": "li", "text": "<b>Trigger</b>: Webhook (path fixo) para chamadas do front/Monday, ou Schedule para rotinas. O Monday aponta via create_webhook (não usa Monday Trigger)."},
            {"type": "li", "text": "<b>Resolver o quadro</b>: adicione um nó HTTP “Resolver Board” chamando GET /api/boards/resolver (por papel quando “o mês corrente”, ou por board_id quando vem do event/item). Um nó <b>Code</b> não faz HTTP (sandbox) — sempre use um nó HTTP separado e leia com $('Resolver Board')."},
            {"type": "li", "text": "<b>Usar IDs do registro</b>: troque board_id e group_id fixos por $('Resolver Board').first().json.board_id / .grupos['TÍTULO']. Colunas hardcoded continuam válidas (a duplicação preserva)."},
            {"type": "li", "text": "<b>Responder</b>: em webhook, garanta o nó “Respond to Webhook” (senão responde vazio)."},
            {"type": "li", "text": "<b>Backup antes de editar</b>: exporte o JSON do WF. Reimport perde credenciais (reassociar Ray0 / rm mike)."},
            {"type": "callout", "label": "Notas do n8n", "text": "Code node não tem crypto (UUID manual via Math.random). Resposta de array do RM vira N itens — use $input.all(). A API pública do n8n no PUT só aceita settings {executionOrder}."},
        ]},
        # 12 troubleshooting
        {"n": "12", "title": "Troubleshooting", "blocks": [
            {"type": "li", "text": "<b>WF1 não gera link</b> ao mudar ativar → verifique se o webhook ativar existe no quadro (change_specific_column_value em color_mm2pxmak → /webhook/Intermitentehaha). Recrie via /api/boards/garantir-webhook ou create_webhook."},
            {"type": "li", "text": "<b>Virada para no TOTVS</b> (timeout RM) → o nó “Consultar colaboradores TOTVS” tem Retry on Fail (3×, 5s). Se persistir, RM indisponível."},
            {"type": "li", "text": "<b>Cópia da virada sem webhook</b> → o WF de virada recria; se faltar, rode create_webhook na cópia (precisa cred Isaac)."},
            {"type": "li", "text": "<b>Convocar/Ponto-Fac no quadro errado após a virada</b> → confira /api/boards/resolver?papel=atual; re-registre se preciso."},
        ]},
    ],
}
