-- Persistent per-user chat history for Courier & Logistics pricing copilot.
create table if not exists public.b2b_chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text not null default 'courier_b2b' check (char_length(module) between 2 and 80),
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  selected_month text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists b2b_chat_messages_user_org_created_idx
  on public.b2b_chat_messages(user_id, organization_id, module, created_at desc);

alter table public.b2b_chat_messages enable row level security;

drop policy if exists b2b_chat_messages_select_own on public.b2b_chat_messages;
create policy b2b_chat_messages_select_own
on public.b2b_chat_messages
for select
to authenticated
using (
  user_id = auth.uid()
  and (
    public.is_saas_admin()
    or exists (
      select 1
      from public.organization_members m
      where m.organization_id = b2b_chat_messages.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  )
);

drop policy if exists b2b_chat_messages_insert_own on public.b2b_chat_messages;
create policy b2b_chat_messages_insert_own
on public.b2b_chat_messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    public.is_saas_admin()
    or exists (
      select 1
      from public.organization_members m
      where m.organization_id = b2b_chat_messages.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  )
);

drop policy if exists b2b_chat_messages_delete_own on public.b2b_chat_messages;
create policy b2b_chat_messages_delete_own
on public.b2b_chat_messages
for delete
to authenticated
using (
  user_id = auth.uid()
  and (
    public.is_saas_admin()
    or exists (
      select 1
      from public.organization_members m
      where m.organization_id = b2b_chat_messages.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  )
);

grant select, insert, delete on public.b2b_chat_messages to authenticated;
