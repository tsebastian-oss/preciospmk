-- Secure the Brands vertical so client-side tenant isolation cannot be bypassed
-- by calling Supabase RPCs directly.

create or replace function private.enterprise_brand_key(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
    translate(lower(coalesce(p_value,'')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create or replace function private.enterprise_brand_slug_allowed(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or public.is_saas_admin()
    or exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      join public.organization_scopes s on s.organization_id = o.id
      cross join lateral unnest(s.brands) as scoped_brand
      where m.user_id = auth.uid()
        and m.status = 'active'
        and o.status in ('trial','active')
        and o.organization_type = 'brand'
        and 'brand-panel' = any(s.modules)
        and private.enterprise_brand_key(scoped_brand) = private.enterprise_brand_key(p_slug)
    );
$$;

do $$
begin
  if to_regprocedure('public.brands_vertical_payload_base_internal(text)') is null then
    alter function public.brands_vertical_payload_base(text) rename to brands_vertical_payload_base_internal;
  end if;
  if to_regprocedure('public.brands_vertical_competition_internal(text)') is null then
    alter function public.brands_vertical_competition(text) rename to brands_vertical_competition_internal;
  end if;
  if to_regprocedure('public.brands_qsr_official_snapshot_internal(text)') is null then
    alter function public.brands_qsr_official_snapshot(text) rename to brands_qsr_official_snapshot_internal;
  end if;
  if to_regprocedure('public.brands_qsr_competitive_snapshot_internal(text)') is null then
    alter function public.brands_qsr_competitive_snapshot(text) rename to brands_qsr_competitive_snapshot_internal;
  end if;
end
$$;

revoke all on function public.brands_vertical_payload_base_internal(text) from public, anon, authenticated;
revoke all on function public.brands_vertical_competition_internal(text) from public, anon, authenticated;
revoke all on function public.brands_qsr_official_snapshot_internal(text) from public, anon, authenticated;
revoke all on function public.brands_qsr_competitive_snapshot_internal(text) from public, anon, authenticated;

create or replace function public.brands_vertical_payload_base(p_slug text default 'victorinox')
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when private.enterprise_brand_slug_allowed(p_slug)
      then public.brands_vertical_payload_base_internal(p_slug)
    else null
  end;
$$;

create or replace function public.brands_vertical_competition(p_slug text default 'victorinox')
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when private.enterprise_brand_slug_allowed(p_slug)
      then public.brands_vertical_competition_internal(p_slug)
    else null
  end;
$$;

create or replace function public.brands_qsr_official_snapshot(p_slug text default 'krispy-kreme')
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when private.enterprise_brand_slug_allowed(p_slug)
      then public.brands_qsr_official_snapshot_internal(p_slug)
    else null
  end;
$$;

create or replace function public.brands_qsr_competitive_snapshot(p_slug text default 'krispy-kreme')
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when private.enterprise_brand_slug_allowed(p_slug)
      then public.brands_qsr_competitive_snapshot_internal(p_slug)
    else null
  end;
$$;

create or replace function public.brands_vertical_payload(p_slug text default 'victorinox')
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when private.enterprise_brand_slug_allowed(p_slug)
      then coalesce(public.brands_vertical_payload_base(p_slug),'{}'::jsonb)
        || jsonb_build_object('competition', public.brands_vertical_competition(p_slug))
    else null
  end;
$$;

revoke all on function public.brands_vertical_payload_base(text) from public, anon;
revoke all on function public.brands_vertical_competition(text) from public, anon;
revoke all on function public.brands_vertical_payload(text) from public, anon;
revoke all on function public.brands_qsr_official_snapshot(text) from public, anon;
revoke all on function public.brands_qsr_competitive_snapshot(text) from public, anon;

grant execute on function public.brands_vertical_payload_base(text) to authenticated, service_role;
grant execute on function public.brands_vertical_competition(text) to authenticated, service_role;
grant execute on function public.brands_vertical_payload(text) to authenticated, service_role;
grant execute on function public.brands_qsr_official_snapshot(text) to authenticated, service_role;
grant execute on function public.brands_qsr_competitive_snapshot(text) to authenticated, service_role;
