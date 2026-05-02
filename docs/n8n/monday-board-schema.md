# Schema do board Monday — `Plan. de Intermitentes — Histórico de Ocorrências`

Substitui o schema Supabase (`processamentos` + `ocorrencias_dia`).
**1 item por convocação.** O detalhe dia-a-dia mora em `respostas_json`.

## Identificação

- **Board ID**: `18411141462`
- **URL**: https://contato-serv.monday.com/boards/18411141462
- **Workspace**: `DEPARTAMENTO PESSOAL` (`2739319`)
- **Tipo**: `share` (igual aos boards mensais existentes)
- **Owner**: João Gabriel Souza Santos (`joao.santos@contatoserv.com.br`)

## Mapa de colunas

| Título | Column ID | Tipo | Origem do valor |
|---|---|---|---|
| Name | `name` | `name` | Nome do intermitente (vindo do board origem) |
| UUID | `text_mm2xjend` | `text` | Gerado pelo WF1 — chave do link `/preencher/<uuid>` |
| Protocolo | `text_mm2xsvg6` | `text` | `PROT-XXXX-XXXX` gerado pelo frontend ao finalizar |
| Contrato | `text_mm2x1ktb` | `text` | Copiado do board origem |
| Solicitante | `text_mm2xxkm8` | `text` | Nome do disparador do WF1 (RH/gestor) |
| Data Início | `date_mm2xtp93` | `date` | Início do período da convocação |
| Data Fim | `date_mm2xrr5q` | `date` | Fim do período |
| Expira Em | `date_mm2xrvt4` | `date` | `criado_em + 30 dias` |
| Criado Em | `date_mm2x115h` | `date` | Timestamp de criação |
| Concluído Em | `date_mm2xh1vm` | `date` | Timestamp de finalização |
| Editado Em | `date_mm2x62fq` | `date` | Timestamp da última edição via correção |
| Status | `color_mm2xkqpc` | `status` | Aguardando / Concluído / Expirado (ver IDs abaixo) |
| Editado | `boolean_mm2x1aa4` | `checkbox` | Marcado quando alterado pós-finalização |
| Qtd. Faltas | `numeric_mm2xe2zk` | `numbers` | Agregado: `respostas.filter(r=>r.tipo==='falta').length` |
| Qtd. Atrasos | `numeric_mm2x18hh` | `numbers` | Agregado: `respostas.filter(r=>r.tipo==='atraso').length` |
| Total Minutos Atraso | `numeric_mm2x4fjj` | `numbers` | Agregado: soma dos `minutos_atraso` |
| Dias Extras | `long_text_mm2x73w6` | `long_text` | JSON: array de `YYYY-MM-DD` adicionados fora do período |
| Dias Desativados | `long_text_mm2xm820` | `long_text` | JSON: array de `YYYY-MM-DD` apagados pelo RH |
| Respostas JSON | `long_text_mm2xtcpw` | `long_text` | JSON detalhado: `[{data, tipo, minutos_atraso}]` |
| Item Origem | `link_mm2x1rk0` | `link` | URL do item no board mensal de origem |
| Link Preencher | `link_mm2xfay7` | `link` | `https://<dominio>/preencher/<uuid>` |

## Status — IDs reais

Atenção: monday atribuiu IDs internos próprios (não bateram com `index`).

| Label | ID interno | Cor |
|---|---|---|
| Aguardando | `0` | working_orange (#fdab3d) |
| Concluído | `1` | done_green (#00c875) — flag `is_done=true` |
| Expirado | `17` | american_gray (#757575) |

Para `change_column_value` com status, use `{"label": "Aguardando"}` ou `{"index": 0}`. Para expirado: `{"label": "Expirado"}` ou `{"index": 17}` (note: index=17, não 2).

## Formato de payloads para mutations

### `create_item` (WF1)

```graphql
mutation {
  create_item(
    board_id: 18411141462,
    group_id: "topics",
    item_name: "<NOME_DO_INTERMITENTE>",
    column_values: "<JSON_STRING>"
  ) { id }
}
```

`column_values` (JSON string serializada):

```json
{
  "text_mm2xjend": "<uuid>",
  "text_mm2x1ktb": "<contrato>",
  "text_mm2xxkm8": "<solicitante>",
  "date_mm2xtp93": {"date": "2026-04-15"},
  "date_mm2xrr5q": {"date": "2026-04-21"},
  "date_mm2xrvt4": {"date": "2026-05-15"},
  "date_mm2x115h": {"date": "2026-04-15", "time": "09:30:00"},
  "color_mm2xkqpc": {"label": "Aguardando"},
  "link_mm2x1rk0": {"url": "https://contato-serv.monday.com/boards/<id>/pulses/<id>", "text": "Item origem"},
  "link_mm2xfay7": {"url": "https://<dominio>/preencher/<uuid>", "text": "Preencher"}
}
```

### `change_multiple_column_values` (WF3 — finalizar)

Idempotente; pode ser chamado N vezes com o mesmo payload.

```json
{
  "color_mm2xkqpc": {"label": "Concluído"},
  "date_mm2xh1vm": {"date": "2026-04-22", "time": "10:15:00"},
  "text_mm2xsvg6": "PROT-K7M2-9XPB",
  "boolean_mm2x1aa4": {"checked": "true"},
  "date_mm2x62fq": {"date": "2026-04-22", "time": "10:15:00"},
  "numeric_mm2xe2zk": "1",
  "numeric_mm2x18hh": "2",
  "numeric_mm2x4fjj": "70",
  "long_text_mm2x73w6": {"text": "[\"2026-04-23\"]"},
  "long_text_mm2xm820": {"text": "[]"},
  "long_text_mm2xtcpw": {"text": "[{\"data\":\"2026-04-15\",\"tipo\":\"sem_ocorrencia\"},...]"}
}
```

### Buscar por UUID (WF2) ou Protocolo (WF4)

```graphql
query ($boardId: ID!, $columnId: String!, $value: String!) {
  items_page_by_column_values(
    board_id: $boardId,
    columns: [{ column_id: $columnId, column_values: [$value] }],
    limit: 1
  ) {
    items {
      id
      name
      column_values {
        id
        text
        value
        ... on StatusValue { label index }
        ... on DateValue { date time }
        ... on CheckboxValue { checked }
      }
    }
  }
}
```

- WF2: `column_id = "text_mm2xjend"` (UUID)
- WF4: `column_id = "text_mm2xsvg6"` (Protocolo)

## Regras de negócio mantidas

- Expiração: 30 dias após `criado_em` → atualizar `Status` para `Expirado`. Pode rodar como n8n cron diário ou monday Automation.
- Idempotência do WF3: `change_multiple_column_values` no item identificado por UUID. Sem `DELETE WHERE` necessário (ao contrário do Supabase).
- Soft-delete de dias: `Dias Desativados` mantém histórico. Para reativar, basta o frontend remover da lista no payload de finalização.

## Observações operacionais

- **Long Text** suporta ~2000 chars por padrão. Para 30 dias × ~80 bytes = ~2.4KB, está dentro do limite com folga em casos típicos. Se previsão estourar (períodos > 60 dias com extras), particionar `respostas_json` em duas colunas (parte 1 / parte 2).
- **Rate limit**: monday tem complexity budget. WFs de leitura/escrita de 1 item por chamada estão tranquilos.
- **Subscriber requirement**: João Gabriel é o owner. Para outros membros do RH editarem direto pelo monday, precisa ser adicionado como subscriber.
