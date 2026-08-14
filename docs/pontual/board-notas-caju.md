# Board "Notas e Relatórios Caju"

Registro de UM item por **pedido de CRÉDITO na Caju**, com o link do resumo na Caju, da nota de
débito, do relatório em PDF e da pasta no Drive.

**Escopo: só o crédito.** O boleto continua na Solicitação de Pagamento — é de lá que o DP paga, e
duplicá-lo aqui criaria duas listas de "pague isto".

Por que o crédito precisou de board próprio:

- a Solicitação **só é criada quando há boleto**, e a maioria dos pontuais é só crédito — o pedido
  de crédito não tinha registro em lugar nenhum;
- a célula de pedido da Solicitação é a lista "pague isto" do DP. Misturar id de crédito ali
  convida alguém a pagar um pedido que não é boleto.

O **layout abaixo é o completo** — inclui `IDFINANC` e `Solicitação`, que só um boleto preenche. É
de propósito: quando a parte do boleto for feita, ela reusa o mesmo builder
(`linhasNotaDeRelatorio(dados, { naturezas: ["CRÉDITO", "BOLETO"] })`) e o mesmo desenho de
colunas, sem um segundo formato pra manter. Hoje `NATUREZAS_NO_BOARD = ["CRÉDITO"]`.

## O board

**`18426593215`** — [abrir](https://contato-serv.monday.com/boards/18426593215). Workspace
DEPARTAMENTO PESSOAL, na pasta da Solicitação de Pagamento. Criado e registrado em 14/08 por
`scripts/criar-board-notas-caju.ts`.

## Colunas

O board tem UM trabalho: abrir a linha, baixar o PDF da nota e anexar na pasta do Drive. Nasceu com
17 colunas e foi enxugado pra 6 em 14/08 (decisão do Isaac) — o que não serve a esse trabalho saiu
do board E do código, porque coluna que o código escreve e não existe acende
"colunas ausentes no board" em todo pagamento.

| Coluna | Tipo | Conteúdo |
|---|---|---|
| *(nome do item)* | — | `CRÉDITO VR+VT - MARIA DA SILVA - 01/08/2026` |
| `Colaborador` | Text | vazio no mensal: lá o pedido é do contrato |
| `Contrato` | Dropdown | |
| `Data Início` | Date | é o que permite filtrar e pegar as do dia |
| `Nota de Débito` | Link | o PDF pra baixar — só com `CAJU_NOTA_URL` configurada |
| `Resumo Caju` | Link | painel da Caju do pedido, pra chegar lá quando o link direto falhar |
| `Pasta Drive` | Link | onde anexar |

O **benefício vai no NOME** do item, não em coluna: um pagamento pode ter dois pedidos de crédito
(o formato até 13/08, e o mensal, separam VR de VT), e sem isso as duas linhas ficam idênticas na
lista — foi o que aconteceu quando `Benefício` e `Valor` saíram.

Saíram do board: `Pedido Caju`, `Natureza`, `Benefício`, `Origem`, `Chapa`, `Data Fim`, `Valor`,
`Relatório`, `IDFINANC`, `Solicitação`, `Status`. `IDFINANC` e `Solicitação` só existem em BOLETO e
o board leva só CRÉDITO — nasciam vazias. O resto é conferência, e conferência vive no `/atividade`,
no PDF do relatório e em `payload_resumo`.

```bash
node --env-file=.env --import tsx src/scripts/enxugar-board-notas-caju.ts --aplicar
```

Deriva o que apagar do que o código escreve (nada de segunda lista pra manter em sincronia) e
re-sincroniza o registry no fim.

Gaveta (grupo) = mês de **caixa**, formato `AGOSTO/26` (o mesmo da Solicitação). Criada sozinha.
Labels de status/dropdown também nascem sozinhas (`create_labels_if_missing`) — não precisa
cadastrar `CRÉDITO`, `BOLETO`, contrato nem `GERADO` à mão.

⚠️ **O usuário do `MONDAY_TOKEN` precisa ser membro/owner do board.** Board privado onde o token é
só *subscriber* responde `403 UserUnauthorizedException` no `create_item` — foi o que aconteceu com
o Controle Saldo Caju (`7833600425`).

## Ativar — já feito

```bash
node --env-file=.env --import tsx src/scripts/criar-board-notas-caju.ts --aplicar
```

Cria o board (ou reusa o existente pelo NOME e só cria a coluna que falta, avisando quando o tipo
de uma coluna existente divergir), grava no registry com `papel=notas_caju` e confere no fim que
`montarValuesItemNota` acha todas as colunas do contrato. Rodar duas vezes não duplica nada.

Board não registrado NÃO é erro: o step `monday_notas` pula com `board_nao_registrado` e o
pagamento segue normal — nada de derrubar dinheiro por causa de um board de consulta.

Os 9 pagamentos anteriores (14 linhas: os 5 do formato antigo rendem 2 cada, os 4 novos 1) entraram
por:

```bash
node --env-file=.env --import tsx src/scripts/backfill-notas-caju.ts --aplicar
```

Ele **não sobe o PDF** — a credencial do Drive só existe na Vercel —, então `Relatório` fica vazio
nessas linhas históricas. Para um pagamento específico, COM o PDF:

```bash
curl -X POST .../api/pontual/notas/<item_id_da_convocacao> -b "pi_sess=<admin>"
```

## Nota de débito

O link é **montado**, não buscado: a API da Caju não expõe o documento, e o pedido de crédito do
pontual só é confirmado à mão no painel — a nota nasce depois que a automação terminou. Gravar o
link na hora resolve isso sem varredura: ele fica de pé assim que o DP confirma.

Template em env (`CAJU_NOTA_URL`), com `{orderId}`:

```
CAJU_NOTA_URL=https://.../order/{orderId}/...
```

Sem template a coluna nasce vazia e o PDF diz, no lugar do link, que a nota sai do painel. Está em
env e não no código porque o padrão foi descoberto no painel e pode mudar sem aviso — trocar env
não exige deploy. Template sem `{orderId}` é ignorado (geraria a mesma URL pra todo pedido).

## Pastas no Drive

Três pastas, e só três, dentro da pasta do dono do pagamento (pedido do Isaac, 13/08):

```
CAJU/          boleto TXT (com o PIX copia-e-cola) + QR PNG + comprovante técnico TXT
CONFERENCIA/   conferencia-<itemId>.xlsx
OUTROS/        nota de débito e Relatório-de-pedidos da Caju (subidos à mão),
               relatorio-pagamento-*.pdf (automação), termos de convocação/insalubridade
```

**PONTUAL** — o dono é a PESSOA, e há uma pasta por convocação (a mesma pessoa é convocada
várias vezes no mesmo mês):

```
<raiz>/2026/08 - AGOSTO/CONTATO/11.02 - SEDUC INTERIOR/INTERMITENTE - PONTUAL/
  └── LUAN VICTOR SOARES DA FONSECA/
       └── 13 A 19 08 2026/          ← período da convocação
            └── CAJU/ · CONFERENCIA/ · OUTROS/
```

**MENSAL** — o dono é o CONTRATO. Sem nível de pessoa (o pedido Caju é do contrato inteiro) e
**sem nível de período**: há um pagamento por competência e a competência já está no `08 - AGOSTO`
do caminho, então o período seria uma pasta repetindo o que o avô já diz.

```
<raiz>/2026/08 - AGOSTO/CONTATO/85 - SEMSA/INTERMITENTE - MENSAL/
  └── MENSAL - SEMSA/
       └── CAJU/ · CONFERENCIA/ · OUTROS/
```

O legado do n8n dividia o mensal por RODADA (`MENSAL ` para o boleto, `3 DIAS CREDITO ` para o
crédito, ambos com espaço no fim do nome e arquivos soltos dentro). Essas pastas param de receber
coisa nova; o conteúdo delas fica onde está.

⚠️ **Espaço no fim do nome** era uma bomba: `ensureFolder` acha por nome EXATO e o nosso
`sanitizeName` faz `trim`, então numa pasta criada pelo n8n com espaço o código não achava e criava
uma SEGUNDA — os arquivos do mês rachavam entre as duas, calados.
`scripts/corrigir-nome-pastas-drive.ts` renomeia (dry-run por padrão); renomear preserva id, url e
conteúdo, então os links já gravados no Monday continuam valendo.

- `CONFERENCIA` **sem acento**: é o nome que já existe em produção com a planilha dentro, e
  `findFolder` casa por nome exato — `CONFERÊNCIA` criaria uma segunda pasta.
- A pasta do período (pontual) chama-se `13 A 19 08 2026`, não `13 A 19/08/2026`: `sanitizeName` troca `/`
  por espaço (nome de arquivo/pasta não aceita barra em vários contextos).
- **Nada fica solto** na raiz do período — o default é `OUTROS`.
- `ATESTADOS/` é a única exceção: pendura na PESSOA, um nível acima. Atestado cobre dias, não um
  período de convocação; escolher uma das convocações que ele atravessa seria arbitrário.
- `CAJU` é plana. Até 13/08 havia `CAJU/BOLETOS` e `CAJU/COMPROVANTES`; elas param de receber, e
  o que já está lá **não foi movido**.

Conferir a árvore sem abrir o navegador (a credencial do Drive só vive na Vercel):

```
GET /api/drive/arvore?pasta=<id>&nivel=4     (admin/DP, só leitura)
```

## Relatório em PDF

`OUTROS/relatorio-pagamento-<origem>-<quem>-<data>.pdf` na pasta da convocação. Uma folha (A4
em pé no pontual, paisagem no mensal, que leva tabela de N pessoas) com: identificação, tabela de
valores (apurado × desconto × líquido × crédito × boleto por benefício), pedidos na Caju com os
links, IDFINANC/Solicitação/pasta e as dívidas abatidas com link do item.

O rodapé diz, sempre: **"Documento gerado pela automação — não é a nota de débito da Caju."** Sem
essa ressalva um documento nosso com cara de oficial vira nota fiscal na mão de quem só bate o olho.

Conferência sem escrever nada (admin ou DP):

```
GET /api/pontual/relatorio/<item_id>
```
