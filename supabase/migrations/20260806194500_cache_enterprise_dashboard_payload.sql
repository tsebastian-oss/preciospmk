create table if not exists public.enterprise_dashboard_cache (
  organization_id uuid primary key,
  payload jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  refresh_duration_ms integer,
  refresh_error text
);

revoke all on table public.enterprise_dashboard_cache from public, anon, authenticated;

create or replace function public.enterprise_dashboard_build(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private
set statement_timeout='120s'
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
begin
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with filtered as materialized (
      select *
      from public.dashboard_products p
      where (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(select 1 from unnest(v_brands)b where lower(b)=lower(coalesce(p.brand,''))))
        and (coalesce(cardinality(v_categories),0)=0 or exists(select 1 from unnest(v_categories)c where lower(c)=lower(coalesce(p.smart_category,p.category,''))))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), summary as (
      select jsonb_build_object(
        'total_products',count(*),
        'in_stock_products',count(*) filter(where in_stock),
        'offers',count(*) filter(where coalesce(discount_pct,0)>0),
        'supermarkets',count(distinct supermarket),
        'average_price',coalesce(round(avg(nullif(coalesce(offer_price,regular_price),0)),2),0),
        'total_savings',coalesce(round(sum(coalesce(savings,0)),2),0),
        'last_updated',max(observed_at)
      ) value from filtered
    ), stores as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'supermarket',supermarket,'products',products,'in_stock',in_stock,
        'offers',offers,'average_price',average_price,'average_discount',average_discount,
        'last_updated',last_updated
      ) order by products desc),'[]'::jsonb) value
      from (
        select supermarket,count(*) products,count(*) filter(where in_stock) in_stock,
          count(*) filter(where coalesce(discount_pct,0)>0) offers,
          coalesce(round(avg(nullif(coalesce(offer_price,regular_price),0)),2),0) average_price,
          coalesce(round(avg(coalesce(discount_pct,0)),2),0) average_discount,
          max(observed_at) last_updated
        from filtered group by supermarket
      ) s
    ), categories as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'supermarket',supermarket,'category',category,'products',products
      ) order by products desc),'[]'::jsonb) value
      from (
        select supermarket,coalesce(smart_category,category,'Sin categoría') category,count(*) products
        from filtered
        group by supermarket,coalesce(smart_category,category,'Sin categoría')
        order by products desc limit 1000
      ) c
    ), offers as (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.discount_pct desc,x.savings desc),'[]'::jsonb) value
      from (
        select id,supermarket,external_id,name,brand,
          coalesce(smart_category,category) category,url,image_url,regular_price,offer_price,unit,unit_price,
          in_stock,observed_at,savings,discount_pct
        from filtered
        where coalesce(discount_pct,0)>0
        order by discount_pct desc,savings desc limit 8
      ) x
    ), latest_run as (
      select to_jsonb(r) value
      from (
        select id,status,vertical,started_at,finished_at,tasks_total,tasks_completed,tasks_failed,
          products_found,source_counts,errors
        from public.catalog_crawl_runs
        order by id desc limit 1
      ) r
    )
    select jsonb_build_object(
      'summary',(select value from summary),
      'supermarkets',(select value from stores),
      'categories',(select value from categories),
      'run',(select value from latest_run),
      'topOffers',(select value from offers),
      'organizationId',p_organization_id,
      'industrySlug',v_industry
    )
  );
end;
$$;

create or replace function public.refresh_enterprise_dashboard_cache(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private
set statement_timeout='120s'
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_payload jsonb;
begin
  v_payload := public.enterprise_dashboard_build(p_organization_id);
  insert into public.enterprise_dashboard_cache(organization_id,payload,refreshed_at,refresh_duration_ms,refresh_error)
  values (p_organization_id,v_payload,clock_timestamp(),greatest(0,round(extract(epoch from (clock_timestamp()-v_started))*1000)::integer),null)
  on conflict (organization_id) do update set
    payload=excluded.payload,
    refreshed_at=excluded.refreshed_at,
    refresh_duration_ms=excluded.refresh_duration_ms,
    refresh_error=null;
exception when others then
  insert into public.enterprise_dashboard_cache(organization_id,payload,refreshed_at,refresh_duration_ms,refresh_error)
  values (p_organization_id,'{}'::jsonb,coalesce((select refreshed_at from public.enterprise_dashboard_cache where organization_id=p_organization_id),now()),null,sqlerrm)
  on conflict (organization_id) do update set refresh_error=excluded.refresh_error;
end;
$$;

create or replace function public.refresh_all_enterprise_dashboard_cache()
returns void
language plpgsql
security definer
set search_path=public,private
set statement_timeout='180s'
as $$
declare r record;
begin
  for r in select organization_id from public.organization_scopes loop
    perform public.refresh_enterprise_dashboard_cache(r.organization_id);
  end loop;
end;
$$;

create or replace function public.enterprise_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private
as $$
declare
  v_payload jsonb;
  v_refreshed_at timestamptz;
  v_duration integer;
  v_error text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select payload,refreshed_at,refresh_duration_ms,refresh_error
    into v_payload,v_refreshed_at,v_duration,v_error
  from public.enterprise_dashboard_cache
  where organization_id=p_organization_id;

  if v_payload is null or v_payload='{}'::jsonb then
    return jsonb_build_object(
      'summary',null,'supermarkets','[]'::jsonb,'categories','[]'::jsonb,
      'run',null,'topOffers','[]'::jsonb,'organizationId',p_organization_id,
      'cache',jsonb_build_object('ready',false,'refreshedAt',v_refreshed_at,'error',v_error)
    );
  end if;

  return v_payload || jsonb_build_object('cache',jsonb_build_object(
    'ready',true,
    'refreshedAt',v_refreshed_at,
    'ageSeconds',greatest(0,extract(epoch from (clock_timestamp()-v_refreshed_at))::integer),
    'refreshDurationMs',v_duration,
    'error',v_error
  ));
end;
$$;

revoke all on function public.enterprise_dashboard_build(uuid) from public,anon,authenticated;
revoke all on function public.refresh_enterprise_dashboard_cache(uuid) from public,anon,authenticated;
revoke all on function public.refresh_all_enterprise_dashboard_cache() from public,anon,authenticated;
grant execute on function public.enterprise_dashboard(uuid) to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname='refresh-enterprise-dashboard-cache';

select cron.schedule(
  'refresh-enterprise-dashboard-cache',
  '*/2 * * * *',
  $$select public.refresh_all_enterprise_dashboard_cache();$$
);

do $$
declare r record;
begin
  for r in select organization_id from public.organization_scopes loop
    perform public.refresh_enterprise_dashboard_cache(r.organization_id);
  end loop;
end;
$$;
