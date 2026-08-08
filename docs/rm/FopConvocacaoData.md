# RM — `FopConvocacaoData` (convocação de intermitente)

DataServer usado pra lançar a convocação de intermitente dentro do RM. Levantado em **2026-08-08**
via `GetSchema` + `ReadView` (ambos read-only, nada gravado), coligada **3**, contexto
`CODCOLIGADA=3; USUARIO=003080`.

Reproduzir:

```bash
npm run rm:schema -- FopConvocacaoData
```

```bash
npm run rm:readview -- FopConvocacaoData "CODCOLIGADA=3 AND DTCONVOCACAO >= '2026-01-01'"
```

## Tabelas

### `PFCONVOCACAO` — a convocação (1 linha por período convocado)

PK: `CODCOLIGADA + CHAPA + CODCONVOCACAO`.

| Campo | Tipo | Obrig. | Caption RM | Nota |
|---|---|:--:|---|---|
| `CODCOLIGADA` | short | ✔ | Coligada | `3` |
| `CHAPA` | string(16) | ✔ | Chapa | vem do RM/board (`Funcionário`) |
| `CODCONVOCACAO` | string(60) | ✔ | Código da Convocação | **nós escolhemos** — ver §Código abaixo |
| `DTCONVOCACAO` | dateTime | ✔ | Data da Convocação | data do ATO de convocar, não do trabalho |
| `DTINIPRESTSERV` | dateTime | ✔ | Data Início Prest. Serviço | = `OP - Data/Inicio` |
| `DTFIMPRESTSERV` | dateTime | ✔ | Data Fim Prest. Serviço | = `OP - Data/Fim` |
| `INDLOCALPRESTACTRAB` | short | ✔ | Local de Prestação do Serviço | `0` em 1279/1279 registros |
| `ESTADOCONVOCACAO` | short | ✔ | Situação da Convocação | **`4` = Concluída** (definido pelo DP) |
| `CODHORARIO` | string(10) | | Horário | vazio nos registros do DP |
| `INDINICIOHOR` | short | | Letra | |
| `DESCRICAOJORNADA` | string | | Descrição da Jornada | |
| `DTRESPOSTA` | dateTime | | Data da Resposta | DP preenche junto com a convocação |
| `DTINTERRUPCAO` | dateTime | | Data de Interrupção | candidato pro cancelamento parcial |
| `DTPREVPGTO` | dateTime | | Data Prevista de Pagamento | |
| `CODTIPORUA` `RUA` `NUMERO` `COMPLEMENTO` `BAIRRO` `CEP` `CODMUNICIPIO` `ESTADO` `IDPAIS` | | | endereço | só faz sentido se `INDLOCALPRESTACTRAB != 0` |
| `DESCESTADOCONVOCACAO` `DESCINDLOCALPRESTACTRAB` | string | | descrições | **derivados** — o RM devolve na leitura, não mandar no save |

### `PFCONVOCACAOPFPERFF` — vínculo com o período de folha

PK: `CODCOLIGADA + CHAPA + CODCONVOCACAO + ANOCOMP + MESCOMP + NROPERIODO`.
FK → `PFCONVOCACAO` por `CODCOLIGADA + CHAPA + CODCONVOCACAO`.

| Campo | Tipo | Obrig. | Caption RM |
|---|---|:--:|---|
| `ANOCOMP` | short | ✔ | Ano Competência |
| `MESCOMP` | short | ✔ | Mês Competência |
| `NROPERIODO` | short | ✔ | Período |
| `QUANTIDADEDIAS` | short | | Quantidade de Dias Pagos (default 0) |
| `DESCRICAOCUSTOM` | string | | Descrição do Envelope |

## Domínios observados (1279 registros de 2026, coligada 3)

| Campo | Valor | Descrição do RM |
|---|---|---|
| `ESTADOCONVOCACAO` | `4` (1278×) | Concluída |
| | `3` (1×) | Em progresso |
| `INDLOCALPRESTACTRAB` | `0` (1279×) | No mesmo endereço do estabelecimento |

`0`, `1` e `2` de `ESTADOCONVOCACAO` **não aparecem na base**. Decisão do DP (08/08/2026): a
automação grava `4` (Concluída) desde o início — ver §Estado inicial.

## ✅ Provado contra o RM em 08/08/2026 (gravou e apagou, período 2099)

Teste controlado na chapa `007404`, período em 2099 (fora de competência real), gravado e removido
com verificação por `ReadView` (`npm run rm:teste-convocacao`). Resultados:

| Pergunta | Resposta |
|---|---|
| `CODCONVOCACAO` pode ser omitido? | **Não.** SaveRecord estoura em `ReadRowPrimaryKey`: `Column 'CODCONVOCACAO' does not belong to table PFCONVOCACAO`. Nada persiste (confirmado por ReadView). O RM lê a PK de volta da linha enviada. |
| Tag **vazia** funciona? | **Sim** — e o contador automático numerou `C03S003754`. É o formato correto. |
| Código próprio é respeitado? | **Não.** Enviei `ZZ-TESTE-AUTOMACAO-1`, o RM gravou `C03S003755`. O contador automático **sempre vence**. |
| Antecedência 0 dispara mensagem de confirmação no SOAP? | **Não.** `SaveRecord OK`, sem Fault, sem aviso. Gravou `ESTADOCONVOCACAO=4` normalmente. A confirmação é da tela; o web service não pergunta. |
| `DTPREVPGTO` é derivado pelo RM? | **Não** — o `ReadRecord` do registro gravado voltou sem ela. Quem quiser precisa enviar. |

**Consequência direta:** a idempotência **não** pode morar no `CODCONVOCACAO`, porque não escolhemos
o código. Fica com `pi.efeitos_externos` (chave por pessoa) **mais** o pré-voo `ReadView` — e o
código gerado tem que ser lido do `SaveRecordResult` e gravado de volta no item do Monday, senão não
há caminho de volta pro registro.

### Duas armadilhas que custaram um registro órfão em produção

1. **O RM devolve texto de erro DENTRO do `<SaveRecordResult>`**, com HTTP 200 e sem Fault. O script
   tratou o stack trace como chave e reportou sucesso. `saveRecordDireto` agora valida o formato da
   chave (`chaveDeRegistroPlausivel`) e falha como `indeterminado`. Isso vale para o mensal também,
   que guarda essa chave como `pks` no ledger.
2. **`ReadRecord` que estoura não prova remoção** — PK inexistente estoura igual. A limpeza tentou
   apagar a PK *prevista* (`ZZ-TESTE-AUTOMACAO-1`, que nunca existiu), concluiu "removido" e deixou
   `C03S003755` vivo no RM. Removido depois com `npm run rm:delete`. A limpeza agora confere
   existência **antes** e **depois** do delete.

## Código da convocação — o RM gera, mas não protege o campo

`C03S######` é **contador automático do RM** (`C` + coligada `03` + `S` + sequencial de 6). Medido
sobre os 3746 registros da coligada 3:

- começa exatamente em `C03S000001` (out/2023), vai até `C03S003752`;
- 3707 códigos numa faixa de 3752 → **45 buracos, zero duplicado**;
- contador **único global**, não por chapa;
- **1036 inversões** entre a ordem numérica e `DTCONVOCACAO` → numera por ordem de INSERÇÃO, não
  pela data da convocação;
- maior bloco contíguo = **826** → lote inserido de uma vez, numerado em sequência.

**Só que o DataServer aceita valor arbitrário**: 39 registros (todos de 2024, ago–dez) têm número
cru sem prefixo — `334`, `369`, `553`–`632` — em blocos consecutivos por pessoa (chapa `006371` =
593→597). Carga/integração com contador próprio.

Em aberto: o XSD marca `CODCONVOCACAO` como obrigatório (sem `minOccurs="0"`), e código automático
do RM normalmente preenche no BeforeSave quando o campo vem vazio — **não dá pra provar sem
gravar**. Plano:

1. **Mandar vazio** e capturar o código do `SaveRecordResult`, gravando de volta no item do Monday.
   Mantém a numeração que o DP vê na tela. Preferido.
2. **Prefixo próprio** (ex. `PI0000123`) só se o vazio for recusado — os 39 provam que passa.

Com a opção 1 a idempotência **não** mora no RM, então fica obrigatório um `ReadView` de pré-voo
filtrando `CHAPA` + `DTINIPRESTSERV` antes de gravar, além do `pi.efeitos_externos`: o DP já lança
na mão, e sem esse check o lote do contrato duplica o que um humano lançou minutos antes.

## ⚠️ eSocial S-2260 — não testar em produção

Convocação de intermitente é evento **eSocial S-2260**. Gravar aqui alimenta a fila de transmissão,
então **não** vale repetir o truque de 01/08 no `ZMDHSTBENFUNC` (SaveRecord em produção na
competência 2099/12 → `ReadRecord` → `DeleteRecordByKey`): convocação-fantasma em chapa real é
problema trabalhista, não sujeira de tabela.

`enviarRm` só vai pro caminho direto com `ambiente=producao` e `dryRun=false`
(`auth-backend/src/clients/rm.ts`). Teste com `ambiente:"teste"` sai pela ponte AIONS. `dry_run`
não resolve a dúvida do código automático — sem persistir, não há código gerado pra observar.

## Estado inicial: `ESTADOCONVOCACAO = 4` (Concluída)

Definido pelo DP em 08/08/2026: a automação grava direto como **Concluída**, igual ao que eles fazem
hoje na mão (1278 de 1279 registros de 2026 estão em `4`). Não usar os estados `0/1/2`, que não
aparecem na base.

## Padrão de uso do DP (o que a automação precisa imitar)

- Período tipicamente **mensal** (`DTINIPRESTSERV` = 1º dia útil, `DTFIMPRESTSERV` = fim do mês),
  mas há períodos curtos (ex. 22/06→30/06).
- `DTCONVOCACAO` fica **~3 dias corridos antes** de `DTINIPRESTSERV` (ex. convoca 29/05, início
  01/06) — bate com a antecedência mínima do art. 452-A da CLT. A automação não deve gravar
  convocação com antecedência menor sem o DP saber.
- `DTRESPOSTA` vem preenchida junto (mesmo dia, minutos depois).

## Campos que só o `ReadRecord` mostra

`ReadView` devolve **só as colunas da view** (11: chaves, as 4 datas de convocação/período,
`ESTADOCONVOCACAO`, `INDLOCALPRESTACTRAB` e as 2 `DESC*`). `DTPREVPGTO` e `CODHORARIO` **não estão
lá** — concluir "0% preenchido" a partir do ReadView é falso negativo. Amostra de 6 registros
espalhados em 2026 via `ReadRecord`:

| Campo | Preenchido | Padrão |
|---|---|---|
| `DTPREVPGTO` | 6/6 | dia **05 do mês seguinte** ao fim da prestação |
| `CODHORARIO` | 3/6 | heterogêneo (`00004`, `000011`, `C0000`) |
| `INDINICIOHOR` | 3/6 | `1` sempre que há `CODHORARIO` |
| `PFCONVOCACAOPFPERFF` (filha) | **0/6** | o DP não preenche |

Como `DTPREVPGTO` não aparece na view, não se sabe se o DP digita ou se o RM deriva do período de
folha no save. Enviar um valor que o RM ia calcular sozinho é pior que omitir → **não enviamos por
default**; o helper existe pronto pra ligar depois do teste de gravação.

`DTRESPOSTA` está em **3746/3746** (igual à `DTCONVOCACAO` em 2461) → sempre enviar.

## Regra da data do ato (`DTCONVOCACAO`)

**Não é "hoje".** É **3 dias corridos antes de `DTINIPRESTSERV`** — art. 452-A da CLT, e é o que
2538 dos 3746 registros mostram. O DP data o documento pela regra mesmo lançando depois, então o
relógio não entra: `montarConvocacaoRm` é determinístico.

**Exceção da admissão** (regra do DP, 08/08/2026): se a pessoa foi admitida a menos de 3 dias do
início — mesmo dia, 1 ou 2 dias antes — três-dias-antes cairia **antes da admissão**, e no RM isso
não existe. Nesses casos a data do ato vira o **próprio início da prestação**. É o que produz os 514
registros com antecedência zero.

```
DTCONVOCACAO = (admissão até 2 dias antes do início) ? DTINIPRESTSERV : início − 3 dias
```

`calcularDataConvocacao()` devolve `motivo` (`antecedencia_padrao` | `admissao_recente` |
`sem_admissao` | `informada`) e `exigeConfirmacaoRm` (antecedência < 3). **Convocação antes da
admissão é erro que bloqueia** (`admissao_apos_inicio`): gravar criaria um S-2260 impossível.

Distribuição real da antecedência nos 3746: `3 dias` 2538 · `0` 514 · `4` 198 · `5` 126 · `6` 121 ·
`2` 78 · `7` 81 · `1` 51.

Os 51 registros com antecedência 1 e 78 com 2 **não** saem desta regra — seriam o resultado de
`max(início − 3, admissão)`. Confirmado com o Isaac em 08/08/2026: a regra é a **data de início**,
esses registros são variação histórica do lançamento manual, não regra a imitar. (Não daria pra
decidir pelos dados de qualquer forma: `FopFuncionarioData` **não é DataServer** —
`Unable to cast ... to IRMSDataServer` — então a admissão não sai por essa via.)

## Mensagem de confirmação — RESOLVIDO: não afeta a automação

Na tela do RM, antecedência abaixo de 3 dias abre uma confirmação ("quer prosseguir?"). **Via SOAP
isso não acontece**: teste de 08/08/2026 com `DTCONVOCACAO = DTINIPRESTSERV` (antecedência 0) gravou
com `SaveRecord OK`, sem Fault, sem aviso, `ESTADOCONVOCACAO=4`. A confirmação é da interface — o
web service não pergunta e não espera resposta.

Ou seja: **nada a auto-confirmar, nenhuma chave de `Contexto` a descobrir.** A automação passa
direto. Por isso também não sobra pendência sobre parâmetros de contexto (os únicos em uso no
projeto seguem `CODSISTEMA`, `CODCOLIGADA`, `CODUSUARIO`, `CODFILIAL`).

O `exigeConfirmacaoRm` do domínio continua útil — não como bloqueio, mas como **marcação no
relatório do lote**: mostra pro DP quais convocações saíram fora da antecedência legal.

Preparo que ficou de pé no caminho: o RM devolve Fault **com HTTP 200** (comprovado no `GetSchema`
de DataServer inválido) e `postSoap` extrai o `faultstring` nesse caso — antes virava um genérico
"sem `<XxxResult>`" e a mensagem real se perdia. Fault = `indeterminado: false` (o RM respondeu e
recusou, com rollback), diferente de timeout/5xx.

## Código implementado

| Arquivo | Papel |
|---|---|
| `auth-backend/src/domain/convocacaoRm.ts` | builder do XML + validação + antecedência + chave de idempotência + PK + parse do ReadView + regra de sobreposição. Puro, sem I/O nem env. |
| `auth-backend/src/domain/convocacaoRm.test.ts` | 26 testes |
| `auth-backend/src/services/convocacaoRm.ts` | pré-voo `ReadView` (lotes de 100 chapas) → `{aGravar, jaExistem, existentesNoRm}`. READ-ONLY. |
| `npm run rm:prevoo -- <ini> <fim> <chapas>` | CLI do pré-voo: mostra conflitos e o XML que **seria** gravado |

⚠️ **`chapaRm` é leniente de propósito** (tira ruído, zera à esquerda) — no filtro do pré-voo isso
era armadilha: `"3330' OR 1=1 --"` viraria `333011`, chapa de OUTRA pessoa; a consulta voltaria
vazia, o pré-voo diria "não existe" e o lote **duplicaria** a convocação. Por isso
`filtroReadViewConvocacao` e `lotesDeChapas` **rejeitam** chapa não-numérica em vez de normalizar.

| `auth-backend/src/routes/convocacaoRm.ts` | webhook do gatilho por contrato + `POST /api/convocacao-rm/previa` (read-only, admin/DP) |

Fluxo da gravação, na ordem que importa:

1. `classificarItensConvocacaoRm` — tira gatilho (sem chapa), já lançado, cancelada, dados inválidos;
   cancelamento parcial **trunca o fim** via `effectivePeriod`.
2. Pré-voo `ReadView` — tira quem o DP já lançou na mão.
3. `reservarEfeito` **antes** do SaveRecord. Morrer no meio deixa `pendente`, que na próxima passada
   vira `reserva_pendente` e pede conferência humana — em vez de gravar a convocação duas vezes.
4. `SaveRecord` → `confirmarEfeito(chave, pk, {pks, codConvocacao})`.
5. Grava o `C03S######` de volta no item do Monday. Falhar aqui não desfaz o RM: o estado vira
   `gravado_monday_pendente` e o ledger é quem impede a regravação.

Um item que falha **não derruba o lote** — chave e resultado são por pessoa.

### Monday — ✅ provisionado em 08/08/2026 (board `18418191275`, competência 2026-08)

`npm run monday:provisionar-convocacao-rm` (idempotente; sem `--confirmar` só mostra o plano):

| O quê | Id | Para quê |
|---|---|---|
| Coluna `Código Convocação RM` | `text_mm618vv8` | recebe o `C03S######`. **Sem ela a rota se recusa a rodar** — gravar no RM sem rastro na tela deixa o registro sem caminho de volta |
| Coluna `Lançar no RM` | `color_mm61abdf` | gatilho, labels `AGUARDANDO`/`LANÇAR` |
| Grupo `LANÇAR NO RM (por contrato)` | `group_mm6189ne` | 9 itens, um por contrato, com `Op - Contrato` e **sem chapa** |

O script re-registra colunas/grupos em `board_colunas`/`board_grupos` no fim: a rota resolve por
título a partir do registry, então coluna criada e não registrada é coluna que a rota não vê.

⚠️ **Dedup dos itens de gatilho é por GRUPO, não por board.** O board já tinha itens chamados
`DETRAN`, `CETAM`, `SEMSA`, `SEDUC ESCOLA`, `SEDUC INTERIOR` no grupo *Acompanhamento de Fechamento*
(rastreio do mensal, contrato vazio). Deduplicar pelo board inteiro deixaria 5 contratos sem gatilho.

### Títulos de coluna DERIVARAM entre cópias do board

No board de 2026-08 a coluna de status da convocação se chama **`Status`** (não "Status Convocação")
e a data de cancelamento é **`inicio do cancelamento`** (não "Cancelamento Início"). Por isso cada
campo tem lista de títulos candidatos (`resolverColunas`), e `statusConvocacao`/`cancelamentoInicio`
são **obrigatórios**: sem o status, convocação cancelada vira convocação no RM; sem a data do
cancelamento, a parcial vai com o período inteiro.

### `Admissão` é coluna text em `DD/MM/YYYY`

As datas de período são colunas *date* (Monday devolve ISO), mas `Admissão` é *text* preenchida à
mão em pt-BR. Tratar tudo como ISO reprovou **13 de 13** do DETRAN com `data_admissao_invalida`.
`paraDataIso()` aceita os dois formatos — e importa mais do que parece: sem a admissão, a regra dos
3 dias perde o piso e a data do ato pode cair antes da admissão.

### Prévia real (08/08/2026, competência 2026-08)

| Contrato | Seria gravado | Pulados |
|---|--:|---|
| SEMSA | 49 | gatilho |
| CETAM | 19 | gatilho, 1 **cancelada**, 1 sem período |
| DETRAN | 13 | gatilho |
| SEDUC ESCOLA | 8 | gatilho, 1 sem período |
| TRE PB | 2 | gatilho |
| SEDUC INTERIOR | 2 | gatilho |
| ADMINISTRATIVO | 1 | gatilho |
| SEDUC SEDE | 0 | gatilho |
| URUGUAIANA | 0 | gatilho |
| **total** | **94** | |

Nenhum com antecedência abaixo de 3 dias. O filtro de cancelada se provou em dado real (CETAM
`007393`). Pré-voo não achou nada já no RM — o DP ainda não lançou agosto à mão.

### Webhook — ✅ criado em 08/08/2026

`npm run monday:webhook-convocacao-rm` (sem `--confirmar` só confere). Webhook **`620479439`**,
board `18418191275`, evento `change_specific_column_value` na coluna `Lançar no RM`
(`color_mm61abdf`) → `POST /api/monday/convocacao-rm`.

O script confere o handshake **antes** de pedir o webhook: o Monday exige que a URL responda
`{challenge}` no ato da criação, e endpoint fora do ar faz o `create_webhook` falhar com cara de
erro do Monday. Idempotente — webhook cujo `config` já aponta pra mesma coluna não é recriado
(duplicado faria o lote do contrato disparar duas vezes; o ledger seguraria a gravação, mas o
relatório viria dobrado).

**Testado ponta a ponta com a flag desligada:** status do item `SEDUC INTERIOR` posto em `LANÇAR` →
chamada chegou de `185.237.4.4` (Monday, não a máquina do dev), 200 em 685ms, resolveu o contrato e
parou no gate. Os 2 candidatos do contrato seguiram **sem** `Código Convocação RM`, ou seja nada foi
gravado no RM. Status devolvido pra `AGUARDANDO`.

### Deploy: produção NÃO sai da branch `vercel-deploy`

`vercel-deploy` está 64 commits atrás e não é usada. Produção é `codigo-principal` promovida por CLI
— push do GitHub gera só **preview** (`target: null`); os deploys `target: production` do histórico
foram todos feitos por CLI.

Caminho usado aqui, que preserva o conteúdo commitado:

```bash
npx vercel promote <url-do-preview> --yes
```

⚠️ **Não** use `vercel deploy --prod` nesta máquina: ele sobe o **working tree**, e é isso que os
deploys antigos com `gitDirty: 1` fizeram — WIP de outra sessão iria pra produção junto.

Falta só ligar `CONVOCACAO_RM_HABILITADA=1` no projeto da Vercel.

## Pegadinhas de transporte

- `SOAPAction` entre aspas, senão o RM responde `500 ContractFilter mismatch` (parece erro de
  credencial e não é).
- `GetSchema` e `ReadView` devolvem o XML **HTML-escapado** — desescapar antes de qualquer regex,
  senão dá falso "nenhum registro".
- No XSD, campo `string` **não traz `type=`**: ele abre um `xs:simpleType` aninhado só pro
  `maxLength`. Quem separa tabela de campo é a tag seguinte (`xs:complexType` vs `xs:simpleType`).
- PK composta vai separada por `;` na ordem do XSD (`3;003330;C03S003328`). Em DataServer de PK
  única (ex. `ZMDHSTBENFUNC`) vai só o valor, sem a coligada na frente.
- O RM **omite campos nulos** na leitura; fazer o mesmo na escrita. Tag vazia em campo de data é
  pedido de erro de conversão.
