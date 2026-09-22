-- Close the direct PostgREST/RPC tenant-isolation gap for the dedicated
-- Victorinox endpoints. The internal functions retain the data queries while
-- the public wrappers enforce the same organization scope as the Next.js API.
begin;

do $$
begin
  if to_regprocedure('public.brands_vertical_light_payload_internal(text)') is null then
    alter function public.brands_vertical_light_payload(text)
      rename to brands_vertical_light_payload_internal;
  end if;
  if to_regprocedure('public.brands_vertical_official_history_internal(text,integer)') is null then
    alter function public.brands_vertical_official_history(text,integer)
      rename to brands_vertical_official_history_internal;
  end if;
  if to_regprocedure('public.victorinox_competition_market_payload_internal(integer)') is null then
    alter function public.victorinox_competition_market_payload(integer)
      rename to victorinox_competition_market_payload_internal;
  end if;
end
$$;

revoke all on function public.brands_vertical_light_payload_internal(text) from public, anon, authenticated;
revoke all on function public.brands_vertical_official_history_internal(text,integer) from public, anon, authenticated;
revoke all on function public.victorinox_competition_market_payload_internal(integer) from public, anon, authenticated;

create or replace function public.brands_vertical_light_payload(p_slug text default 'victorinox')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.enterprise_brand_slug_allowed(p_slug) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.brands_vertical_light_payload_internal(p_slug);
end;
$$;

create or replace function public.brands_vertical_official_history(
  p_slug text default 'victorinox',
  p_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.enterprise_brand_slug_allowed(p_slug) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.brands_vertical_official_history_internal(
    p_slug,
    greatest(1, least(coalesce(p_days, 90), 180))
  );
end;
$$;

create or replace function public.victorinox_competition_market_payload(
  p_limit_per_brand integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.enterprise_brand_slug_allowed('victorinox') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.victorinox_competition_market_payload_internal(
    greatest(25, least(coalesce(p_limit_per_brand, 250), 500))
  );
end;
$$;

revoke all on function public.brands_vertical_light_payload(text) from public, anon;
revoke all on function public.brands_vertical_official_history(text,integer) from public, anon;
revoke all on function public.victorinox_competition_market_payload(integer) from public, anon;

grant execute on function public.brands_vertical_light_payload(text) to authenticated, service_role;
grant execute on function public.brands_vertical_official_history(text,integer) to authenticated, service_role;
grant execute on function public.victorinox_competition_market_payload(integer) to authenticated, service_role;

commit;
