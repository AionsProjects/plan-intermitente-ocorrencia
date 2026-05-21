# WF n8n - Nexti Validar Atestado

Automacao standalone para validar se um atestado recebido no monday ja esta coberto por ausencia no ponto Nexti. Nao atualiza monday, nao cria item em boards de desconto e nao toca nos workflows do fluxo intermitente.

Arquivo importavel: [nexti-validar-atestado.json](./nexti-validar-atestado.json).

## Endpoint

`POST https://aionscorp-n8n.cloudfy.live/webhook/nexti-validar-atestado`

Payload esperado: webhook padrao de Monday Automation com `event.boardId` e `event.pulseId`.

## Fluxo

1. Webhook `nexti-validar-atestado`
2. Parse do payload monday
3. GraphQL monday para ler `items(ids:[pulseId]) { id name column_values { id text value } }`
4. Extracao de CPF, data inicial e data final
5. Nexti `GET /persons/cpf?cpf=...`
6. Nexti `GET /absences/person/{personId}/start/{start}/finish/{finish}?finish=...&page=0&size=50`
7. Filtro de ausencias removidas e fora do periodo do atestado
8. Nexti `GET /absencesituations/{absenceSituationId}` para cada ausencia
9. Decisao final e resposta JSON

## Melhorias aplicadas

- O HTTP do monday usa a credencial nativa `mondayComApi` (`Ray0`) em vez de HTTP Header generico.
- Erro/formato inesperado do Nexti vira `erro` ou `revisar_manual`; nao vira desconto automaticamente.
- Pessoa com `personSituationId=3` retorna `revisar_manual`.
- Demissao (`absenceTypeId=3`) tem prioridade sobre ausencia justificada.
- `sem_desconto` so sai quando ausencias justificadas cobrem o periodo inteiro do atestado.
- Ausencia justificada parcial retorna `revisar_manual`.
- A decisao recupera a absence original pelo indice do node `Filtrar absences`, evitando perda de contexto apos o HTTP de `/absencesituations`.

## Configuracao obrigatoria

No n8n, crie/valide:

| Item | Como configurar |
|---|---|
| Credencial monday | `Ray0`, tipo `Monday.com API`, id `6I0ycSr6PQJkBYpc` |
| Auth Nexti | Workflow remoto usa node `Nexti OAuth token` com `client_credentials` e header Basic, depois envia `Authorization: Bearer ...` nas 3 chamadas Nexti |
| CPF | Coluna criada no board: `text_mm3j4nt3` (`CPF`) |
| Data inicial | `date` (`Emissao do Atestado`) |
| Data final | Calculada por `date` + `numberjox5johv` (`Dias de Atestado?`) - 1 |
| Buffer | Default `2` dias antes/depois |

As variaveis `NEXTI_ATESTADO_COL_*` continuam suportadas para override, mas o JSON atual ja sai com os defaults do board `18298015951`.

## Board monday usado

- Board: `18298015951` - `Controle de atestados - Ponta`
- Coluna CPF: `text_mm3j4nt3` (`CPF`) - criada em 2026-05-21 para suportar Nexti
- Data inicial: `date` (`Emissao do Atestado`)
- Dias: `numberjox5johv` (`Dias de Atestado?`)
- Gatilho recomendado: `color_mky1mjh7` (`Validacao de documento`) quando label mudar para `VALIDADO`
- Gatilho alternativo: `status` (`Lancamento DP`) quando label mudar para `LANCADO`

Recomendacao operacional: usar `Validacao de documento = VALIDADO`, porque a consulta Nexti deve acontecer logo depois que o documento foi aceito, antes de decidir desconto/lancamento.

O JSON local continua sem secrets. A configuracao com client id/client secret foi aplicada diretamente no workflow remoto do n8n novo.

## Deploy por API

Script criado em:

`C:\Users\NOTECS-89\Downloads\CALCULO INTERMITENTE\scripts\upsert_nexti_validar_atestado.cjs`

Para publicar no n8n novo:

```powershell
$env:N8N_NOVO_API_URL = "https://aionscorp-n8n.cloudfy.live"
$env:N8N_NOVO_API_KEY = "<api_key_do_n8n_novo>"
$env:NEXTI_CRED_ID = "<id_da_credencial_Nexti_API>" # opcional se a credencial ja se chamar exatamente Nexti API
node "C:\Users\NOTECS-89\Downloads\CALCULO INTERMITENTE\scripts\upsert_nexti_validar_atestado.cjs"
```

Se faltar `NEXTI_CRED_ID` e o script nao conseguir resolver a credencial pelo nome, ele cria/atualiza o workflow mas nao ativa.

Status atual em 2026-05-21: workflow criado/atualizado no n8n novo com id `6efSZQYzLaP304rn`, ativo, com token Nexti inline no proprio workflow remoto.

## Resposta

```json
{
  "ok": true,
  "decisao": "sem_desconto",
  "motivo": "ausencia_justificada_cobre_periodo_no_ponto_nexti",
  "cpf": "00000000000",
  "personId": 12345,
  "nome": "FULANO DE TAL",
  "item_id": "1234567890",
  "item_nome": "Item monday",
  "absences_encontradas": [
    {
      "absenceId": 1,
      "absenceSituationId": 10,
      "start": "21052026000000",
      "finish": "23052026000000",
      "start_iso": "2026-05-21",
      "finish_iso": "2026-05-23",
      "cidCode": "A09",
      "situationName": "Atestado Medico",
      "initials": "AM",
      "absenceTypeId": 1
    }
  ]
}
```

## Testes minimos

1. Criar/validar credencial `Nexti API`.
2. Configurar as variaveis `NEXTI_ATESTADO_COL_*`.
3. Publicar o workflow via script ou importar o JSON.
4. Testar com payload real do monday.
5. Validar no execution log o formato aceito pelo endpoint de absences (`finish` no path vs query). O workflow hoje envia os dois para cobrir a divergencia do swagger.
