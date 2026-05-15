# Board Controle de Atestados - Ponta

Mapeamento recebido em `2026-05-15T18:39:47Z`.

- Board ID: `18298015951`
- URL: `https://contato-serv.monday.com/boards/18298015951`
- Grupo principal: `topics` (`ATESTADOS RECEBIDOS`)

## Grupos

| Grupo | ID |
|---|---|
| ATESTADOS RECEBIDOS | `topics` |
| Novo grupo | `group_mm1by9ez` |
| Novo grupo | `group_mkzz39wh` |
| RECUSADOS | `novo_grupo46955__1` |

## Colunas principais

| Coluna | ID | Tipo | Uso no fluxo de intermitentes |
|---|---|---|---|
| Nome do Colaborador | `name` | name | Nome do intermitente |
| Status SEMSA | `color_mkznhx46` | status | Não obrigatório para intermitente |
| Modalidade de contrato | `single_select5yq25pm` | status | Usar `INTERMITENTE` |
| Tipo da Documentação | `sele__o_individual__1` | status | Usar `Atestado Médico` por padrão |
| Dias de Atestado? | `numberjox5johv` | numbers | Quantidade de dias cobertos |
| Saída e ou/ Retorno ao trabalho | `short_textcpcyzaec` | text | Período do atestado em texto |
| Emissão do Atestado | `date` | date | Data de início do atestado, salvo ajuste operacional |
| Horário de almoço | `single_selectkiwkh2d` | status | Usar `NDA` |
| Trabalhou +6 / -6 horas? | `single_selectcovdz0i` | status | Conforme resposta do primeiro dia |
| Acompanhante? | `sele__o_individual8__1` | status | Usar `Sem acompanhamento` |
| Contrato do Colaborador | `department` | status | Contrato do intermitente |
| Arquivos | `files` | file | Anexar arquivo do atestado |
| Observação | `short_textl33u569o` | text | Registrar UUID/período/origem |
| Validação de documento | `color_mky1mjh7` | status | Sugestão: `VALIDADO` ou `AGUARDANDO RETORNO` |
| Lançamento DP | `status` | status | Sugestão: `VERIFICAR` |
| Validação de lançamento | `color_mkzbgzc6` | status | Sugestão: `AGUARDANDO RETORNO` ou `NÃO NECESSÁRIO` |
| Competência | `dropdown_mkzsebbf` | dropdown | Mês do início do atestado |
| Submission link | `wf_edit_link_kmxfj` | link | Opcional |

## Status usados

### Modalidade de contrato `single_select5yq25pm`

| Label | ID |
|---|---:|
| CELETISTA | `0` |
| INTERMITENTE | `1` |

### Tipo da Documentação `sele__o_individual__1`

Usar por padrão:

| Label | ID |
|---|---:|
| Atestado Médico | `1` |

Outras opções relevantes:

| Label | ID |
|---|---:|
| Atestado Odontológico | `0` |
| Atestado Psicológico | `2` |
| Atestado Ocupacional | `3` |
| Declaração Médica | `17` |
| Atestado de acompanhamento | `19` |
| Declaração Acompanhamento | `101` |
| Declaração de Comparecimento | `102` |

### Trabalhou +6 / -6 horas `single_selectcovdz0i`

| Regra do frontend | Label |
|---|---|
| Primeiro dia trabalhou e trabalhou 6h ou mais | `Trabalhou +6h` |
| Primeiro dia trabalhou e trabalhou menos de 6h | `Trabalhou -6h` |
| Primeiro dia não trabalhou ou não se aplica | `Não se aplica` |

### Acompanhante `sele__o_individual8__1`

Usar por padrão:

| Label | ID |
|---|---:|
| Sem acompanhamento | `4` |

### Contrato do Colaborador `department`

| Label | ID |
|---|---:|
| SEDUC ESCOLA | `0` |
| SEDUC COORDENADORIAS | `1` |
| TRE PB | `2` |
| SEMSA | `3` |
| DETRAN | `4` |
| SEDUC SEDE | `6` |
| CETAM | `7` |
| SEDUC INTERIOR | `16` |

### Validação de documento `color_mky1mjh7`

| Label | ID |
|---|---:|
| VALIDADO | `0` |
| DECLARAÇÃO RECEBIDA | `1` |
| NÃO ACEITO | `2` |
| AGUARDANDO RETORNO | `3` |
| VERACIDADE | `4` |
| DUPLICADO | `6` |

### Lançamento DP `status`

| Label | ID |
|---|---:|
| VERIFICAR | `0` |
| LANÇADO | `1` |
| DUPLICADO | `2` |
| DECLARAÇÃO LANÇADA | `3` |
| AGUARDANDO RETORNO | `4` |
| NÃO NECESSÁRIO | `6` |
| NÃO ACEITO | `13` |

### Validação de lançamento `color_mkzbgzc6`

| Label | ID |
|---|---:|
| LANÇADO | `0` |
| VALIDADO | `1` |
| RECUSADO | `2` |
| AGUARDANDO RETORNO | `3` |
| VERACIDADE | `4` |
| NÃO NECESSÁRIO | `6` |

### Competência `dropdown_mkzsebbf`

| Mês | Label |
|---|---|
| 1 | `JANEIRO` |
| 2 | `FEVEREIRO` |
| 3 | `MARÇO` |
| 4 | `ABRIL` |
| 5 | `MAIO` |
| 6 | `JUNHO` |
| 7 | `JULHO` |
| 8 | `AGOSTO` |
| 9 | `SETEMBRO` |
| 10 | `OUTUBRO` |
| 11 | `NOVEMBRO` |
| 12 | `DEZEMBRO` |

## Payload recomendado para `create_item`

O WF3 deve criar um item por atestado novo recebido no multipart.

```js
const columnValues = {
  single_select5yq25pm: { label: "INTERMITENTE" },
  sele__o_individual__1: { label: "Atestado Médico" },
  numberjox5johv: String(qtdDiasAtestado),
  short_textcpcyzaec: `${dataInicioBR} a ${dataFimBR}`,
  date: { date: dataInicio },
  single_selectkiwkh2d: { label: "NDA" },
  single_selectcovdz0i: { label: labelTrabalhouSeisHoras },
  sele__o_individual8__1: { label: "Sem acompanhamento" },
  department: { label: contratoMonday },
  short_textl33u569o: `Convocação ${uuid} | ${dataInicio} a ${dataFim}`,
  color_mky1mjh7: { label: "VALIDADO" },
  status: { label: "VERIFICAR" },
  color_mkzbgzc6: { label: "AGUARDANDO RETORNO" },
  dropdown_mkzsebbf: { labels: [competenciaLabel] }
}
```

Mutation:

```graphql
mutation {
  create_item(
    board_id: 18298015951,
    group_id: "topics",
    item_name: "<NOME_DO_COLABORADOR>",
    column_values: "<JSON_STRING>",
    create_labels_if_missing: true
  ) { id }
}
```

Depois do `create_item`, anexar o arquivo no item criado:

```graphql
mutation ($file: File!) {
  add_file_to_column(
    item_id: <ITEM_ID_CRIADO>,
    column_id: "files",
    file: $file
  ) { id }
}
```

## Observações

- O board não possui coluna explícita de data fim do atestado; por isso o período completo deve ser salvo em `short_textcpcyzaec` e/ou `short_textl33u569o`.
- O frontend já envia `payload` JSON + arquivos `atestado_<id>` no `POST /intermitente-finalizar`.
- Ainda falta definir onde o Histórico `18411141462` guardará a lista persistida `atestados[]` e, se necessário, uma coluna file para cópia do anexo no Histórico.
