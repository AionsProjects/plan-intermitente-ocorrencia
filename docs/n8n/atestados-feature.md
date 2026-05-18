# Feature standalone: Atestados e Declarações

Spec dos workflows n8n e endpoints da feature `/atestados` (Hub principal → tile âmbar).

Decisão tomada em **2026-05**: atestado/declaração saíram do fluxo `/preencher/:uuid` (WF3 Finalizar) e ganharam feature própria. Operacional não precisa mais abrir o link único da convocação pra lançar documento — basta acessar `/atestados`, buscar a pessoa por nome, escolher a convocação alvo e lançar.

## Endpoints

### `GET /intermitente-convocacoes-empregado`

**Query:** `?chapa=<chapa>&mes=<YYYY-MM>` (mes opcional; default = mês corrente)

**Pipeline:**
1. Busca board ENTRADA `18408773953` via `getByColumnValue` filtrando por chapa (`texto`).
2. Filtra resultado: período `OP - Data/Início` (`date_mktayxhb`) → `OP - Data/Fim` (`date_mktasnwq`) intersecta o mês solicitado. Ignora `Status Convocação` (`color_mm3a8ana`) in (`Cancelada`, `Cancelado`, `Bloqueada - conflito`). Pra `Cancelada parcialmente`, considera período efetivo `[dataInicio, CANCELAMENTO_INICIO - 1]`.
3. Cross-reference board Histórico (`18411141462`) via `Item Origem` (`link_mm2x1rk0`) ou via UUID emitido pelo WF1.
4. Lê do Histórico: `text_mm2xjend` (uuid), `color_mm34yyet` (trabalha_sabado), `color_mm34ry47` (optante_vt), `color_mm2xkqpc` (status), `long_text_mm3cp43g` (Atestados JSON — parsea pra `documentos_existentes`).

**Resposta:**
```json
{
  "convocacoes": [{
    "uuid": "...",
    "item_entrada_id": "...",
    "item_historico_id": "...",
    "data_inicio": "2026-05-04",
    "data_fim": "2026-05-22",
    "contrato": "SEMSA",
    "trabalha_sabado": false,
    "optante_vt": true,
    "status": "aguardando",
    "status_convocacao": "Válida",
    "data_inicio_cancelamento": null,
    "documentos_existentes": [{
      "id": "atest-abc123",
      "tipo_documento": "atestado",
      "data_inicio": "2026-05-10",
      "data_fim": "2026-05-12",
      "periodos": [],
      "monday_item_url": "https://contato-serv.monday.com/boards/18298015951/pulses/..."
    }]
  }]
}
```

### `POST /intermitente-lancar-documentos`

**Content-type:** `multipart/form-data`

**Campos:**
- `payload` — JSON string com array `documentos[]`
- `doc_<id>` — binário do arquivo (PDF/JPG/PNG/HEIC, máx 15MB cada). `<id>` casa com `documentos[].id`

**Payload exemplo:**
```json
{
  "documentos": [{
    "id": "atest-abc123",
    "tipo_documento": "atestado",
    "uuid_convocacao": "550e8400-...",
    "item_entrada_id": "9876543210",
    "chapa": "007326",
    "empregado_nome": "FULANO DE TAL",
    "contrato": "SEMSA",
    "trabalha_sabado": false,
    "optante_vt": true,
    "data_inicio": "2026-05-10",
    "data_fim": "2026-05-12",
    "periodos": [],
    "primeiro_dia_foi_trabalhar": false,
    "primeiro_dia_trabalhou_seis_horas": null,
    "nome_arquivo": "atestado.pdf",
    "tamanho_arquivo": 284000
  }, {
    "id": "decla-def456",
    "tipo_documento": "declaracao",
    "uuid_convocacao": "550e8400-...",
    "chapa": "007326",
    "empregado_nome": "FULANO DE TAL",
    "contrato": "SEMSA",
    "trabalha_sabado": false,
    "optante_vt": true,
    "data_inicio": "2026-05-15",
    "data_fim": "2026-05-15",
    "periodos": ["manha"],
    "primeiro_dia_foi_trabalhar": true,
    "primeiro_dia_trabalhou_seis_horas": true,
    "nome_arquivo": "declaracao.pdf",
    "tamanho_arquivo": 180000
  }]
}
```

**Pipeline (pra cada doc):**

1. **Busca item Histórico** por `uuid_convocacao` (board `18411141462`, coluna `text_mm2xjend`).
2. **Calcula desconto** (regras §12 do `Mapeamento.md`):
   - Atestado, não trabalhou primeiro dia: VR + VT (do primeiro dia).
   - Atestado, trabalhou <6h: VR (do primeiro dia).
   - Atestado, demais dias cobertos: VR + VT integrais.
   - Declaração 1 turno, ≥6h: sem desconto.
   - Declaração 1 turno, <6h: VR.
   - Declaração integral, não trabalhou: VR + VT.
   - Declaração integral, trabalhou <6h: VR.
   - Declaração integral, ≥6h: sem desconto.
3. **Lê ledger** `Beneficios Descontados JSON` (`long_text_mm3ct3hg`) — pra cada data, se já tem `vr_percentual=100` não desconta VR de novo; mesma regra pra VT.
4. **Atualiza ledger** com `origens: ["atestado:<id>" | "declaracao:<id>"]`.
5. **Anexa arquivo** na coluna `Arquivos de Atestado` (`file_mm3cvt54`) do Histórico via `add_file_to_column`.
6. **Cria item no Controle de Atestados** (`18298015951`, grupo `topics`) — `Tipo da Documentação`: `Atestado Médico` ou `Declaração de Comparecimento`; demais colunas conforme `docs/n8n/controle-atestados-board.md`. Anexa o arquivo na coluna `files` do item criado.
7. **Atualiza `Atestados JSON`** (`long_text_mm3cp43g`) do Histórico mesclando com docs existentes; atualiza `Qtd Atestados` (`numeric_mm3c4cse`).
8. **Cria/atualiza item Desconto** (board `18400981023`) considerando o saldo do ledger (não duplica se falta manual já consumiu).

**Resposta:**
```json
{
  "ok": true,
  "resultados": [{
    "id": "atest-abc123",
    "monday_item_id_controle": "123456789",
    "monday_item_url_controle": "https://...",
    "desconto_id": "987654",
    "erro": null
  }]
}
```

**Erros parciais:** mesmo com `ok: true`, itens individuais podem ter `erro: "mensagem"`. Frontend exibe contagem ok/erro na tela de sucesso.

## Mudanças no WF3 (Finalizar)

Removidos: branch atestado de `Validar e preparar1`, `Processar Atestados` (executeWorkflow), normalização `tipo_documento`, suporte multipart. WF3 voltou a ser JSON puro.

Mantido: respostas manuais (`falta`/`atraso`/`sem_ocorrencia`), `dias_extras`/`dias_desativados`/`sabados_extras`, ledger pra falta manual (deve consultar `long_text_mm3ct3hg` antes de descontar pra evitar duplicar com atestado já lançado).

## Frontend

Rota: `/atestados` → `src/features/atestados/AtestadosPage.tsx`.

Fluxo: EscolhaTipoTrabalhador → BuscarPessoa (reusa `useBuscarEmpregado` do convocar) → PainelConvocacoes → WizardDocumento (tipo-doc → calendário → turnos → perguntas → upload → preview) → adiciona à `SessaoLancamento` em memória → abre `ResumoSessao` modal → "Adicionar mais um documento" volta pra BuscarPessoa, ou "Concluir" dispara `POST /intermitente-lancar-documentos`.

Sessão acumula docs de múltiplas pessoas. Botão flutuante "Resumo (N)" sempre visível no canto inferior direito depois do primeiro doc.

## Regras de bloqueio (validadas no frontend)

- Atestado bloqueia qualquer outro doc nas datas que cobre (vs sessão + `documentos_existentes` da convocação).
- Declaração proibida em dia com atestado.
- Declaração sempre 1 dia.
- Declaração não duplica turno: `manha` ocupado → só libera `tarde`; `tarde` ocupado → só libera `manha`; ambos ocupados → bloqueia.
- Sábado só se ativo na convocação (`trabalha_sabado=true` OU sábado extra).
- Atestado multi-dia não cruza sábado inativo (cada dia do range é validado).
- Domingo nunca conta.

## CLT

Stub "em breve" visível no Hub interno (`EscolhaTipoTrabalhador`). Tile disabled. Lógica de busca + lançamento ainda em definição (provavelmente sem `uuid_convocacao`, criando item direto no Controle de Atestados sem mexer em Desconto/Histórico).
