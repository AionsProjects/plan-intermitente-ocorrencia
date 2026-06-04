# WF MENSAL FIFO

Workflow n8n responsável pelo pagamento das convocações **MENSAL** (clone do WF5 PONTUAL FIFO com regras próprias).

- **Host**: `https://antigoaionscorp-n8n.cloudfy.live` (n8n antigo)
- **ID**: `7OtCd751FL1IrkHi`
- **URL editor**: https://antigoaionscorp-n8n.cloudfy.live/workflow/7OtCd751FL1IrkHi
- **Base**: clone do WF5 PONTUAL FIFO (`Bso4k6ddDNcRmU83`)
- **Script setup**: `scripts/setup_wf_mensal_fifo.cjs`

## Regras de pagamento

| Campo | PONTUAL | MENSAL |
|---|---|---|
| Trigger | webhook ENTRADA `ativar` | cron (último dia útil) + manual |
| Dias VR | seg-sex do período | `min(3, diasÚteis(período))` |
| Dias VT | seg-sex (+sáb se trabalhaSáb) | `min(3, diasÚteis)` **só** se `optanteVT=SIM` E (`interior=SIM` OU contrato ∈ {`SEDUC INTERIOR`, `TRE PB`}) |
| Compet RM | mês do `dataInicio` | mês `dataInicio` (= mês alvo via filtro) |
| Antifraude | board Desconto FIFO (igual) | + checa Solicitação Pagamento já criada |

## Trigger

Cron `0 23 * * 1-5` (23:00 BRT seg-sex). Code `Gate` checa se hoje é último dia útil do mês. Se não → exit silencioso. Override manual via editor n8n → `$execution.mode === 'manual'` bypassa gate.

**Competência alvo** = mês corrente + 1 (rolagem ano coberta).
- Disparo 29/05/2026 → compet 06/2026
- Disparo 30/06/2026 → compet 07/2026
- Disparo 31/12/2026 → compet 01/2027

## Fluxo de nodes

```
Schedule Trigger
   ↓
Code Gate (UDU + compet alvo)
   ↓
If Deve Passar (devePassar === true)
   ↓
Code Build Query Mensal (GraphQL board ENTRADA, Tipo=MENSAL, Status=Válida)
   ↓
Buscar Mensal Elegíveis (HTTP Monday)
   ↓
Code Build Antifraude (filtra por mês compet alvo + monta query Solicitação)
   ↓
Buscar Solicitacoes Ja Pagas (HTTP Monday, board 18393673859 por compet label)
   ↓
Code Normalizar Mensal (emite N items shape pontual + anoComp/mesComp)
   ↓
Split Convocacoes (batchSize=1)
   ↓
Code in JavaScript1 (MENSAL: min 3 dias VR/VT)
   ↓
(cadeia WF5 reusada: BEN 2 RM → If → regra benefício → desconto FIFO →
  Caju credito/boleto → SOAP SaveRecord ZMDHSTBENFUNC → Solicitação Pgto
  → drive + planilha conferência → Status AUTOMACAO - OK)
```

## Mudanças vs WF5 PONTUAL

| Node | Mudança |
|---|---|
| `Webhook`, `If3`, `If6`, `Code in JavaScript` (parser) | **Removidos** |
| `Schedule Trigger`, `Code Gate`, `If Deve Passar`, `Code Build Query Mensal`, `Buscar Mensal Elegíveis`, `Code Build Antifraude`, `Buscar Solicitacoes Ja Pagas`, `Code Normalizar Mensal`, `Split Convocacoes` | **Novos** |
| `Code in JavaScript1` | Regra MENSAL: `diasVR = min(3, diasÚteis)`, `diasVT = ...` |
| `Code in JavaScript2` | Removida ref `$('Webhook').first().json.body.event` → usa `dadosNo3.contratoOrgao` do Code1 |
| `Code in JavaScript9` (SOAP boleto) | `anoComp/mesComp` lidos de `$('Code in JavaScript1').first().json.anoComp/mesComp` (era `new Date()`) |
| `Code in JavaScript11` (SOAP crédito) | mesmo |
| Todos outros nodes | Reusados sem mudança |

## Antifraude

Convocação MENSAL X, compet 06/2026, processada uma vez → cria item Solicitação Pagamento com `Competência=JUNHO` e `name=INTERMITENTE - <NOME>`.

Re-execução manual no mesmo mês:
- Query Solicitação por `color_mks0yady=JUNHO` retorna o item criado
- Code Normalizar filtra elegíveis cujo `INTERMITENTE - <NOME>` aparece na lista → skip
- Output 0 items → cadeia downstream não roda

## Cenários VT esperados

| Contrato | Interior | optanteVT | diasVT |
|---|---|---|---|
| SEMSA | NÃO | SIM | 0 |
| SEMSA | SIM | SIM | 3 |
| SEDUC SEDE | NÃO | SIM | 0 |
| SEDUC SEDE | SIM | SIM | 3 |
| SEDUC INTERIOR | NÃO | SIM | 3 |
| SEDUC INTERIOR | NÃO | NÃO | 0 |
| TRE PB | NÃO | SIM | 3 |
| TRE PB | NÃO | NÃO | 0 |

## Verificação

1. Editor n8n → execução manual → confere passa por Gate
2. Lista elegíveis vazia? Cria convocação MENSAL teste no board ENTRADA com Data Início no mês alvo
3. Re-run: verifica Solicitação Pagamento criada (board `18393673859`, group do mês), Caju order, SOAP RM
4. Re-run novamente: 0 processadas (antifraude)

## Teste oficial

- **Data**: 29/05/2026 (último dia útil maio 2026)
- **Competência alvo**: 06/2026
- **Validação**: Raylen executa via editor antes do cron disparar 23:00; Thifany confere lista no monday

## Patches herdados (já no WF5)

WF MENSAL herda patches recentes do WF5:
- AIONS → RM direto (BEN 2 GET + SOAP SaveRecord)
- Status `AUTOMAÇÃO - OK` na Solicitação Pagamento pós-criação
- Planilha conferência XLSX no drive
