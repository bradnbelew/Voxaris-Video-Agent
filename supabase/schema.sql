-- Voxaris VideoAgent — Supabase schema
-- Run this once in Supabase SQL Editor (or via `supabase db push`).
--
-- Two tables:
--   sessions    — real-time per-conversation state (replaces Google Sheets "Live Sessions")
--   webhook_dlq — dead-letter queue for failed webhook processing
--
-- Auth: server-side calls use the service_role key → RLS bypassed.
-- If you ever add client-side calls, add RLS policies.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  SESSIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
create table if not exists sessions (
  conversation_id text primary key,
  vertical        text not null default 'unknown',
  data            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Fast lookup for dashboard polling (most recent first)
create index if not exists sessions_updated_at_idx on sessions (updated_at desc);

-- Filter by vertical for the recruiter / broker dashboards
create index if not exists sessions_vertical_idx on sessions (vertical);

-- GIN index on data for ad-hoc JSONB queries
-- (e.g. data->>'status' = 'completed', data->>'disqualified' = 'true')
create index if not exists sessions_data_gin_idx on sessions using gin (data);

-- Enable RLS but don't add policies — service_role bypasses RLS.
-- If you add client-side access later, add policies here.
alter table sessions enable row level security;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  WEBHOOK DEAD-LETTER QUEUE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
create table if not exists webhook_dlq (
  id               bigserial primary key,
  conversation_id  text,
  vertical         text,
  event_type       text,
  payload          jsonb not null,
  error_message    text,
  attempts         int not null default 1,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz           -- null = unresolved
);

-- Unresolved items, newest first — the DLQ dashboard view
create index if not exists webhook_dlq_unresolved_idx
  on webhook_dlq (created_at desc)
  where resolved_at is null;

-- Find DLQ entries by conversation for debugging
create index if not exists webhook_dlq_conversation_idx
  on webhook_dlq (conversation_id);

alter table webhook_dlq enable row level security;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  HELPER: auto-update updated_at on sessions
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sessions_updated_at_trigger on sessions;
create trigger sessions_updated_at_trigger
  before update on sessions
  for each row
  execute function update_updated_at();
