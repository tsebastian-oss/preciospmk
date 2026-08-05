-- MGP Intelligence enterprise tenant foundation.
-- Requires the existing auth schema, product catalog tables and public.is_saas_admin().

create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  organization_type text not null default 'brand' check (organization_type in ('platform','retailer','brand')),
  status text not null default 'trial' check (status in ('trial','active','suspended','archived')),
  plan text not null default 'pilot' check (plan in ('pilot','brand_monitor','brand_intelligence','retail_pilot','retail_intelligence','enterprise')),
  logo_url text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  job_title text,
  phone text,
  locale text not null default 'es-CL',
  timezone text not null default 'America/Santiago',
  last_organization_id uuid references public.organizations(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','analyst','executive','viewer')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','admin','analyst','executive','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  token_hash text,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,email)
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_world text not null default 'brand' check (default_world in ('retailer','brand')),
  locale text not null default 'es-CL',
  timezone text not null default 'America/Santiago',
  refresh_frequency text not null default 'daily' check (refresh_frequency in ('daily','twice_daily','hourly','manual')),
  ai_enabled boolean not null default true,
  alerts_enabled boolean not null default true,
  report_branding jsonb not null default '{}'::jsonb,
  data_retention_months integer not null default 36 check (data_retention_months between 3 and 120),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.organization_scopes (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  retailers text[] not null default array['Lider','Jumbo','Santa Isabel']::text[],
  brands text[] not null default '{}'::text[],
  competitors text[] not null default '{}'::text[],
  categories text[] not null default '{}'::text[],
  modules text[] not null default array['overview','pricing','availability']::text[],
  limits jsonb not null default '{"users":5,"brands":3,"exports_per_month":20}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  alert_type text not null check (alert_type in ('price_change','price_index','promotion','stock_out','assortment_change','new_product','data_quality','match_review')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  scope jsonb not null default '{}'::jsonb,
  condition jsonb not null default '{}'::jsonb,
  channels jsonb not null default '["email"]'::jsonb,
  recipients text[] not null default '{}'::text[],
  enabled boolean not null default true,
  cooldown_minutes integer not null default 1440 check (cooldown_minutes between 60 and 10080),
  last_triggered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_product_id uuid references public.products(id) on delete cascade,
  candidate_product_id uuid references public.products(id) on delete cascade,
  proposed_relationship text check (proposed_relationship in ('equivalent','direct_competitor','substitute','not_comparable')),
  final_relationship text check (final_relationship in ('equivalent','direct_competitor','substitute','not_comparable')),
  confidence numeric(5,2) check (confidence between 0 and 100),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  reasons jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_product_id is null or candidate_product_id is null or target_product_id <> candidate_product_id)
);

create unique index match_reviews_active_pair_idx
on public.match_reviews(organization_id,target_product_id,candidate_product_id)
where status in ('pending','approved');

create table public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_type text not null check (report_type in ('executive','brand_scorecard','retailer_scorecard','pricing','promotions','availability','assortment','data_quality','audit')),
  format text not null default 'pdf' check (format in ('pdf','xlsx','csv','pptx')),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','expired')),
  parameters jsonb not null default '{}'::jsonb,
  result_url text,
  result_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz
);

create table public.data_quality_snapshots (
  id bigint generated by default as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  crawl_run_id bigint references public.catalog_crawl_runs(id) on delete set null,
  capture_completion_pct numeric(6,2),
  valid_price_pct numeric(6,2),
  stock_known_pct numeric(6,2),
  image_coverage_pct numeric(6,2),
  match_coverage_pct numeric(6,2),
  failed_tasks integer,
  stale_products integer,
  products_total integer,
  metrics jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated by default as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  request_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organization_members_user_idx on public.organization_members(user_id,status);
create index invitations_org_status_idx on public.organization_invitations(organization_id,status,created_at desc);
create index alert_rules_org_enabled_idx on public.alert_rules(organization_id,enabled,alert_type);
create index match_reviews_org_status_idx on public.match_reviews(organization_id,status,created_at desc);
create index report_jobs_org_status_idx on public.report_jobs(organization_id,status,requested_at desc);
create index data_quality_org_time_idx on public.data_quality_snapshots(organization_id,captured_at desc);
create index audit_logs_org_time_idx on public.audit_logs(organization_id,created_at desc);
create index audit_logs_actor_time_idx on public.audit_logs(actor_user_id,created_at desc);

create or replace function public.enterprise_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

create or replace function private.enterprise_role_rank(p_role text)
returns integer language sql immutable as $$
  select case p_role
    when 'owner' then 50
    when 'admin' then 40
    when 'analyst' then 30
    when 'executive' then 20
    when 'viewer' then 10
    else 0 end;
$$;

create or replace function private.enterprise_member_role(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns text language sql stable security definer
set search_path=public,private as $$
  select role from public.organization_members
  where organization_id=p_organization_id
    and user_id=p_user_id
    and status='active'
  limit 1;
$$;

create or replace function public.enterprise_is_org_member(p_organization_id uuid)
returns boolean language sql stable security definer
set search_path=public,private as $$
  select public.is_saas_admin()
    or private.enterprise_member_role(p_organization_id,auth.uid()) is not null;
$$;

create or replace function public.enterprise_has_org_role(p_organization_id uuid,p_roles text[])
returns boolean language sql stable security definer
set search_path=public,private as $$
  select public.is_saas_admin()
    or coalesce(private.enterprise_member_role(p_organization_id,auth.uid())=any(p_roles),false);
$$;

create or replace function public.enterprise_can_manage_org(p_organization_id uuid)
returns boolean language sql stable security definer
set search_path=public,private as $$
  select public.enterprise_has_org_role(p_organization_id,array['owner','admin']::text[]);
$$;

create or replace function private.enterprise_audit_trigger()
returns trigger language plpgsql security definer
set search_path=public,private as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_org uuid;
  v_entity_id text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old:=to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new:=to_jsonb(new); end if;
  v_org:=coalesce(
    nullif(coalesce(v_new->>'organization_id',v_old->>'organization_id'),'')::uuid,
    case when tg_table_name='organizations'
      then nullif(coalesce(v_new->>'id',v_old->>'id'),'')::uuid
      else null end
  );
  v_entity_id:=coalesce(v_new->>'id',v_old->>'id',v_new->>'user_id',v_old->>'user_id',v_org::text);
  insert into public.audit_logs(
    organization_id,actor_user_id,action,entity_type,entity_id,old_values,new_values,metadata
  ) values(
    v_org,auth.uid(),lower(tg_op),tg_table_name,v_entity_id,v_old,v_new,
    jsonb_build_object('source','database_trigger')
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger organizations_updated_at before update on public.organizations for each row execute function public.enterprise_set_updated_at();
create trigger user_profiles_updated_at before update on public.user_profiles for each row execute function public.enterprise_set_updated_at();
create trigger organization_members_updated_at before update on public.organization_members for each row execute function public.enterprise_set_updated_at();
create trigger invitations_updated_at before update on public.organization_invitations for each row execute function public.enterprise_set_updated_at();
create trigger alert_rules_updated_at before update on public.alert_rules for each row execute function public.enterprise_set_updated_at();
create trigger match_reviews_updated_at before update on public.match_reviews for each row execute function public.enterprise_set_updated_at();

create trigger organizations_audit after insert or update or delete on public.organizations for each row execute function private.enterprise_audit_trigger();
create trigger members_audit after insert or update or delete on public.organization_members for each row execute function private.enterprise_audit_trigger();
create trigger invitations_audit after insert or update or delete on public.organization_invitations for each row execute function private.enterprise_audit_trigger();
create trigger settings_audit after insert or update or delete on public.organization_settings for each row execute function private.enterprise_audit_trigger();
create trigger scopes_audit after insert or update or delete on public.organization_scopes for each row execute function private.enterprise_audit_trigger();
create trigger alerts_audit after insert or update or delete on public.alert_rules for each row execute function private.enterprise_audit_trigger();
create trigger matches_audit after insert or update or delete on public.match_reviews for each row execute function private.enterprise_audit_trigger();
create trigger reports_audit after insert or update or delete on public.report_jobs for each row execute function private.enterprise_audit_trigger();

alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.organization_scopes enable row level security;
alter table public.alert_rules enable row level security;
alter table public.match_reviews enable row level security;
alter table public.report_jobs enable row level security;
alter table public.data_quality_snapshots enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations
for select to authenticated using(public.enterprise_is_org_member(id));
create policy organizations_admin_all on public.organizations
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy profiles_self_select on public.user_profiles
for select to authenticated using(user_id=auth.uid() or public.is_saas_admin());
create policy profiles_self_update on public.user_profiles
for update to authenticated using(user_id=auth.uid() or public.is_saas_admin())
with check(user_id=auth.uid() or public.is_saas_admin());

create policy members_select on public.organization_members
for select to authenticated using(user_id=auth.uid() or public.enterprise_can_manage_org(organization_id));
create policy members_admin_all on public.organization_members
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy invitations_select on public.organization_invitations
for select to authenticated using(public.enterprise_can_manage_org(organization_id));
create policy invitations_admin_all on public.organization_invitations
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy settings_select on public.organization_settings
for select to authenticated using(public.enterprise_is_org_member(organization_id));
create policy settings_admin_all on public.organization_settings
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy scopes_select on public.organization_scopes
for select to authenticated using(public.enterprise_is_org_member(organization_id));
create policy scopes_admin_all on public.organization_scopes
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy alerts_select on public.alert_rules
for select to authenticated using(public.enterprise_is_org_member(organization_id));
create policy alerts_admin_all on public.alert_rules
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy match_reviews_select on public.match_reviews
for select to authenticated using(public.enterprise_is_org_member(organization_id));
create policy match_reviews_admin_all on public.match_reviews
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy report_jobs_select on public.report_jobs
for select to authenticated using(public.enterprise_is_org_member(organization_id));
create policy report_jobs_admin_all on public.report_jobs
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy data_quality_select on public.data_quality_snapshots
for select to authenticated using(organization_id is null or public.enterprise_is_org_member(organization_id));
create policy data_quality_admin_all on public.data_quality_snapshots
for all to authenticated using(public.is_saas_admin()) with check(public.is_saas_admin());

create policy audit_select on public.audit_logs
for select to authenticated using(
  public.is_saas_admin()
  or public.enterprise_has_org_role(organization_id,array['owner','admin','executive']::text[])
);

revoke all on public.organizations,public.user_profiles,public.organization_members,
public.organization_invitations,public.organization_settings,public.organization_scopes,
public.alert_rules,public.match_reviews,public.report_jobs,public.data_quality_snapshots,
public.audit_logs from anon;

grant select on public.organizations,public.user_profiles,public.organization_members,
public.organization_invitations,public.organization_settings,public.organization_scopes,
public.alert_rules,public.match_reviews,public.report_jobs,public.data_quality_snapshots,
public.audit_logs to authenticated;

grant update on public.user_profiles to authenticated;
grant usage,select on all sequences in schema public to authenticated;
