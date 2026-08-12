# G3 — Bifurcação (split de convocação) no RM

Fecha a trilha de ocorrências: cancelamento total apaga (G1), cancelamento parcial encurta a data
fim (G2), **bifurcação apaga o registro e cria dois** (G3).

## A objeção, registrada

Antes de implementar eu levantei que o split **não precisaria** tocar no RM, com estas medições:

- `FopConvocacaoData` tem **9 campos** e nenhum é contrato. Leitura real do `C03S003783`:
  `CODCOLIGADA, CHAPA, CODCONVOCACAO, DTCONVOCACAO, DTINIPRESTSERV, DTFIMPRESTSERV,
  INDLOCALPRESTACTRAB, ESTADOCONVOCACAO, DTRESPOSTA`.
- `INDLOCALPRESTACTRAB = 0` em **1279/1279** registros lançados à mão pelo DP — nem o humano
  distingue estabelecimento por contrato.
- Os 12 splits do board (8 são teste da SORAIA em 23–24/05; 4 reais em mai/jun; zero em jul/ago)
  são todos **contíguos**: só muda o contrato, o período total é idêntico.

Ou seja: o S-2260 de 05→20 continua correto depois do split, e apagá-lo para transmitir dois é
churn em evento do governo. **Decisão do Isaac (12/08/2026): implementar assim mesmo.** Fica
documentado que é escolha, não descuido.

Condição que reverteria a decisão: se um dia o app passar a enviar `INDLOCALPRESTACTRAB` real por
contrato (estabelecimento de terceiros), aí o split passa a exigir dois registros de fato.

## Restrições medidas

| Fato | Consequência |
|---|---|
| `rotas_processo` não tem linha `split` → cai no `*` = n8n | o RM não tem onde entrar; a rota precisa vir pro backend |
| WF `ZagUa2yuP6BsAE9i` tem 9 nodes e só escreve `long_text_mm3m8k0m` + dual-write `pi.convocacoes.split` | espelhar é barato, bem menos que o `cancelar` |
| `gravarConvocacaoRm` **reserva por dentro** | chamar ele depois do `planejarSubstituicaoRm` bate `ocupado` na linha que o próprio plano criou |
| `chaveEfeitoConvocacaoRm` já é `convocacao_rm:<id da linha>` | peça nova tem uuid fresco → não colide com a original (o bug previsto na Fase A já está corrigido) |
| `a_remover` está FORA do índice parcial de de-dup | a peça 1, que herda o início, cabe antes de o delete acontecer |
| `planejarSubstituicaoRm` não tem caller em produção | G3 é o primeiro |

## Passos

### G3.0 — split no backend
`POST /api/intermitente-aplicar-split` em `espelhoIntermitente.ts`, espelhando o WF: valida
(`tipo` ∈ aplicar/reverter, data ISO, contratos diferentes), acha o item do Histórico por uuid
(`text_mm2xjend`), escreve `Split JSON` (`long_text_mm3m8k0m`), dual-write em
`pi.convocacoes.split`. Flip `rotas_processo` `split` → `api` **no mesmo deploy**.

### G3.1 — `executarGravacaoRm(lancamento)`
Extrair de `gravarConvocacaoRm` os passos 4–6 (ledger → SaveRecord → confirma → eco) numa função
que recebe a linha **já reservada**. `gravarConvocacaoRm` passa a ser `montar + pré-voo + reservar
+ executarGravacaoRm`. Refatoração pura: pontual e mensal não mudam de comportamento.

### G3.2 — `substituirConvocacaoRm()`
1. Lê os vivos do item (`lancamentosDoItem`, que já casa o espelho da virada).
2. **Só os que CRUZAM o corte** entram. Peça inteiramente antes ou inteiramente depois fica
   intacta: o período dela não muda, e apagar seria destruir um S-2260 correto por nada.
3. `planejarSubstituicaoRm({ remover, criar })` — transação única.
4. No RM: **apaga primeiro, cria depois.** Se a criação falhar, a pessoa fica sem convocação, mas
   as reservas estão no banco e o job recria. O inverso deixaria 3 registros vivos se o delete
   falhasse — S-2260 duplicado, que é pior e só sai na mão.
5. `motivo_saida='bifurcacao'`, `origem_lancamento_id` apontando pro original.

`reverter` usa a mesma primitiva ao contrário: os vivos do item voltam a ser um só, com o período
da convocação.

### G3.3 — job `convocacao_rm_substituir`
Rede pro `indeterminado`/`erro`. **Assimétrico à remoção**: apagar duas vezes é inofensivo, criar
duas vezes duplica S-2260. Então aqui o passo de conciliação por leitura é obrigatório, igual o do
pontual — nunca reenviar sem antes ler o RM.

### Flag
`SPLIT_RM_HABILITADO` (default LIGADO) além de `CONVOCACAO_RM_HABILITADA` — kill switch sem deploy
para um caminho destrutivo.

## Verificação

1. Período **2099** com corte no meio: conferir que o RM ficou com dois registros, que
   `pi.convocacoes_rm` tem 1 `removido` + 2 `no_rm` com `origem_lancamento_id` preenchido, e que o
   ledger tem 3 chaves distintas.
2. Peça que não cruza o corte: provar que **não** foi tocada.
3. Injeção de falha: (a) delete falha → nada é criado, plano fica pendente; (b) create falha no
   meio → job concilia por leitura e termina com exatamente dois; (c) reverter volta pra um.
4. Só então um caso real, com o DP avisado.

Desfazer: `npm run rm:delete` nas duas peças → só depois limpar ledger e linhas → recriar o
original pelo período da convocação.
