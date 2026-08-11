# Plano — OCORRÊNCIAS refletidas no RM (S-2260)

> Decisão do Isaac (mudança de rota): cancelamento **total** apaga no RM; cancelamento **parcial**
> edita a data fim; **bifurcação** apaga a original e cria duas.
> Base: 4 mapas + crítica (workflow `mapa-ocorrencias-rm`, 11/08/2026) e dois experimentos meus.

## O que foi MEDIDO hoje (não suposto)

**1. O RM aceita UPDATE — a decisão do parcial é viável.** Provado em 2099 com a chapa 006534:
`SaveRecord` com `CODCONVOCACAO` **preenchido** editou no lugar (`DTFIMPRESTSERV` 20/03 → 10/03),
mesma PK, e o `ReadView` do ano devolveu **1** registro, não 2. Ou seja: campo vazio = insere,
campo preenchido = atualiza. Sem isso, "editar" viraria "apagar e recriar", que queima um
`C03S######` novo e emite um segundo S-2260 — exatamente o que a decisão quer evitar.

**2. `marcarParaRemocaoRm` está QUEBRADA.** Reproduzido: linha `reservado` (código NULL) →
`23514 ck_convocacoes_rm_codigo`. O CHECK exige código não-nulo para `a_remover`, mas a função
aceita `estado IN ('no_rm','reservado')`. É o caso "gravou e morreu no meio" — o que mais precisa
ser removido. O teste atual passa pelo motivo errado (colide no índice antes de chegar no CHECK).

**3. O cancelamento hoje é n8n, não backend.** `pi.rotas_processo` tem só `*`=n8n e `convocar`=api.
A rota `/api/intermitente-cancelar-convocacao` existe e está completa (paridade ✓ desde 04/07),
mas **desligada**. Modo é `n8n` puro, não `auto` — não há failover por 404.

**4. Flipar `cancelar` liga junto um `reverter` incompleto.** O reverter do backend não restaura
`Status` para "Válida", não limpa `Cancelamento Início` e não tira o item do grupo CANCELADOS.
Hoje ele nem roda (vai pro n8n, que nunca o implementou).

**5. O caso dominante é "não existe no RM".** Dos 4 itens nos grupos CANCELADOS / CANCELADOS
PARCIAL do board atual: **zero** têm linha em `pi.convocacoes_rm` e **zero** aparecem no RM em
agosto. Se o código tratar ausência como erro, todo cancelamento passa a falhar.

**6. Split é o menos urgente.** 12 splits no histórico, **todos de maio/junho**, nenhum em agosto —
e 8 dos 12 são da mesma pessoa/mesma origem (`item_origem_id=12091765628`), o que parece
duplicação de execução, não 8 splits legítimos.

**7. O eco não limpa a coluna.** `ecoAcumulado` tem `if (!codigos.length …) return` — quando o
último código sai, `Código Convocação RM` fica no board afirmando um registro que não existe mais.

**8. Há duas rotas de split no backend** — `espelhoIntermitente.ts:316` (viva) e
`intermitente.ts:251` (morta, sem espelho PG). Matar a morta antes de plugar RM.

## Ordem: cancelamento TOTAL primeiro

Não é a mais frequente (11 totais × 26 parciais), é a que **não depende de nada em aberto**: usa
`deleteRecordByKeyDireto`, que já apagou registro real em produção várias vezes hoje. Também é a
de maior dano se ficar de fora — convocação apagada no Monday e viva no RM é um S-2260 declarando
trabalho que não houve. E constrói as três peças que os outros dois reusam.

### G0 — Consertar o que está quebrado (pré-requisito de tudo)
`marcarParaRemocaoRm` e o UPDATE interno de `planejarSubstituicaoRm` restritos a `estado='no_rm'`;
linha `reservado` vai para `falharLancamentoRm` (não há o que apagar no RM se nunca confirmou).
Reescrever o teste que hoje passa pelo motivo errado. Sem isso, G1 estoura no caso mais importante.

### G1 — Cancelamento TOTAL
- `existeRegistroRm()` promovido pra `clients/rmSoap.ts` (hoje há duas versões divergentes em
  scripts) — prova obrigatória **antes e depois** do delete.
- `removerConvocacaoRm(lancamentoId, {motivo})` em `services/`, espelho de `gravarConvocacaoRm`:
  `marcar → reservarEfeito → delete → confirmarEfeito + confirmarRemocaoRm`. Chave já existe
  (`chaveEfeitoRemocaoConvocacaoRm`).
- Job `convocacao_rm_remover` + registro no `runner` (timeout no delete = `indeterminado` → mesma
  conciliação por leitura do pontual).
- Wiring em `espelhoIntermitente.ts` (entre as escritas Monday e o espelho PG), com o padrão já
  validado: inline com teto curto, cai pra fila se o RM não fechar.
- **Regra v1**: só remove se houver linha `no_rm` nossa **E** o ReadView confirmar a PK. Qualquer
  outro caso **não falha o cancelamento** — registra e segue (ver medição 5).
- Eco: limpar a coluna do board quando o último código sai (medição 7).
- Flip `cancelar` → `api` **junto** com o conserto dos 3 gaps do reverter, ou com o botão
  desabilitado (medição 4).

### G2 — Cancelamento PARCIAL (depende de D1)
`atualizarPeriodoLancamentoRm` no repo + builder próprio que **preserva** `DTCONVOCACAO`/
`DTRESPOSTA` (o ato não muda: houve convite) e faz read-modify-write dos campos que não emitimos
(`DTPREVPGTO` está preenchido em 6/6 dos registros do DP — um update cego zera). Chave de ledger
com id imutável por chamada, nunca derivada de atributo que pode repetir.

### G3 — BIFURCAÇÃO (depende de G1+G2)
`substituirConvocacaoRm()` consumindo `planejarSubstituicaoRm`; exige quebrar `gravarConvocacaoRm`
em `reservar + executar` (hoje ele reserva por dentro, então não dá pra reusar em linha já
reservada pelo plano). Decidir ordem delete/create — criar antes faz o pré-voo achar o registro
velho por overlap e devolver `ja_no_rm` pros pedaços novos.

## Verificação
Mesma escada do mensal: testes DI → 2099 → **um caso real**. O caso real já existe e é datado: as
duas convocações vivas de 11/08 (`C03S003781`, `C03S003782`, ambas SEMSA, criadas pelo pontual).
