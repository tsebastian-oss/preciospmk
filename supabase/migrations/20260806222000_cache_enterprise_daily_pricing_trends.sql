create table if not exists public.enterprise_daily_pricing_trend_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  days integer not null check (days in (30,60,90)),
  series_key text not null,
  selected_series text[] not null,
  payload jsonb not null,
  refreshed_at timestamptz not null default now(),
  refresh_duration_ms integer,
  refresh_error text,
  primary key (organization_id, days, series_key)
);

alter table public.enterprise_daily_pricing_trend_cache enable row level security;

create or replace function public.enterprise_daily_pricing_trend_cached(
  p_organization_id uuid,
  p_days integer default 30,
  p_series text[] default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '15s'
as $$
declare
  v_days integer := case when coalesce(p_days,30) in (30,60,90) then coalesce(p_days,30) else 30 end;
  v_series text[] := case when coalesce(cardinality(p_series),0)=0 then array['group:non_alcoholic','group:grocery','group:alcoholic']::text[] else p_series end;
  v_key text;
  v_payload jsonb;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select string_agg(btrim(x), '|' order by ord) into v_key
  from unnest(v_series) with ordinality u(x,ord)
  where nullif(btrim(x),'') is not null;

  select c.payload || jsonb_build_object(
      'cacheHit',true,
      'cacheRefreshedAt',c.refreshed_at,
      'cacheAgeSeconds',greatest(0,extract(epoch from (now()-c.refreshed_at))::integer)
    ) into v_payload
  from public.enterprise_daily_pricing_trend_cache c
  where c.organization_id=p_organization_id and c.days=v_days and c.series_key=v_key and c.refresh_error is null;

  if v_payload is not null then return v_payload; end if;

  begin
    return public.enterprise_daily_pricing_trend_v2(p_organization_id,v_days,v_series) || jsonb_build_object('cacheHit',false);
  exception when query_canceled then
    return jsonb_build_object(
      'series','[]'::jsonb,'selectedSeries',to_jsonb(v_series),'daysRequested',v_days,
      'availableDays',0,'firstDate',null,'lastDate',null,'refreshedAt',null,'latestObservationAt',null,
      'partialDay',false,'live',true,'pollingSeconds',300,'historicalDaysFrozen',true,
      'currentDayObservations',0,'previousDayObservations',0,'currentDayCoveragePct',null,
      'method','cached_trend_temporarily_unavailable','trimLowerPct',5,'trimUpperPct',95,
      'minimumPresencePct',0,'currency','CLP','maxSeries',8,'cacheHit',false,'temporarilyUnavailable',true
    );
  end;
end;
$$;

revoke all on function public.enterprise_daily_pricing_trend_cached(uuid,integer,text[]) from public;
grant execute on function public.enterprise_daily_pricing_trend_cached(uuid,integer,text[]) to authenticated, service_role;

create or replace function public.refresh_enterprise_daily_pricing_trend_cache()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '120s'
as $$
declare
  r record;
  v_days integer;
  v_series constant text[] := array['group:non_alcoholic','group:grocery','group:alcoholic']::text[];
  v_key constant text := 'group:non_alcoholic|group:grocery|group:alcoholic';
  v_payload jsonb;
  v_started timestamptz;
  v_ok integer := 0;
  v_failed integer := 0;
begin
  for r in
    select o.id organization_id,
           (select om.user_id from public.organization_members om where om.organization_id=o.id and om.status='active' order by case when om.role='owner' then 0 else 1 end limit 1) user_id
    from public.organizations o where o.status in ('trial','active')
  loop
    if r.user_id is null then continue; end if;
    perform set_config('request.jwt.claim.sub',r.user_id::text,true);
    foreach v_days in array array[30,60,90]
    loop
      v_started := clock_timestamp();
      begin
        v_payload := public.enterprise_daily_pricing_trend_v2(r.organization_id,v_days,v_series);
        insert into public.enterprise_daily_pricing_trend_cache(
          organization_id,days,series_key,selected_series,payload,refreshed_at,refresh_duration_ms,refresh_error
        ) values (
          r.organization_id,v_days,v_key,v_series,v_payload,now(),
          round(extract(epoch from (clock_timestamp()-v_started))*1000)::integer,null
        )
        on conflict (organization_id,days,series_key) do update set
          selected_series=excluded.selected_series,payload=excluded.payload,refreshed_at=excluded.refreshed_at,
          refresh_duration_ms=excluded.refresh_duration_ms,refresh_error=null;
        v_ok := v_ok + 1;
      exception when others then
        insert into public.enterprise_daily_pricing_trend_cache(
          organization_id,days,series_key,selected_series,payload,refreshed_at,refresh_duration_ms,refresh_error
        ) values (
          r.organization_id,v_days,v_key,v_series,'{}'::jsonb,now(),
          round(extract(epoch from (clock_timestamp()-v_started))*1000)::integer,left(sqlerrm,500)
        )
        on conflict (organization_id,days,series_key) do update set
          refreshed_at=excluded.refreshed_at,refresh_duration_ms=excluded.refresh_duration_ms,refresh_error=excluded.refresh_error;
        v_failed := v_failed + 1;
      end;
    end loop;
  end loop;
  return jsonb_build_object('ok',v_ok,'failed',v_failed,'refreshedAt',now());
end;
$$;

revoke all on function public.refresh_enterprise_daily_pricing_trend_cache() from public;
grant execute on function public.refresh_enterprise_daily_pricing_trend_cache() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='refresh-enterprise-daily-pricing-trend-cache';
select cron.schedule('refresh-enterprise-daily-pricing-trend-cache','*/5 * * * *',$cron$select public.refresh_enterprise_daily_pricing_trend_cache();$cron$);
select public.refresh_enterprise_daily_pricing_trend_cache();
