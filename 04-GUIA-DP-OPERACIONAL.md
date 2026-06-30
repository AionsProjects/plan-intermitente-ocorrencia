# 👥 Guia do DP & Operacional — o que cada um pode e deve fazer

> Manual de uso completo do app **Plano de Intermitentes**, por papel. Quem pode entrar, o que cada papel vê, e o passo a passo de **todas** as ações. Detalhe técnico dos WFs → **Automações**. Plataforma/arquitetura → **Visão & Plataforma**.

**App:** `https://plan-intermitente-ocorrencia.vercel.app`

---

## 1. Acesso — quem pode entrar
- **Login Google** (SSO) com conta do domínio **`@contatoserv.com.br`**. Também há **login local** (email/CPF + senha) pra contas sem Google (ex.: 1º admin).
- **1º acesso:** completar cadastro (nome, sobrenome, **CPF**) e o papel é definido. Sem isso, não libera.
- **Conta desativada** pelo Admin → sai na hora (sessão revogada).
- Quem **não** está cadastrado/ativo **não entra**. Não há auto-cadastro aberto: o acesso depende de a conta existir no sistema.

## 2. Papéis — o que cada um vê e pode
Hierarquia: **Admin > DP > RH / Operacional**.

| Ação / tela | Operacional | RH | DP | Admin |
|---|:--:|:--:|:--:|:--:|
| Entrar / Hub | ✅ | ✅ | ✅ | ✅ |
| Convocar intermitente | ✅ | ✅ | ✅ | ✅ |
| Registrar ocorrência (link `/preencher`) | ✅ | ✅ | ✅ | ✅ |
| Corrigir lançamento (protocolo) | ✅ | ✅ | ✅ | ✅ |
| Atestados / declarações | ✅ | ✅ | ✅ | ✅ |
| Descontos manuais (link `/descontos`) | ✅ | ✅ | ✅ | ✅ |
| **Ponto facultativo** (desconto em massa) | ❌ | ❌ | ✅ | ✅ |
| Ver **atividade de todos** | só a própria | só a própria | ✅ todos | ✅ todos |
| **Gerenciar contas** (papéis, ativar, senha) | ❌ | ❌ | ❌ | ✅ |
| **Boards / registry / virada** | ❌ | ❌ | ❌ | ✅ |

> **Operacional** = operador do dia a dia. **DP** = operacional + ponto facultativo + visão geral. **Admin** = administra o sistema.
> As telas `/preencher` e `/descontos` abrem por **link único (UUID)** — quem tem o link usa, sem precisar logar.

---

## 3. O que o OPERACIONAL faz (dia a dia)

### 3.1 Convocar um intermitente — Hub → **Nova convocação**
1. **Buscar empregado** (digite ≥3 letras; a lista vem do RM) → selecione.
2. **Escolher o mês** — *mês atual* ou *próximo* (só aparecem os que existem).
3. **Formulário** — solicitante, contrato, **unidade** (filtrada pelo contrato, vem do RM), datas início/fim, sábado?, insalubridade?, interior?, justificativa. Calendário travado no mês escolhido. Anexe os **termos** (convocação/insalubridade) se houver.
4. **Convocar** — cria o item no board do mês (grupo **PONTUAL**).
   - ⚠️ **Antifraude:** se já existe convocação no mesmo período, o sistema **bloqueia** e mostra o conflito.
   - Admissão e valores vêm do RM automaticamente.

### 3.2 Gerar o link de preenchimento — coluna **ativar** (no Monday)
No item da convocação, mude a coluna **"ativar"** para *ativar*. O sistema então **cria o registro no Histórico** e grava o **link `/preencher/...`** na coluna *Link* do item. Esse link é o que se usa pra registrar as ocorrências.
> O link tem **validade** (expira) — registre dentro do prazo.

### 3.3 Registrar ocorrência — abrir o **link `/preencher/...`**
- Um **modal por dia**, perguntas no positivo: *"foi trabalhar?"*, *"chegou no horário?"* (se atrasou, informe os minutos).
- **Adicionar** dias extras / **remover** dias.
- **Sábados extras** (botão azul, só se a convocação não trabalha sábado) — calendário multi-seleção; gera **boleto VT extra** ao finalizar.
- **Finalizar** → gera o **protocolo `PROT-XXXX-XXXX`** e aplica o desconto (faltas/atrasos).

### 3.4 Corrigir um registro — Hub → **Atualizar ocorrência**
Digite o protocolo `PROT-XXXX-XXXX` → reabre o preenchimento com as respostas anteriores. Salvar marca como **editado** (não duplica).

### 3.5 Cancelar convocação — no `/preencher`, ícone de cancelar
- **Total** — cancela tudo e **finaliza**.
- **Parcial** — escolhe a data de início do cancelamento; **NÃO finaliza** (o painel segue aberto pros dias não cancelados).
- O item **move** pro grupo **CANCELADOS** (total) ou **CANCELADOS PARCIAL** (parcial), e o sistema **gera o desconto** dos dias cancelados.
- ⚠️ **Cancelamento desconta sempre** — inclusive DETRAN e TRE PB.

### 3.6 Atestados / declarações — Hub → **Atestados**
1. Escolha **Intermitente** ou **CLT** (ambos buscam no RM por nome/matrícula).
2. Selecione a convocação/colaborador → preencha (tipo de documento, datas, turno, **upload** do arquivo).
3. Pode **acumular vários** documentos na sessão ("Resumo (N)") → **Concluir** envia todos (cria itens no board Controle de Atestados + anexa arquivos).
> A validação contra o ponto real (Nexti) e o eventual desconto acontecem automaticamente depois.

### 3.7 Descontos manuais (retirada Caju) — link `/descontos/...`
O link é gerado no board de Desconto. A tela pede **VR retirado** e **VT retirado** → confirma. Registra a retirada manual no item.

---

## 4. O que o DP faz (além de tudo do Operacional)

### 4.1 Ponto facultativo — desconto em massa — Hub → **Ponto facultativo** (só DP/Admin)
1. Escolha o **contrato**.
2. **Marque várias unidades** (ou **"Selecionar tudo"** — marca todas com convocados).
3. **Prosseguir** → escolha a **data** → os **benefícios** (VR e/ou VT).
4. **Pré-visualizar** (mostra todos os afetados e o total) → **Confirmar** aplica o desconto.
> ⚠️ **DETRAN e TRE PB não sofrem desconto** no ponto facultativo (aparecem com valor 0).

### 4.2 Acompanhamento
- O DP **vê a atividade de todos** os operadores (quem fez cada lançamento, quando).
- Confere os fechamentos no board do mês (grupo "Acompanhamento de Fechamento").

---

## 5. O que o ADMIN faz
- **Gerenciar contas** (painel de configuração): mudar **papel** (admin/dp/rh/operacional), **ativar/desativar** (desativar derruba a sessão na hora), redefinir **senha**.
- **Boards / registry / virada de mês**: registrar o board do mês, rodar a virada, garantir webhooks.
- Acesso a tudo do DP e do Operacional.

## 6. Virada de mês (dia 14) — o que muda pro usuário
Todo dia **14 às 17h** (quando ligada) o sistema duplica o board do mês, cria o do **próximo mês** e o repovoa com os intermitentes do RM. **Convocar funciona no mês atual E no próximo.** Os gatilhos (coluna *ativar*) são recriados automaticamente — **você não precisa fazer nada**. Se algo aparecer no board errado depois da virada, avise o responsável técnico.

## 7. Regras que afetam o trabalho (entender pra não errar)
- **Valores (VR/VT)** vêm do board Valores por **contrato + função**. VR Mensal ÷ 30 = diário; VT é diário.
- **Mobilidade × Vale-transporte (Caju):** é **mobilidade** se a coluna **`Interior?` = SIM** **ou** o contrato é **TRE PB / Barco / SEDUC INTERIOR**. Os demais (e Interior não marcado) = **vale-transporte** normal.
- **DETRAN e TRE PB NÃO descontam** por falta/atestado (a falta é declarada, desconto = 0). Mas **cancelamento desconta** (inclusive eles).
- **VR conta dias corridos** (sáb+dom) para DETRAN e TRE PB.
- **Feriado por contrato:** NACIONAL bloqueia todos; ESTADUAL/MUNICIPAL só os do contrato; **SEDUC\* e DETRAN recebem em feriado** (não bloqueiam).
- **Antifraude:** não dá pra criar 2 convocações no mesmo período pra mesma pessoa.
- **Link `/preencher` expira** — registre dentro do prazo; depois é preciso reativar.

## 8. Boas práticas / o que evitar
- **Não editar o board do mês errado** — confira se é o mês certo (atual/próximo) antes.
- **Sábado extra** só pra quem **não** trabalha sábado (o botão só aparece nesses casos).
- **Cancelamento parcial** não finaliza — lembre de lançar os dias restantes.
- Em dúvida sobre valor/desconto, confira as **regras (§7)** — DETRAN/TRE têm tratamento especial.
- Problema técnico (link não gera, board errado, erro ao finalizar) → acionar o responsável técnico (ver **Operação & Manutenção**).
