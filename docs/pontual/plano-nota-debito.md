# Nota de débito do crédito Caju — plano

Pedido do DP (09/2026): quando o intermitente pontual é pago **via crédito Caju**, a **nota de
débito** tem que ser salva na pasta da convocação no Drive, como o relatório já é.

Este documento é o plano. Ele **não** é executável ainda: duas decisões de negócio e uma medição
estão abertas, e as três mudam qual arquitetura vale a pena.

> **Atualização 24/09/2026 — Bloqueio A resolvido, decisão 1 tomada.** O Isaac decidiu que a
> automação confirma o crédito: `etapaPedidoCaju` passou a chamar `confirmarPedido`
> (`EXISTING_BALANCE`) também no crédito, e o sábado extra virou crédito confirmado. A nota de
> débito passa a existir no fim da própria execução. Continua aberto: P1 (o que o GET do pedido
> devolve) e `CAJU_NOTA_URL` em produção — a coluna `Nota de Débito` estava vazia nas 40 linhas
> lidas em 24/09. O mensal **não** mudou: segue deixando o crédito em Rascunho.

---

## 1. O que já existe (e o que falta)

| Peça | Estado |
|---|---|
| Pasta `OUTROS/` na convocação | **pronta** — criada mesmo vazia, exatamente pro DP soltar a nota (`driveArquivar.ts`) |
| Upload de arquivo pra `OUTROS/` | **pronto** — `arquivarDrivePontual` com `tipo: "outro"` ou `"relatorio"` |
| Board "Notas e Relatórios Caju" (`18426593215`) | **pronto** — 1 linha por pedido de crédito, com coluna `Nota de Débito` (link) |
| Link da nota | **montado, não buscado** — `notaDebitoUrl()` aplica o template `CAJU_NOTA_URL` sobre o `orderId` |
| Back-fill de um pagamento | **pronto** — `POST /api/pontual/notas/:itemId` (admin) |
| **O PDF da nota** | **não existe no fluxo** — hoje o DP baixa do painel e sobe à mão |

Ou seja: o encanamento inteiro está de pé. O que falta é **obter o arquivo**.

---

## 2. Os dois bloqueios reais

### Bloqueio A — o pedido de crédito do pontual nunca é confirmado (RESOLVIDO em 24/09/2026)

`etapaPedidoCaju` (`workflows/pontual.ts`) só chama `confirmarPedido` quando `tipo === "boleto"`.
O pedido de crédito é **criado e deixado em Rascunho, de propósito** — herança do `HTTP Request5`
que ficava DISABLED no WF5.

**Sem confirmação não existe nota de débito.** Não é um problema de código: é que o documento
ainda não foi emitido quando a automação termina.

Ao mesmo tempo, o step `monday_controle_caju` **já registra o débito** do crédito no board de
Controle Caju, isto é, o processo trata o saldo como consumido. Os dois fatos juntos não fecham —
e é a primeira pergunta da §5.

### Bloqueio B — não sei o que a API expõe, e não consigo medir daqui

Nosso cliente Caju (`clients/caju.ts`) tem **cinco** chamadas: token, `employee` por CPF,
`POST allowance_order`, `PATCH allowance_order/{id}` (confirmar) e `GET allowance_order/{id}`.
Nenhuma de documento.

O comentário do código afirma que "a API não expõe o documento". **Essa afirmação não está
verificada** — as credenciais da Caju não existem no `.env` local (só na Vercel), então o
`GET allowance_order/{id}` de um pedido confirmado não pôde ser inspecionado nesta sessão.

Medir isso é barato e muda tudo. Ver §3.

---

## 3. Passo zero: medir antes de escolher arquitetura

Duas provas, as duas read-only, antes de escrever qualquer linha de produção.

**P1 — o que o GET do pedido devolve.** Rodar `buscarPedido(orderId)` sobre um pedido
**confirmado** e listar as chaves do retorno, procurando `invoice`, `document`, `nota`, `receipt`,
`file`, `url`. Se qualquer uma existir com um link de PDF, o caminho A da §4 está aberto e o resto
deste documento encolhe para meia página.

Como rodar, escolher um:
- Isaac roda o script local com as credenciais da Caju no `.env`; ou
- sobe uma rota `GET /api/caju/diagnostico` admin-only e read-only, no molde da
  `/api/rm/diagnostico` que já existe, e roda contra produção.

**P2 — como o painel entrega a nota.** Isaac abre uma nota de débito no painel da Caju e copia a
URL do download. O que ela for decide o custo:
- URL assinada e pública (expira, mas baixa sem cookie) → barato;
- endpoint autenticado por token da API → provavelmente o caminho A;
- download preso à sessão do navegador → caminho B, o caro.

---

## 4. Os três caminhos

### Caminho A — a API entrega o documento

O step do Drive baixa o PDF e sobe em `OUTROS/`, junto do relatório que já sobe hoje. Sem login,
sem credencial nova, sem scraping. Chave de efeito própria, retomada normal.

Ainda depende do Bloqueio A: só existe nota para pedido confirmado.

**Custo:** baixo. É um `fetch` + um item a mais na lista de arquivos de `arquivarDrivePontual`.

### Caminho B — varredura posterior, com login no painel

Um job diário varre as linhas do board de Notas com `Nota de Débito` preenchida e sem arquivo no
Drive, abre o painel autenticado, baixa o PDF e arquiva.

Resolve o Bloqueio A sem mexer em regra de dinheiro: roda **depois** de o DP confirmar, que é
quando a nota passa a existir.

**Custo:** alto, e o custo não é o código. É uma **credencial de login de painel** — classe que
não existe hoje no projeto (tudo é API com token de parceiro), que quebra quando a Caju mudar o
HTML, e que exige navegador headless em runtime serverless. Só vale se P2 mostrar que não há
outra porta.

### Caminho C — não baixar: fechar o ciclo no humano

É o desenho atual, levado a sério. O board de Notas foi criado **exatamente** com esse trabalho:
"abrir a linha, baixar o PDF da nota e anexar na pasta do Drive". Falta:

- `CAJU_NOTA_URL` configurada em produção (a conferir — não está no `.env` local), senão a coluna
  `Nota de Débito` nasce vazia e o board não serve pra nada;
- a linha carregar o link da **pasta do Drive** da convocação — ela já tem a coluna `Pasta Drive`;
- um jeito de marcar "anexei", pra saber o que falta.

**Custo:** quase zero. **Não** entrega o que o DP pediu (continua manual), mas é o piso que faz o
pedido virar 2 cliques em vez de uma caçada.

---

## 5. Decisões abertas

1. **Quem confirma o pedido de crédito do pontual hoje?** Se o DP confirma à mão no painel, o
   caminho B é natural e nada de dinheiro muda. Se ninguém confirma, então ou não existe nota
   nenhuma para salvar, ou a automação passa a confirmar — e aí é mudança de regra
   `#dinheiro-real`, com risco de pagar duas vezes o que o DP paga à mão.

2. **Que automação de "salvar relatórios Caju" é a referência?** O pedido cita uma que já entraria
   no Caju, baixaria o documento e salvaria no Drive. **Não a encontrei** — nem no repositório, nem
   no Brain, nem nos backups de workflow do n8n. O `relatorio-pagamento-*.pdf` que sobe hoje é
   **gerado por nós** (`relatorioPagamento.ts`), não baixado da Caju. Se ela existe em outro lugar,
   é dela que sai a resposta do P2 de graça.

3. **`CAJU_NOTA_URL` está setada em produção?** Se não estiver, a coluna `Nota de Débito` está
   vazia em todas as linhas do board desde 14/08 — e o caminho C já começa quebrado.

---

## 6. Ordem recomendada

```
P1 + P2 (medir)  →  decisão 1 (confirmar o crédito?)  →  caminho A, B ou C
```

Não implementar nada antes de P1. A diferença de custo entre A e B é de uma tarde para uma
semana, e é uma chamada HTTP read-only que decide qual dos dois é.
