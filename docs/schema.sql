-- =============================================================
-- Schema para o app "Registro de Ocorrências de Intermitentes"
-- Rode este SQL uma única vez no SQL Editor do Supabase.
-- Acesso ao banco é exclusivo via n8n (service_role key).
-- Por isso, RLS fica desabilitada — o frontend não conversa
-- com o Supabase diretamente.
-- =============================================================

-- Extensões
create extension if not exists pgcrypto;

-- =============================================================
-- Tabela: processamentos
-- Um registro por solicitação criada pelo n8n quando o RH
-- aciona o botão no board do monday.
-- =============================================================
create table if not exists processamentos (
  id uuid primary key default gen_random_uuid(),

  -- Referência ao item original do monday (board "Plano Intermitentes")
  monday_item_id text not null,

  -- Snapshot do intermitente no momento da criação
  nome text not null,
  contrato text,
  data_inicio date not null,
  data_fim date not null,
  qtd_dias integer generated always as (data_fim - data_inicio + 1) stored,

  -- Estado do processamento
  status text not null default 'aguardando'
    check (status in ('aguardando', 'concluido', 'expirado')),

  -- Janela de validade do link (default: 30 dias)
  expira_em timestamptz not null default (now() + interval '30 days'),

  -- Timestamps
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,

  -- Quem criou a solicitação no monday (nome/email, opcional)
  solicitante text,

  -- Referência ao item criado no board de destino após o submit
  monday_destino_item_id text
);

create index if not exists processamentos_monday_item_id_idx
  on processamentos (monday_item_id);

create index if not exists processamentos_status_idx
  on processamentos (status);

create index if not exists processamentos_expira_em_idx
  on processamentos (expira_em);

-- =============================================================
-- Tabela: ocorrencias_dia
-- Um registro por dia da convocação após o RH responder o
-- wizard. tipo = 'sem_ocorrencia' | 'falta' | 'atraso'.
-- =============================================================
create table if not exists ocorrencias_dia (
  id uuid primary key default gen_random_uuid(),

  processamento_id uuid not null
    references processamentos (id) on delete cascade,

  data date not null,
  tipo text not null
    check (tipo in ('sem_ocorrencia', 'falta', 'atraso')),

  -- Só preenchido quando tipo = 'atraso'
  minutos_atraso integer,

  criado_em timestamptz not null default now(),

  -- Um registro por dia por processamento
  unique (processamento_id, data),

  -- Coerência: atraso obriga minutos_atraso
  constraint atraso_exige_minutos check (
    (tipo = 'atraso' and minutos_atraso is not null and minutos_atraso > 0)
    or (tipo <> 'atraso')
  )
);

create index if not exists ocorrencias_dia_processamento_id_idx
  on ocorrencias_dia (processamento_id);

-- =============================================================
-- Função auxiliar: marcar links expirados
-- Pode ser chamada manualmente ou via cron do Supabase para
-- varrer processamentos em aberto que passaram da data de
-- expiração.
-- =============================================================
create or replace function expirar_processamentos_vencidos()
returns integer
language plpgsql
security definer
as $$
declare
  afetados integer;
begin
  update processamentos
     set status = 'expirado'
   where status = 'aguardando'
     and expira_em < now();
  get diagnostics afetados = row_count;
  return afetados;
end;
$$;
