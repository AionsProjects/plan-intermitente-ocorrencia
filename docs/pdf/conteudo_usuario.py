# -*- coding: utf-8 -*-
"""Conteudo do Guia do Usuario (DP). Dict DOC -> renderer gerar_doc_pdf.py."""

DOC_USUARIO = {
    "title": "Plano de Intermitentes — Guia do Usuario",
    "version_line": "Departamento Pessoal · Contato Serviços · Versao 1.0 · Junho/2026",
    "header": "Plano de Intermitentes — Guia do Usuario",
    "sections": [
        {"n": "1", "title": "Acesso ao sistema", "blocks": [
            {"type": "p", "text": "O sistema fica em <b>plan-intermitente-ocorrencia.vercel.app</b>. O acesso é feito com sua conta Google da empresa (<b>@contatoserv.com.br</b>). No primeiro acesso você completa um cadastro rápido (nome, sobrenome, CPF e função: RH ou Operacional)."},
            {"type": "p", "text": "Após entrar, a tela inicial (Hub) mostra os atalhos disponíveis para o seu perfil."},
            {"type": "callout", "label": "Quem vê o quê", "text": "O atalho <b>Ponto facultativo</b> aparece somente para DP e Administradores. Convocar, Atestados e Atualizar ocorrência aparecem para todos. As telas de <b>Registrar ocorrência</b> e <b>Descontos</b> são abertas por um link (não têm atalho no Hub)."},
            {"type": "table", "header": ["Atalho no Hub", "Para que serve", "Perfil"], "widths": [30, 50, 20], "rows": [
                ["Nova convocação", "Criar uma convocação de intermitente", "Todos"],
                ["Atestados e declarações", "Lançar atestado / declaração com arquivo", "Todos"],
                ["Atualizar ocorrência", "Corrigir um registro pelo protocolo", "Todos"],
                ["Ponto facultativo", "Desconto em massa por unidade/data", "DP / Admin"],
            ]},
        ]},
        {"n": "2", "title": "Convocar um intermitente", "blocks": [
            {"type": "p", "text": "No Hub, clique em <b>Nova convocação</b> e siga as etapas:"},
            {"type": "li", "text": "<b>Buscar empregado</b> — digite o nome (mínimo 3 letras). A lista vem do RM. Selecione a pessoa."},
            {"type": "li", "text": "<b>Escolher o mês</b> — <i>Mês atual</i> ou <i>Próximo mês</i> (só aparecem os meses disponíveis)."},
            {"type": "li", "text": "<b>Formulário</b> — preencha solicitante, contrato, unidade (a lista é filtrada pelo contrato), datas de início e fim, sábado, insalubridade, interior e justificativa. Anexe os termos (convocação / insalubridade) se houver."},
            {"type": "li", "text": "<b>Convocar</b> — cria o item no quadro do mês (grupo PONTUAL)."},
            {"type": "callout", "label": "Trava de segurança", "text": "Se já existir uma convocação da mesma pessoa no período, o sistema bloqueia e mostra o conflito — evita convocação duplicada."},
            {"type": "p", "text": "A admissão e os valores de benefício vêm do RM automaticamente."},
        ]},
        {"n": "3", "title": "Gerar o link de preenchimento (ativar)", "blocks": [
            {"type": "p", "text": "No quadro do Monday, no item da convocação, mude a coluna <b>“ativar”</b> para <b>ativar</b>. O sistema cria o registro no Histórico e grava o <b>link</b> de preenchimento (coluna <i>Link</i>) no próprio item."},
            {"type": "p", "text": "Esse link é o que o RH/operador usa para registrar as ocorrências do período."},
        ]},
        {"n": "4", "title": "Registrar ocorrência", "blocks": [
            {"type": "p", "text": "Abra o <b>link</b> (/preencher). O painel mostra um cartão por dia, com perguntas no positivo:"},
            {"type": "li", "text": "<b>Foi trabalhar?</b> / <b>Chegou no horário?</b> (se atrasou, informe os minutos)."},
            {"type": "li", "text": "<b>Adicionar dias</b> extras ou <b>remover</b> dias quando necessário."},
            {"type": "li", "text": "<b>Sábados extras</b> (botão azul, aparece quando a convocação não trabalha sábado) — selecione os sábados; gera o vale-transporte extra ao finalizar."},
            {"type": "p", "text": "Ao terminar, clique em <b>Finalizar</b>. O sistema gera um <b>protocolo</b> (PROT-XXXX-XXXX) e aplica o desconto de benefício conforme faltas/atrasos."},
        ]},
        {"n": "5", "title": "Corrigir um registro", "blocks": [
            {"type": "p", "text": "No Hub, clique em <b>Atualizar ocorrência</b>, digite o protocolo <b>PROT-XXXX-XXXX</b> e o preenchimento reabre com as respostas anteriores. Ao salvar, o registro é marcado como editado (não duplica)."},
        ]},
        {"n": "6", "title": "Cancelar convocação", "blocks": [
            {"type": "p", "text": "Na tela de preenchimento, use o ícone de cancelar:"},
            {"type": "li", "text": "<b>Total</b> — cancela tudo e finaliza a convocação."},
            {"type": "li", "text": "<b>Parcial</b> — escolha a data de início do cancelamento; <b>não</b> finaliza (o painel continua aberto para lançar os dias não-cancelados)."},
            {"type": "p", "text": "O item é movido automaticamente para o grupo CANCELADOS (total) ou CANCELADOS PARCIAL (parcial), e o desconto dos dias cancelados é gerado."},
            {"type": "callout", "label": "Atenção", "text": "O cancelamento <b>desconta</b> o benefício dos dias cancelados — inclusive para DETRAN e TRE PB."},
        ]},
        {"n": "7", "title": "Ponto facultativo (desconto em massa)", "blocks": [
            {"type": "p", "text": "No Hub (somente DP), clique em <b>Ponto facultativo</b>:"},
            {"type": "li", "text": "Escolha o <b>contrato</b>."},
            {"type": "li", "text": "<b>Marque várias unidades</b> (clique em cada uma) — ou use <b>“Selecionar tudo”</b> (marca todas as que têm convocados)."},
            {"type": "li", "text": "Clique em <b>Prosseguir</b>, escolha a <b>data</b> e os <b>benefícios</b> (VR e/ou VT)."},
            {"type": "li", "text": "Clique em <b>Pré-visualizar</b> para ver todos os afetados e o total; depois <b>Confirmar</b> aplica o desconto."},
            {"type": "callout", "label": "Regra", "text": "DETRAN e TRE PB <b>não sofrem desconto</b> no ponto facultativo (aparecem na lista, mas com valor zero)."},
        ]},
        {"n": "8", "title": "Atestados e declarações", "blocks": [
            {"type": "p", "text": "No Hub, clique em <b>Atestados</b>:"},
            {"type": "li", "text": "Escolha <b>Intermitente</b> ou <b>CLT</b> (ambos buscam no RM por nome/matrícula)."},
            {"type": "li", "text": "Selecione a convocação/colaborador e preencha (tipo de documento, datas, turno, upload do arquivo)."},
            {"type": "li", "text": "Você pode <b>acumular vários</b> documentos na sessão (botão “Resumo (N)”) e depois <b>Concluir</b> para enviar todos de uma vez."},
            {"type": "p", "text": "Cada documento vira um item no quadro Controle de Atestados, com o arquivo anexado."},
        ]},
        {"n": "9", "title": "Descontos manuais (retirada Caju)", "blocks": [
            {"type": "p", "text": "O link de desconto manual é gerado no quadro de Desconto. Ao abrir (/descontos), informe o <b>VR retirado</b> e o <b>VT retirado</b> e confirme. O sistema registra a retirada no item."},
        ]},
        {"n": "10", "title": "Virada de mês", "blocks": [
            {"type": "p", "text": "Todo dia <b>14</b> o sistema (quando o agendamento estiver ligado) prepara o mês seguinte: arquiva o mês que passou e cria o quadro do próximo mês, já com os intermitentes vindos do RM."},
            {"type": "p", "text": "Você pode <b>convocar tanto no mês atual quanto no próximo</b>. Os gatilhos (a coluna <i>ativar</i>) são recriados automaticamente — nada a fazer manualmente."},
            {"type": "callout", "label": "Se algo parecer errado", "text": "Se após a virada uma convocação aparecer no quadro errado, avise o responsável técnico (pode ser preciso conferir o registro de quadros)."},
        ]},
    ],
}
