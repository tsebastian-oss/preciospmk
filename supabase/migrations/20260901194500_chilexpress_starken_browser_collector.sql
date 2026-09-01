create table if not exists public.chilexpress_collector_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.chilexpress_collector_tokens enable row level security;
revoke all on public.chilexpress_collector_tokens from anon, authenticated;
