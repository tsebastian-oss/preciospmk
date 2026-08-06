create table if not exists public.enterprise_ui_metadata_cache (
  organization_id uuid primary key,
  filter_options jsonb not null default '{}'::jsonb,
  export_availability jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  refresh_duration_ms integer,
  refresh_error text
);

revoke all on table public.enterprise_ui_metadata_cache from public, anon, authenticated;

create or replace function public.enterprise_ui_metadata_build(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
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
    with product_scope as materialized (
      select p.id,p.supermarket,p.brand,p.category,p.smart_category,p.retailer_type,p.industry_slug
      from public.products p
      where exists (
        select 1 from public.price_observations po
        where po.product_id=p.id and po.crawl_run_id is not null
      )
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or p.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,p.category)=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), group_scope as materialized (
      select distinct d.product_id,d.supermarket,d.category_group
      from public.daily_pricing_live d
      join product_scope p on p.id=d.product_id
      where nullif(btrim(d.category_group),'') is not null
    ), group_options as (
      select 'group:'||category_group id,
        case category_group
          when 'non_alcoholic' then 'Bebidas no alcohólicas'
          when 'grocery' then 'Abarrotes'
          when 'alcoholic' then 'Bebidas alcohólicas'
          else initcap(replace(category_group,'_',' '))
        end label,
        'group' kind,
        count(distinct product_id)::integer products,
        count(distinct supermarket)::integer retailers,
        case category_group when 'non_alcoholic' then 1 when 'grocery' then 2 when 'alcoholic' then 3 else 20 end sort_order
      from group_scope group by category_group
    ), smart_options as (
      select 'smart:'||smart_category id,smart_category label,'smart' kind,
        count(*)::integer products,count(distinct supermarket)::integer retailers,30 sort_order
      from product_scope
      where nullif(btrim(smart_category),'') is not null
      group by smart_category
    ), category_options as (
      select * from group_options union all select * from smart_options
    ), brand_options as (
      select 'brand:'||btrim(brand) id,btrim(brand) label,'brand' kind,
        count(*)::integer products,count(distinct supermarket)::integer retailers
      from product_scope
      where nullif(btrim(brand),'') is not null
      group by btrim(brand)
    ), filter_options as (
      select jsonb_build_object(
        'defaults',coalesce((select jsonb_agg(id order by sort_order,label) from category_options where kind='group' and id in ('group:non_alcoholic','group:grocery','group:alcoholic')),'[]'::jsonb),
        'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'kind',kind,'products',products,'retailers',retailers) order by sort_order,products desc,label) from category_options),'[]'::jsonb),
        'brands',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'kind',kind,'products',products,'retailers',retailers) order by products desc,label) from brand_options),'[]'::jsonb),
        'maxSeries',8,'industrySlug',v_industry
      ) value
    ), availability_scope as materialized (
      select d.product_id,d.price_date,d.supermarket
      from public.daily_pricing_live d
      join product_scope p on p.id=d.product_id
    ), retailer_rows as (
      select supermarket,count(*)::bigint observations
      from availability_scope group by supermarket
    ), availability as (
      select jsonb_build_object(
        'firstDate',min(price_date),'lastDate',max(price_date),'observations',count(*),
        'products',count(distinct product_id),'industrySlug',v_industry,
        'retailers',coalesce((select jsonb_agg(jsonb_build_object('supermarket',supermarket,'observations',observations) order by supermarket) from retailer_rows),'[]'::jsonb)
      ) value from availability_scope
    )
    select jsonb_build_object('filterOptions',(select value from filter_options),'exportAvailability',(select value from availability))
  );
end;
$$;

create or replace function public.refresh_enterprise_ui_metadata_cache(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
set statement_timeout='120s'
as $$
declare
  v_started timestamptz:=clock_timestamp();
  v_payload jsonb;
begin
  v_payload:=public.enterprise_ui_metadata_build(p_organization_id);
  insert into public.enterprise_ui_metadata_cache(organization_id,filter_options,export_availability,refreshed_at,refresh_duration_ms,refresh_error)
  values(p_organization_id,coalesce(v_payload->'filterOptions','{}'::jsonb),coalesce(v_payload->'exportAvailability','{}'::jsonb),clock_timestamp(),greatest(0,round(extract(epoch from(clock_timestamp()-v_started))*1000)::integer),null)
  on conflict(organization_id) do update set
    filter_options=excluded.filter_options,
    export_availability=excluded.export_availability,
    refreshed_at=excluded.refreshed_at,
    refresh_duration_ms=excluded.refresh_duration_ms,
    refresh_error=null;
exception when others then
  insert into public.enterprise_ui_metadata_cache(organization_id,refresh_error)
  values(p_organization_id,sqlerrm)
  on conflict(organization_id) do update set refresh_error=excluded.refresh_error;
end;
$$;

create or replace function public.refresh_all_enterprise_ui_metadata_cache()
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
set statement_timeout='240s'
as $$
declare r record;
begin
  for r in select organization_id from public.organization_scopes loop
    perform public.refresh_enterprise_ui_metadata_cache(r.organization_id);
  end loop;
end;
$$;

create or replace function public.enterprise_daily_pricing_filter_options(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare v_payload jsonb; v_refreshed timestamptz; v_error text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select filter_options,refreshed_at,refresh_error into v_payload,v_refreshed,v_error
  from public.enterprise_ui_metadata_cache where organization_id=p_organization_id;
  return coalesce(v_payload,jsonb_build_object('defaults','[]'::jsonb,'categories','[]'::jsonb,'brands','[]'::jsonb,'maxSeries',8))
    || jsonb_build_object('cache',jsonb_build_object('refreshedAt',v_refreshed,'error',v_error));
end;
$$;

create or replace function public.enterprise_export_availability(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare v_payload jsonb; v_refreshed timestamptz; v_error text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select export_availability,refreshed_at,refresh_error into v_payload,v_refreshed,v_error
  from public.enterprise_ui_metadata_cache where organization_id=p_organization_id;
  return coalesce(v_payload,jsonb_build_object('firstDate',null,'lastDate',null,'observations',0,'products',0,'retailers','[]'::jsonb))
    || jsonb_build_object('cache',jsonb_build_object('refreshedAt',v_refreshed,'error',v_error));
end;
$$;

create or replace function public.enterprise_export_filter_options(
  p_organization_id uuid,
  p_retailer text default null,
  p_category text default null,
  p_search text default null,
  p_limit integer default 800
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
set statement_timeout='15s'
as $$
declare
  v_retailers text[]; v_brands text[]; v_categories text[]; v_industry text;
  v_limit integer:=greatest(50,least(coalesce(p_limit,800),2500));
  v_cached_categories jsonb:='[]'::jsonb;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  if p_retailer is not null and coalesce(cardinality(v_retailers),0)>0 and not p_retailer=any(v_retailers) then
    raise exception 'retailer_not_allowed' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'value',x->>'label','label',x->>'label','products',coalesce((x->>'products')::integer,0),'retailers',coalesce((x->>'retailers')::integer,0)
  ) order by coalesce((x->>'products')::integer,0) desc,x->>'label'),'[]'::jsonb)
  into v_cached_categories
  from public.enterprise_ui_metadata_cache c
  cross join lateral jsonb_array_elements(coalesce(c.filter_options->'categories','[]'::jsonb)) x
  where c.organization_id=p_organization_id and x->>'kind'='smart';

  return (
    with matching_products as materialized (
      select p.id,p.supermarket,p.external_id,p.name,p.brand,p.category,p.smart_category,p.industry_slug
      from public.products p
      where p_category is not null
        and p.smart_category=p_category
        and exists(select 1 from public.price_observations po where po.product_id=p.id and po.crawl_run_id is not null)
        and (p_retailer is null or p.supermarket=p_retailer)
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or p.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,p.category)=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (
          nullif(btrim(coalesce(p_search,'')),'') is null
          or p.name ilike '%'||btrim(p_search)||'%'
          or coalesce(p.brand,'') ilike '%'||btrim(p_search)||'%'
          or p.external_id ilike '%'||btrim(p_search)||'%'
        )
    ), retailer_rows as (
      select supermarket,count(*)::integer products from matching_products group by supermarket
    ), ranked as (
      select m.*,row_number() over(partition by supermarket order by name,brand nulls last,external_id,id) retailer_rank
      from matching_products m
    ), product_rows as (
      select * from ranked order by retailer_rank,supermarket,name,brand nulls last,external_id limit v_limit
    )
    select jsonb_build_object(
      'industrySlug',v_industry,'aiFiltered',true,'balancedByRetailer',true,
      'retailer',p_retailer,'category',p_category,'categories',v_cached_categories,
      'retailerCounts',coalesce((select jsonb_agg(jsonb_build_object('supermarket',supermarket,'products',products) order by products desc,supermarket) from retailer_rows),'[]'::jsonb),
      'products',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'externalId',external_id,'name',name,'brand',brand,'supermarket',supermarket,
        'category',smart_category,'rawCategory',category,'industrySlug',industry_slug
      ) order by retailer_rank,supermarket,name,brand nulls last,external_id) from product_rows),'[]'::jsonb),
      'productCount',(select count(*)::integer from matching_products),
      'truncated',(select count(*)>v_limit from matching_products),'limit',v_limit
    )
  );
end;
$$;

create or replace function public.enterprise_daily_pricing_trend_v2(
  p_organization_id uuid,
  p_days integer default 30,
  p_series text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
set statement_timeout='15s'
as $$
declare
  v_retailers text[]; v_brands text[]; v_categories text[]; v_industry text;
  v_days integer:=greatest(7,least(coalesce(p_days,30),365));
  v_today date:=(current_timestamp at time zone 'America/Santiago')::date;
  v_series text[]:=case when coalesce(cardinality(p_series),0)=0 then array['group:non_alcoholic','group:grocery','group:alcoholic']::text[] else p_series end;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with selected_raw as materialized (
      select btrim(token) id,min(ord)::integer ord
      from unnest(v_series) with ordinality values(token,ord)
      where nullif(btrim(token),'') is not null and (token like 'group:%' or token like 'smart:%' or token like 'brand:%')
      group by btrim(token) order by min(ord) limit 8
    ), selected as materialized (
      select id,ord,
        case when id like 'brand:%' then 'brand' else 'category' end dimension,
        case when id like 'group:%' then 'group' when id like 'smart:%' then 'smart' else 'brand' end kind,
        case when id='group:non_alcoholic' then 'Bebidas no alcohólicas' when id='group:grocery' then 'Abarrotes' when id='group:alcoholic' then 'Bebidas alcohólicas' else substring(id from position(':' in id)+1) end label,
        substring(id from position(':' in id)+1) filter_value
      from selected_raw
    ), group_matched as materialized (
      select s.id series_id,s.label,s.dimension,s.kind,s.ord,d.price_date,d.effective_price,d.product_id,d.observed_at
      from selected s
      join public.daily_pricing_live d on s.kind='group' and d.category_group=s.filter_value and d.price_date>=v_today-(v_days-1)
      join public.products p on p.id=d.product_id
      where d.effective_price>0
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or d.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,d.category)=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), brand_matched as materialized (
      select s.id series_id,s.label,s.dimension,s.kind,s.ord,d.price_date,d.effective_price,d.product_id,d.observed_at
      from selected s
      join public.daily_pricing_live d on s.kind='brand' and d.brand=s.filter_value and d.price_date>=v_today-(v_days-1)
      join public.products p on p.id=d.product_id
      where d.effective_price>0
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or d.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,d.category)=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), smart_matched as materialized (
      select s.id series_id,s.label,s.dimension,s.kind,s.ord,d.price_date,d.effective_price,d.product_id,d.observed_at
      from selected s
      join public.products p on s.kind='smart' and p.smart_category=s.filter_value
      join public.daily_pricing_live d on d.product_id=p.id and d.price_date>=v_today-(v_days-1)
      where d.effective_price>0
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or d.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,d.category)=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), matched as materialized (
      select * from group_matched union all select * from brand_matched union all select * from smart_matched
    ), ranked as (
      select m.*,percent_rank() over(partition by price_date,series_id order by effective_price) price_rank from matched m
    ), daily as materialized (
      select price_date,series_id,
        round(coalesce(avg(effective_price) filter(where price_rank between 0.05 and 0.95),avg(effective_price))::numeric,0) average_price,
        case when count(*) filter(where price_rank between 0.05 and 0.95)>0 then count(*) filter(where price_rank between 0.05 and 0.95) else count(*) end::integer sku_count
      from ranked group by price_date,series_id
    ), period as (
      select count(distinct price_date)::integer available_days,min(price_date) first_date,max(price_date) last_date,max(observed_at) refreshed_at from matched
    ), day_counts as (
      select count(*) filter(where price_date=v_today)::integer today_count,count(*) filter(where price_date=v_today-1)::integer previous_count from matched
    ), series_json as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'label',s.label,'dimension',s.dimension,'kind',s.kind,
        'points',coalesce((select jsonb_agg(jsonb_build_object('date',d.price_date,'price',d.average_price,'skus',d.sku_count) order by d.price_date) from daily d where d.series_id=s.id),'[]'::jsonb)
      ) order by s.ord),'[]'::jsonb) value from selected s
    )
    select jsonb_build_object(
      'series',(select value from series_json),'selectedSeries',coalesce((select jsonb_agg(id order by ord) from selected),'[]'::jsonb),
      'daysRequested',v_days,'availableDays',coalesce((select available_days from period),0),
      'firstDate',(select first_date from period),'lastDate',(select last_date from period),
      'refreshedAt',(select refreshed_at from period),'latestObservationAt',(select refreshed_at from period),
      'partialDay',coalesce((select last_date=v_today from period),false),'live',true,'pollingSeconds',60,'historicalDaysFrozen',true,
      'currentDayObservations',coalesce((select today_count from day_counts),0),'previousDayObservations',coalesce((select previous_count from day_counts),0),
      'currentDayCoveragePct',case when coalesce((select previous_count from day_counts),0)=0 then null else least(100,round((select today_count from day_counts)::numeric/greatest((select previous_count from day_counts),1)*100,1)) end,
      'method','trimmed_mean_indexed_dynamic_series','trimLowerPct',5,'trimUpperPct',95,'minimumPresencePct',0,'currency','CLP','maxSeries',8
    )
  );
end;
$$;

revoke all on function public.enterprise_ui_metadata_build(uuid) from public,anon,authenticated;
revoke all on function public.refresh_enterprise_ui_metadata_cache(uuid) from public,anon,authenticated;
revoke all on function public.refresh_all_enterprise_ui_metadata_cache() from public,anon,authenticated;
grant execute on function public.enterprise_daily_pricing_filter_options(uuid) to authenticated;
grant execute on function public.enterprise_export_availability(uuid) to authenticated;
grant execute on function public.enterprise_export_filter_options(uuid,text,text,text,integer) to authenticated;
grant execute on function public.enterprise_daily_pricing_trend_v2(uuid,integer,text[]) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname='refresh-enterprise-ui-metadata-cache';
select cron.schedule('refresh-enterprise-ui-metadata-cache','*/5 * * * *',$$select public.refresh_all_enterprise_ui_metadata_cache();$$);

select public.refresh_all_enterprise_ui_metadata_cache();