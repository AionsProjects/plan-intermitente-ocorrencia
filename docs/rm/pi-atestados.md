# PI ATESTADOS — consulta registrada no RM

Sentença colável: [`sql-pi-atestados.sql`](sql-pi-atestados.sql). **Nenhum comentário dentro do arquivo, de propósito** — a explicação toda mora aqui.

## Como cadastrar

TOTVS RM → **Gestão → Consultas SQL** → novo.

| Campo | Valor |
|---|---|
| Código | `ATESTADO_INTER` |
| Título | `intermitente atestado` |
| Aplicação | RM Labore |
| Sistema | `P` |
| Coligada | `3` |

Parâmetros (o RM detecta sozinho ao ler a sentença — não há aba de declaração):

| # | Parâmetro | Exemplo | Observação |
|---|---|---|---|
| — | `:$CODCOLIGADA` | — | variável dinâmica do RM, injetada pelo backend |
| 1 | `:CHAPA` | `006824` | é `LIKE` |
| 2 | `:DATA_INICIAL` | `2026-08-01` | |
| 3 | `:DATA_FINAL` | `2026-08-31` | |

## ⚠️ A ORDEM DOS PARÂMETROS É O CONTRATO

**O RM casa parâmetro por POSIÇÃO na querystring, não por nome.** Medido em 10/08/2026, e é o tipo de bug que não dá erro nenhum:

| Chamada | Linhas |
|---|---|
| `DATA_INICIAL=2026-08-01, DATA_FINAL=2026-08-31` | 6 |
| mesmos valores, **ordem invertida na URL** | **24** |
| `DATA_INICIAL=2026-12-31, DATA_FINAL=2026-08-01` (janela invertida) | 24 |

A primeira versão registrada pedia `:DATA_FINAL` antes de `:DATA_INICIAL` no WHERE. Resultado: os valores entravam trocados, o predicado virava *"atestados que cobrem a janela inteira"* — o **complemento** do que se queria — e a consulta devolvia menos linhas, em silêncio. Uma janela maior chegava a devolver **menos** que uma menor, que é a assinatura do problema.

Por isso, na sentença, `:DATA_INICIAL` aparece **antes** de `:DATA_FINAL`. Se editar o WHERE, mantenha essa ordem — ou inverta também a ordem das chaves em `consultaPadrao` ([`ausenciasRm.ts`](../../auth-backend/src/services/ausenciasRm.ts)), onde há um teste travando isso.

Duas redes de segurança:

- **Guarda no serviço**: ausência que não cruza a janela pedida vira erro, não filtro silencioso. Pega o caso "veio lixo a mais".
- **Canário no CLI**: `rm:atestados` pergunta as duas ordens e avisa se a invertida trouxer mais. Pega o caso "veio de menos", que a guarda não vê.

Consumidor: [`auth-backend/src/services/ausenciasRm.ts`](../../auth-backend/src/services/ausenciasRm.ts). O código da consulta é configurável por `RM_SQL_ATESTADOS` — se o DP renomear, muda a env, não o código.

Conferir antes de ligar a flag:

```bash
cd auth-backend && npm run rm:atestados -- 2026-08-01 2026-08-31 006824 --cruas
```

## Por que a sentença é assim

Uso: partir uma convocação em pedaços. Convocação 05→20 com atestado 10→11 vira 05→09 e 12→20, porque dia coberto por atestado não é dia convocado — afirmar que é gera um S-2260 errado.

Sobre a consulta base do DP, seis correções:

1. **Interseção**, não `DTINICIO BETWEEN`. A base perguntava "o atestado *começou* na janela?". Um atestado de 28/07 a 05/08 não começou em agosto — e é justo ele que cobre os primeiros dias de uma convocação de agosto. Sumia calado.
2. **`COALESCE(DTFINAL, DTINICIO)`**. Atestado de 1 dia pode vir com fim nulo, e `NULL >= x` é UNKNOWN: a linha some, justo no caso mais comum.
3. **`CODSITUACAO` e `CODCATEGORIAESOCIAL` viram coluna, não filtro.** Filtro só consegue *remover* linha. Categoria eSocial errada no cadastro esconderia o atestado, e a automação convocaria por cima de dia coberto — em silêncio, com evento já transmitido.
4. **`VTIPOATESTADO` vira LEFT JOIN; `PFCOMPL` e `PSECAO` saem.** INNER em tipo faz o atestado sumir quando o tipo não está cadastrado; `PFCOMPL`/`PSECAO` não contribuem nenhuma coluna aqui — só têm o poder de perder linha.
5. **`VCID` sai inteiro.** Diagnóstico não é necessário para partir período e não deve trafegar entre sistemas.
6. **Aliases ASCII e datas em `CONVERT(...,120)`.** Chave acentuada já chegou corrompida neste projeto; lookup que falha calado vira "zero ausências", que é o resultado perigoso.

`HORAINICIO`/`HORAFINAL` saem **crus** (minutos desde 00:00). Quem decide o que é dia cheio é o código — a regra muda sem mexer na consulta registrada.

## O que a fonte tem de verdade (medido 10/08/2026)

Amostra do ano de 2026 inteiro, coligada 3: **1649 atestados**, dos quais **81 de intermitentes** (`COD_CATEGORIA_ESOCIAL = 111`). 2025: 2115 / 63.

- **Atestado curto existe** — em agosto/2026: 8 de 1 dia, 3 de 2–3 dias. É o caso do DP (10→11), e era a dúvida que justificava conferir antes de ligar a flag.
- **Horas**: `0..0` (1444×) e `0..1440` (202×) — ambos dia cheio. **Meio período existe e é raro**: `647..960`, `625..1020`, `542..960` (3 casos em 2026). Esses **não** quebram a convocação, que é o certo.
- **Datas** chegam como `YYYY-MM-DD` (efeito do `CONVERT(...,120)`), então nada de `new Date()` no meio do caminho.
- Uma pessoa pode ter **vários atestados** no período (ex.: chapa `006448`, três em 2026, incluindo maternidade de 4 meses). `quebrarPeriodoPorAusencias` já trata sobreposição e ordena.
- `COD_SITUACAO` traz `A`, `E`, `P`, `F`, `D` (inclusive demitido). Vem como coluna e **não** filtra — ver correção nº 3.

`CAST(...)` está sobre a **coluna**, nunca sobre o parâmetro: é o que permite comparar com `'YYYY-MM-DD'` mesmo se `DTINICIO` tiver hora, sem embrulhar `:PARAM` em função.

## Se o cadastro falhar

O RM mostra `Exception has been thrown by the target of an invocation.` — wrapper genérico de reflexão .NET, que **não diz nada** sobre a causa.

**Antes de qualquer outra coisa: clique em `Detalhes` no diálogo e leia a `InnerException`** (ou o log do `RM.Host` / Event Viewer da estação). Um InnerException encerra a triagem inteira e torna o resto desta seção desnecessário.

Sem isso, bisecção — uma variável por vez:

**Passo 1 — a sentença é culpada?** Com Código e Título preenchidos, cole:

```sql
SELECT TOP 10 PFUNC.CHAPA AS CHAPA, PFUNC.NOME AS NOME
FROM PFUNC
WHERE PFUNC.CODCOLIGADA = :$CODCOLIGADA
  AND PFUNC.CHAPA LIKE :CHAPA
```

Se **isso** falhar, a sentença é inocente: é ambiente (License Server / `fipsalgorithmpolicy` — é a única fonte TOTVS que traz essa string exata em Linha RM) ou permissão de perfil. Pare de editar SQL.

**Passo 2 — `CAST` no WHERE.** Troque as duas linhas do `CAST` por comparação direta:

```sql
  AND VATESTADO.DTINICIO <= :DATA_FINAL
  AND COALESCE(VATESTADO.DTFINAL, VATESTADO.DTINICIO) >= :DATA_INICIAL
```

Se passar, a causa era o `CAST`. Custo: se `DTINICIO` tiver hora, perde-se atestado que começa no último dia — mande `DATA_FINAL` com `23:59:59`.

**Passo 3 — sufixo de tipo no parâmetro.** Renomeie para `:DATA_INICIAL_D` / `:DATA_FINAL_D` / `:CHAPA_S` (`_D` data, `_S` string, `_N` numérico). A doc TOTVS escopa essa recomendação a *base de dados externa* — esta roda na base própria, então é o suspeito mais fraco, mas é barato. Se resolver, atualize `RM_SQL_ATESTADOS` e os nomes em `ausenciasRm.ts`.

Também barato, se o Código for recusado: a doc TOTVS diz que o campo Código *"não permite caracteres especiais como `?>-`"*. `PI ATESTADOS` segue o precedente do `BEN 2` (que tem espaço e funciona), mas se der problema use `PIATESTADOS` e ajuste a env.

## Restrições do cadastro que valem para qualquer consulta futura

Documentadas pela TOTVS ([criação de consultas SQL](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360004646072)):

- O parser do RM é **mais restrito que o do banco**. SQL que roda no SSMS pode não salvar aqui.
- **Evitar comentários dentro de cláusulas**; se precisar comentar, use um bloco `/* */` antes ou depois da sentença. Nunca parênteses dentro do comentário. *(Foi o que derrubou a primeira versão deste arquivo: comentário dentro do SELECT e do WHERE.)*
- **Nada de aspas duplas em alias.**
- Só `SELECT` — `ALTER`/`DELETE`/`DROP`/`INSERT`/`UPDATE` são bloqueados, e `EXEC`/`EXECUTE` desde a 12.1.2302.
- O RM **recupera o schema da consulta ao salvar** (validação de campos por perfil/usuário). Coluna inexistente quebra no Salvar, não no Executar — foi por isso que `RECCREATEDBY`/`RECCREATEDON`/`RECMODIFIEDON` saíram: não são consumidas pelo código e não valia arriscar que não existam em `VATESTADO`.
- Timeout padrão de 120s (`DBSCommandTimeout` nos `.config`).
