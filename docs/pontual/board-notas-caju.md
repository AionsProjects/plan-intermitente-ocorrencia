# Board "Notas e Relatórios Caju"

Registro de UM item por **pedido na Caju** (crédito e boleto em linhas separadas), com o link do
resumo na Caju, da nota de débito, do relatório em PDF e da pasta no Drive.

Por que board novo e não colunas na Solicitação de Pagamento:

- a Solicitação **só é criada quando há boleto**, e a maioria dos pontuais é só crédito — o pedido
  de crédito não tinha registro em lugar nenhum;
- a célula de pedido da Solicitação é a lista "pague isto" do DP. Misturar id de crédito ali
  convida alguém a pagar um pedido que não é boleto.

## Colunas

O nome é o contrato: o backend resolve tudo pelo **título** da coluna (via `pi.board_colunas`) e
formata o valor conforme o **tipo** real. Coluna com nome diferente é pulada e reportada no log
(`colunas ausentes no board: …`) — não derruba o registro do pagamento.

| Coluna | Tipo | Conteúdo |
|---|---|---|
| *(nome do item)* | — | `CRÉDITO - MARIA DA SILVA - 01/08/2026` |
| `Pedido Caju` | Text | id do pedido — é a chave de conferência com o extrato |
| `Natureza` | Status | `CRÉDITO` / `BOLETO` |
| `Benefício` | Dropdown | `VR`, `VT` (pedido do pontual leva os dois → duas labels) |
| `Origem` | Status | `PONTUAL` / `MENSAL` |
| `Contrato` | Dropdown | contrato |
| `Colaborador` | Text | vazio no mensal: lá o pedido é do contrato |
| `Chapa` | Text | |
| `Data Início` | Date | |
| `Data Fim` | Date | |
| `Valor` | Numbers | valor daquele pedido |
| `Resumo Caju` | Link | painel da Caju do pedido |
| `Nota de Débito` | Link | só em `CRÉDITO`, e só com `CAJU_NOTA_URL` configurada |
| `Relatório` | Link | PDF em `RELATORIOS/` na pasta da convocação |
| `Pasta Drive` | Link | pasta da convocação/competência |
| `IDFINANC` | Text | `VR 24278; VT 24279` — só na linha do BOLETO |
| `Solicitação` | Link | item da Solicitação — só na linha do BOLETO |
| `Status` | Status | nasce `GERADO`; daí em diante é do DP |

Gaveta (grupo) = mês de **caixa**, formato `AGOSTO/26` (o mesmo da Solicitação). Criada sozinha.
Labels de status/dropdown também nascem sozinhas (`create_labels_if_missing`) — não precisa
cadastrar `CRÉDITO`, `BOLETO`, contrato nem `GERADO` à mão.

⚠️ **O usuário do `MONDAY_TOKEN` precisa ser membro/owner do board.** Board privado onde o token é
só *subscriber* responde `403 UserUnauthorizedException` no `create_item` — foi o que aconteceu com
o Controle Saldo Caju (`7833600425`).

## Ativar

```bash
curl -X POST https://plan-intermitente-ocorrencia.vercel.app/api/boards/registrar \
  -H 'Content-Type: application/json' -b "pi_sess=<sessão de admin>" \
  -d '{"monday_board_id":"<id do board>","papel":"notas_caju"}'
```

Enquanto o board não estiver registrado, o step `monday_notas` **pula** (`board_nao_registrado`) e
o pagamento segue normal — nada de derrubar dinheiro por causa de um board de consulta. Depois de
registrar, o back-fill recupera o que faltou:

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

## Relatório em PDF

`RELATORIOS/relatorio-pagamento-<origem>-<quem>-<data>.pdf` na pasta da convocação. Uma folha (A4
em pé no pontual, paisagem no mensal, que leva tabela de N pessoas) com: identificação, tabela de
valores (apurado × desconto × líquido × crédito × boleto por benefício), pedidos na Caju com os
links, IDFINANC/Solicitação/pasta e as dívidas abatidas com link do item.

O rodapé diz, sempre: **"Documento gerado pela automação — não é a nota de débito da Caju."** Sem
essa ressalva um documento nosso com cara de oficial vira nota fiscal na mão de quem só bate o olho.

Conferência sem escrever nada (admin ou DP):

```
GET /api/pontual/relatorio/<item_id>
```
