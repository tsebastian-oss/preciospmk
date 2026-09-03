-- On-demand task agents for Courier & Logistics pricing intelligence.
create table if not exists public.pricing_task_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vertical text not null default 'courier',
  name text not null check (char_length(name) between 2 and 100),
  agent_type text not null default 'custom' check (agent_type in ('report','analysis','matching','market_public','custom')),
  objective text not null check (char_length(objective) between 8 and 3000),
  instructions text not null default '',
  data_scopes text[] not null default array['pricing','market_public']::text[],
  model text not null default 'gpt-5.6',
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pricing_task_agents_owner_idx
  on public.pricing_task_agents(owner_user_id, organization_id, vertical, created_at desc);

create table if not exists public.pricing_task_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.pricing_task_agents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','error')),
  run_instruction text,
  result_title text,
  result_summary text,
  result_json jsonb not null default '{}'::jsonb,
  model text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pricing_task_agent_runs_agent_idx
  on public.pricing_task_agent_runs(agent_id, started_at desc);
create index if not exists pricing_task_agent_runs_user_idx
  on public.pricing_task_agent_runs(user_id, organization_id, started_at desc);

alter table public.pricing_task_agents enable row level security;
alter table public.pricing_task_agent_runs enable row level security;

drop policy if exists pricing_task_agents_select_own on public.pricing_task_agents;
create policy pricing_task_agents_select_own on public.pricing_task_agents
for select to authenticated
using (
  owner_user_id = auth.uid()
  and (
    public.is_saas_admin()
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = pricing_task_agents.organization_id
        and m.user_id = auth.uid()
        and m.status='active'
    )
  )
);

drop policy if exists pricing_task_agents_insert_own on public.pricing_task_agents;
create policy pricing_task_agents_insert_own on public.pricing_task_agents
for insert to authenticated
with check (
  owner_user_id = auth.uid()
  and (
    public.is_saas_admin()
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = pricing_task_agents.organization_id
        and m.user_id = auth.uid()
        and m.status='active'
    )
  )
);

drop policy if exists pricing_task_agents_update_own on public.pricing_task_agents;
create policy pricing_task_agents_update_own on public.pricing_task_agents
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists pricing_task_agents_delete_own on public.pricing_task_agents;
create policy pricing_task_agents_delete_own on public.pricing_task_agents
for delete to authenticated
using (owner_user_id = auth.uid());

drop policy if exists pricing_task_agent_runs_select_own on public.pricing_task_agent_runs;
create policy pricing_task_agent_runs_select_own on public.pricing_task_agent_runs
for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.pricing_task_agents a
    where a.id = pricing_task_agent_runs.agent_id
      and a.owner_user_id = auth.uid()
  )
);

drop policy if exists pricing_task_agent_runs_insert_own on public.pricing_task_agent_runs;
create policy pricing_task_agent_runs_insert_own on public.pricing_task_agent_runs
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.pricing_task_agents a
    where a.id = pricing_task_agent_runs.agent_id
      and a.owner_user_id = auth.uid()
  )
);

drop policy if exists pricing_task_agent_runs_update_own on public.pricing_task_agent_runs;
create policy pricing_task_agent_runs_update_own on public.pricing_task_agent_runs
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select,insert,update,delete on public.pricing_task_agents to authenticated;
grant select,insert,update on public.pricing_task_agent_runs to authenticated;
