# Ponto Facultativo - mapeamento atual

Ultima atualizacao: 2026-05-23.

## Objetivo

Permitir que DP/Operacional selecione um contrato, uma data do mes atual e quais beneficios devem ser descontados (`VR`, `VT` ou ambos). O backend encontra todos os intermitentes convocados naquele contrato/data, evita duplicidade via ledger e cria/atualiza a Base de Desconto.

## Frontend

- Rota: `/ponto-facultativo`
- Feature: `src/features/ponto-facultativo/`
- Tile no Hub: `Ponto facultativo`
- Fluxo:
  1. selecionar contrato;
  2. selecionar data do mes atual;
  3. selecionar beneficios;
  4. preview dos convocados afetados;
  5. confirmar aplicacao.

Contratos permitidos:

- `SEMSA`
- `SEDUC ESCOLA`
- `SEDUC SEDE`
- `SEDUC INTERIOR`
- `DETRAN`
- `TRE PB`
- `CETAM`

O calendario bloqueia domingos e feriados nacionais. Sabado e permitido porque depende da convocacao (`trabalha_sabado` ou sabado extra).

## Endpoints

Host novo: `https://aionscorp-n8n.cloudfy.live/webhook`

| Endpoint | WF ID | Status | Uso |
|---|---|---|---|
| `POST /ponto-facultativo-preview` | `7gHmbLcZ5r6D5sXz` | Ativo | Calcula afetados e totais sem alterar Monday. |
| `POST /ponto-facultativo-aplicar` | `XybrfnzI11Fw5sX4` | Ativo | Recalcula, grava ledger e cria/atualiza Desconto. |

Payload dos dois endpoints:

```json
{
  "contrato": "SEMSA",
  "data": "2026-05-20",
  "beneficios": ["VR", "VT"]
}
```

## Boards e colunas usadas

### Entrada - `18408773953`

Usado para localizar convocacoes ativas.

| Campo | Column ID | Uso |
|---|---|---|
| Nome | `name` | Nome do convocado. |
| Chapa | `texto` | Matricula/chapa. |
| CPF | `dup__of_matr_cula` | CPF quando disponivel. |
| Funcao | `texto0` | Regra/função para valores. |
| Contrato | `color_mktcnxwn` | Filtro principal do ponto facultativo. |
| Data inicio | `date_mktayxhb` | Periodo da convocacao. |
| Data fim | `date_mktasnwq` | Periodo da convocacao. |
| Status convocacao | `color_mm3a8ana` | Ignora `Cancelada`, `Cancelado`, `Bloqueada - conflito`. |
| Cancelamento inicio | `date_mm3b88ta` | Em cancelamento parcial, fim efetivo = dia anterior. |
| Trabalha sabado | `color_mktaavmp` | Elegibilidade de sabado. |
| Optante VT | `optante___vt` / `color_mm34ry47` | VT e regra `SIM*`. |

### Historico - `18411141462`

Usado para ler/gravar ledger e impedir duplicidade no `/preencher`.

| Campo | Column ID | Uso |
|---|---|---|
| UUID | `text_mm2xjend` | Link com o registro. |
| Chapa | `text_mm33v9kp` | Cross-check com Entrada. |
| Data inicio | `date_mm2xtp93` | Cross-check com Entrada. |
| Ledger beneficios | `long_text_mm3ct3hg` | JSON de VR/VT ja aplicados por data. |
| Trabalha sabado | `color_mm34yyet` | Fallback para sabado. |
| Sabados extras | `text_mm3bfn6h` | Sabados pagos manualmente. |

Origem gravada no ledger:

```text
ponto_facultativo:<contrato>:<data>
```

Exemplo:

```text
ponto_facultativo:SEMSA:2026-05-20
```

### Desconto - `18400981023`

O ponto facultativo cria ou atualiza item por `chapa + data + Origem do Desconto`.

| Campo | Column ID | Uso |
|---|---|---|
| Nome | `dropdown_mm0rgfrx` | Nome do intermitente. |
| Chapa | `text_mm0rpqxs` | Matricula. |
| CPF | `text_mm0r5ted` | CPF. |
| Data inicio | `date_mm0r6tyr` | Data do ponto facultativo. |
| Data fim | `date_mm0rzpyv` | Mesma data. |
| Dias/Unidades VT | `numeric_mm3428yj` | Unidade VT aplicada. |
| Dias/Unidades VR | `numeric_mm34p6p7` | Unidade VR aplicada. |
| Qtd atrasos | `numeric_mm2pj1av` | Mantido zero para ponto facultativo. |
| Desconto VR | `numeric_mm0rgsaw` | Valor calculado de VR. |
| Desconto VT | `numeric_mm0r5tca` | Valor calculado de VT. |
| Status financeiro | `color_mm0r8mjr` | `PENDENTE`, `PARCIAL`, `FINALIZADO`. |
| Residual VR | `numeric_mm0r1691` | Valor pendente VR. |
| Residual VT | `numeric_mm0rtwwg` | Valor pendente VT. |
| Descontado VR | `numeric_mm0rqy6z` | Inicialmente zero. |
| Descontado VT | `numeric_mm0r6cn0` | Inicialmente zero. |
| Origem do Desconto | `color_mm3kqmjy` | Label `PONTO FACULTATIVO`. |

Arquivo local com ID da coluna criada:

```text
ponto-facultativo-columns.json
```

### Valores de beneficios - `18413870370`

O workflow espera regras ativas por contrato/função.

Colunas esperadas por titulo:

- `Contrato`
- `Regra/Função` ou equivalente (`Regra`, `Funcao`, `Cargo`)
- `Prioridade`
- `VR`
- `VT`
- `Ativo`

Regra de escolha:

1. filtra linhas ativas;
2. procura contrato especifico;
3. aplica regra/função se bater;
4. cai em padrao do contrato;
5. cai em padrao global.

## Regras de calculo

- VR so gera valor em dia nao-sabado.
- VT so gera valor para optante VT.
- `SIM*` aplica meia-volta no VT.
- Sabado so entra se a convocacao trabalha sabado ou se a data estiver em sabados extras.
- Domingo e feriado nacional nao entram.
- Ledger capa `vr_percentual` e `vt_percentual` em 100 por data.
- Reaplicar a mesma data/contrato/beneficio nao duplica.
- Aplicar primeiro `VR` e depois `VT` no mesmo contrato/data mescla apenas o que ainda falta.

## Integracao com `/preencher`

WF2 `GET /intermitente-ler` le `Beneficios Descontados JSON` e devolve:

```json
{
  "pontos_facultativos": [
    {
      "data": "2026-05-20",
      "contrato": "SEMSA",
      "beneficios": ["VR", "VT"],
      "origem": "ponto_facultativo:SEMSA:2026-05-20"
    }
  ]
}
```

No frontend, esses dias:

- aparecem como ponto facultativo;
- ficam read-only;
- abrem modal informativo no clique;
- sao enviados como `sem_ocorrencia` na finalizacao.

## Validacao executada

- Build frontend: `npm run build` passou.
- `POST /ponto-facultativo-preview` com `SEDUC SEDE`, `2026-05-20`, `["VR","VT"]`: OK, zero afetados.
- `POST /ponto-facultativo-aplicar` com `SEDUC SEDE`, `2026-05-20`, `["VR"]`: OK, zero afetados.
- Preview geral em `2026-05-20`: SEMSA encontrou 5 convocados.

## Pendencia atual

Para SEMSA em `2026-05-20`, os 5 convocados foram encontrados, mas os valores vieram zerados:

```text
regra_valores = "Sem regra de valores"
valor_vr = 0
valor_vt = 0
```

Antes de aplicar em producao com convocados reais, confirmar no board `18413870370` se existe regra ativa para `SEMSA` ou uma regra padrao global com valores de VR/VT.
