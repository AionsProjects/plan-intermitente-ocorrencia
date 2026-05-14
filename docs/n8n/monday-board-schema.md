# Mapeamento Monday / n8n

Referencia dos boards, colunas e contratos usados pelo webapp de intermitentes.

## Ambientes n8n

| Uso | Host | Exemplo |
|---|---|---|
| Novo n8n | `https://aionscorp-n8n.cloudfy.live` | `/webhook/intermitente-ler` |
| n8n antigo | `https://antigoaionscorp-n8n.cloudfy.live` | `/webhook/intermitente-convocar-opcoes` |

Regra atual:

- WF1 a WF4 do fluxo de intermitentes usam o n8n novo.
- Convocacao, pontual e endpoints auxiliares antigos permanecem no n8n antigo, exceto quando explicitamente migrados.
- O workflow `Intermitente -- Cancelar Convocacao (monday)` foi criado no n8n novo em `/webhook/intermitente-cancelar-convocacao`.

## Board Entrada `18408773953`

Board: `Plan. de Intermitentes`  
URL: `https://contato-serv.monday.com/boards/18408773953`

Origem das convocacoes. O webapp `/convocar` cria itens aqui e o WF1 dispara quando a coluna `ativar` muda.

| Coluna | Column ID | Tipo | Uso |
|---|---|---|---|
| Name | `name` | name | Nome do item, padrao `INTERMITENTE - NOME` |
| Nome do Empregado | `dropdown_mktadatt` | dropdown | Intermitente selecionado |
| CPF | `dup__of_matr_cula` | text | CPF quando disponivel |
| Funcionario / Chapa | `texto` | text | Chapa RM; chave principal para conflito |
| Admissao | `text_mkzh8jhn` | text | Data de admissao em texto |
| Funcao | `texto0` | text | Funcao/cargo |
| Escala | `text_mkvn2cmr` | text | Escala |
| Local/Unidade | `texto75` | text | Unidade/local |
| Solicitante | `color_mktc9q29` | status | OPERACIONAL / RH |
| Op - Contrato | `color_mktcnxwn` | status | Contrato operacional |
| OP - Sabado? | `color_mktaavmp` | status | SIM / NAO |
| OP - Insalubridade? | `color_mktq63xa` | status | SIM / NAO / NAO INFORMADO |
| OP - Interior? | `color__1` | status | SIM / NAO |
| OP - Tipo Convocacao | `color_mkta71ex` | status | PONTUAL / MOP / DEMISSAO / NAO CONVOCADO / MENSAL |
| OP - VT so volta? | `color_mkwaw840` | status | SIM / NAO |
| OP - Justificativa | `color_mktarrgs` | status | Justificativa operacional |
| OP - Data/Inicio | `date_mktayxhb` | date | Inicio da convocacao |
| OP - Data/Fim | `date_mktasnwq` | date | Fim da convocacao |
| OP - Empregado Substituido | `text_mktc23av` | text | Nome do substituido |
| Termo de Convocacao | `file_mm21x463` | file | Upload WF7 via `add_file_to_column` |
| Termo de Insalubridade | `file_mm21457r` | file | Upload WF7 via `add_file_to_column` |
| Status Convocacao | `color_mm3a8ana` | status | `Valida`, `Cancelada`, `Cancelada parcialmente`, `Bloqueada - conflito` |
| Cancelamento Inicio | `date_mm3b88ta` | date | Inicio do cancelamento parcial |
| Link | `link_mm2pn9kg` | link | Link `/preencher/<uuid>` ou referencia de conflito |
| ativar | `color_mm2pxmak` | status | Trigger do WF1 |

### Status Convocacao

Labels esperadas:

- `Valida`
- `Cancelada`
- `Cancelada parcialmente`
- `Bloqueada - conflito`

Regras:

- Itens com status vazio contam como validos por seguranca.
- `Cancelada` e `Bloqueada - conflito` nao ocupam periodo.
- `Cancelada parcialmente` ocupa de `date_mktayxhb` ate o dia anterior a `date_mm3b88ta`.
- `Cancelada parcialmente` sem `date_mm3b88ta` ocupa o periodo inteiro por seguranca.

Sobreposicao inclusiva:

```ts
inicioExistenteEfetivo <= novoFim && novoInicio <= fimExistenteEfetivo
```

## Board Historico `18411141462`

Board: `Plan. de Intermitentes -- Historico de Ocorrencias`  
URL: `https://contato-serv.monday.com/boards/18411141462`

Um item por convocacao. O detalhe dia a dia fica em `Respostas JSON`.

| Coluna | Column ID | Tipo | Uso |
|---|---|---|---|
| Name | `name` | name | Nome do intermitente |
| UUID | `text_mm2xjend` | text | Chave do link `/preencher/<uuid>` |
| Protocolo | `text_mm2xsvg6` | text | `PROT-XXXX-XXXX` gerado no frontend |
| Contrato | `text_mm2x1ktb` | text | Contrato copiado da Entrada |
| Chapa | `text_mm33v9kp` | text | Chapa RM |
| Solicitante | `text_mm2xxkm8` | text | Quem disparou/criou |
| Data Inicio | `date_mm2xtp93` | date | Inicio da convocacao |
| Data Fim | `date_mm2xrr5q` | date | Fim da convocacao |
| Expira Em | `date_mm2xrvt4` | date | Validade do link |
| Criado Em | `date_mm2x115h` | date | Timestamp WF1 |
| Concluido Em | `date_mm2xh1vm` | date | Timestamp WF3 |
| Editado Em | `date_mm2x62fq` | date | Ultima correcao |
| Status | `color_mm2xkqpc` | status | `Aguardando`, `Concluido`, `Expirado` |
| Status Cancelamento | `color_mm3b9v4n` | status | `Cancelada`, `Cancelada parcialmente` |
| Editado | `boolean_mm2x1aa4` | checkbox | Marcado em correcao pos-finalizacao |
| Qtd. Faltas | `numeric_mm2xe2zk` | numbers | Agregado WF3 |
| Qtd. Atrasos | `numeric_mm2x18hh` | numbers | Agregado WF3 |
| Total Minutos Atraso | `numeric_mm2x4fjj` | numbers | Agregado WF3 |
| Dias Extras | `long_text_mm2x73w6` | long_text | JSON array `YYYY-MM-DD` |
| Dias Desativados | `long_text_mm2xm820` | long_text | JSON array `YYYY-MM-DD` |
| Respostas JSON | `long_text_mm2xtcpw` | long_text | JSON `[{data,tipo,minutos_atraso}]` |
| Optante VT | `color_mm34ry47` | status | SIM / NAO |
| Trabalha Sabado | `color_mm34yyet` | status | SIM / NAO |
| Item Origem | `link_mm2x1rk0` | link | URL do item da Entrada |
| Link Preencher | `link_mm2xfay7` | link | URL publica do formulario |

Status historico:

- `Aguardando` = id interno `0`
- `Concluido` = id interno `1`
- `Expirado` = id interno `17`

Use preferencialmente `{ "label": "..." }` nas mutations para evitar erro com IDs internos.

## Board Base de Desconto `18400981023`

Usado pelo cancelamento para tratar dias cancelados como falta.

Mapeamento detalhado ainda depende da ultima exportacao do board. Regra funcional atual:

- Cancelamento total gera desconto de `dataInicio` ate `dataFim`.
- Cancelamento parcial gera desconto de `data_inicio_cancelamento` ate `dataFim`.
- Se desconto igual ja existir:
  - `PENDENTE`: atualizar;
  - inexistente: criar;
  - `PARCIAL` ou `FINALIZADO`: retornar `409` e nao sobrescrever.
- VR desconta dias uteis seg-sex.
- VT desconta dias uteis conforme optante VT.
- Sabado respeita `trabalha_sabado`.

## Contratos HTTP

### WF2 -- Ler

`GET /webhook/intermitente-ler?uuid=<uuid>`

Retorna:

```ts
{
  uuid: string
  status: "aguardando" | "concluido" | "expirado"
  nome: string
  contrato: string | null
  data_inicio: string
  data_fim: string
  dias: string[]
  expira_em: string | null
  concluido_em: string | null
  protocolo: string | null
  editado: boolean
  editado_em: string | null
  respostas: Array<{data: string, tipo: "sem_ocorrencia" | "falta" | "atraso", minutos_atraso?: number | null}>
  dias_extras: string[]
  dias_desativados: string[]
}
```

### WF3 -- Finalizar

`POST /webhook/intermitente-finalizar?uuid=<uuid>`

Body:

```ts
{
  uuid: string
  respostas: Array<{data: string, tipo: string, minutos_atraso: number | null}>
  protocolo: string
  dias_extras: string[]
  dias_desativados: string[]
  eh_correcao: boolean
}
```

### WF4 -- Buscar protocolo

`GET /webhook/intermitente-buscar-protocolo?protocolo=<PROT-XXXX-XXXX>`

Retorna `{ uuid, nome }` ou 404.

### WF7 -- Convocar

`POST /webhook/intermitente-convocar`

`multipart/form-data` com dados da convocacao e arquivos opcionais:

- `termo_convocacao`
- `termo_insalubridade`

Respostas principais:

- `200 {ok: true, item_id, item_url}`
- `400 {ok: false, erro: "campo_obrigatorio" | "data_invalida", mensagem}`
- `409 {ok: false, erro: "convocacao_conflitante", mensagem, conflito}`
- `500 {ok: false, erro: "erro_monday_conflitos", mensagem}`

Payload de conflito esperado:

```json
{
  "ok": false,
  "erro": "convocacao_conflitante",
  "mensagem": "Data divergente: este intermitente ja foi convocado neste periodo.",
  "conflito": {
    "item_id": "123",
    "item_url": "https://contato-serv.monday.com/boards/18408773953/pulses/123",
    "nome": "NOME",
    "chapa": "0000",
    "data_inicio": "2026-05-01",
    "data_fim": "2026-05-15",
    "data_inicio_original": "2026-05-01",
    "data_fim_original": "2026-05-20",
    "status_convocacao": "Cancelada parcialmente",
    "data_inicio_cancelamento": "2026-05-16"
  }
}
```

### WF8 -- Buscar empregado RM

`GET /webhook/convocar-buscar-empregado?nome=<string>`

Retorna:

```ts
{
  resultados: Array<{
    nome: string
    chapa: string
    cpf: string
    funcao: string
    admissao: string
    secao: string
    codcoligada: string
  }>
}
```

### WF Cancelar Convocacao

`POST /webhook/intermitente-cancelar-convocacao?uuid=<uuid>`

Body total:

```json
{
  "tipo": "total",
  "data_inicio_cancelamento": null
}
```

Body parcial:

```json
{
  "tipo": "parcial",
  "data_inicio_cancelamento": "2026-05-14"
}
```

Retorno sucesso:

```json
{
  "ok": true,
  "tipo": "total",
  "data_inicio_cancelamento": null,
  "desconto": {
    "acao": "create",
    "descontoVR": 0,
    "descontoVT": 0
  }
}
```

Regras de atualizacao:

- Total:
  - Entrada `color_mm3a8ana = Cancelada`
  - Historico `color_mm3b9v4n = Cancelada`
- Parcial:
  - Entrada `color_mm3a8ana = Cancelada parcialmente`
  - Entrada `date_mm3b88ta = data_inicio_cancelamento`
  - Historico `color_mm3b9v4n = Cancelada parcialmente`

## Queries Monday uteis

### Buscar por coluna

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

Usos:

- WF2: `board_id=18411141462`, `column_id=text_mm2xjend`
- WF4: `board_id=18411141462`, `column_id=text_mm2xsvg6`
- WF7/WF1 conflitos: `board_id=18408773953`, `column_id=texto`

## Observacoes

- O frontend nunca chama Monday diretamente; toda I/O passa pelo n8n.
- Campos text vazios do Monday chegam como `""`; o frontend normaliza para `null` quando necessario.
- Datas Monday podem chegar como `YYYY-MM-DD` ou `YYYY-MM-DD HH:mm:ss`.
- Reimport de JSON do n8n costuma perder credenciais; reselecionar `Ray0` e `rm mike` manualmente.
