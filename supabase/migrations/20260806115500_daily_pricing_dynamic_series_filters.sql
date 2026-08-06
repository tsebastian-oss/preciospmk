create index if not exists daily_pricing_live_date_brand_price_idx
  on public.daily_pricing_live(price_date,brand,effective_price)
  where nullif(btrim(brand),'') is not null;

create index if not exists daily_pricing_live_date_group_price_idx
  on public.daily_pricing_live(price_date,category_group,effective_price);

create index if not exists products_smart_category_idx
  on public.products(smart_category)
  where nullif(btrim(smart_category),'') is not null;

create or replace function public.enterprise_daily_pricing_filter_options(
  p_organization_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with scoped as materialized (
      select distinct d.product_id,d.supermarket,d.brand,d.category_group,
        coalesce(nullif(btrim(p.smart_category),''),nullif(btrim(d.category),''),'Sin categoría') smart_category
      from public.daily_pricing_live d
      join public.products p on p.id=d.product_id
      where (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(
          select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(d.brand,''))
        ))
        and (coalesce(cardinality(v_categories),0)=0 or exists(
          select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(d.category,''))
        ))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
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
      from scoped
      where nullif(btrim(category_group),'') is not null
      group by category_group
    ), smart_options as (
      select 'smart:'||smart_category id,smart_category label,'smart' kind,
        count(distinct product_id)::integer products,
        count(distinct supermarket)::integer retailers,
        30 sort_order
      from scoped
      where nullif(btrim(smart_category),'') is not null
      group by smart_category
    ), category_options as (
      select * from group_options
      union all
      select * from smart_options
    ), brand_options as (
      select 'brand:'||btrim(brand) id,btrim(brand) label,'brand' kind,
        count(distinct product_id)::integer products,
        count(distinct supermarket)::integer retailers
      from scoped
      where nullif(btrim(brand),'') is not null
      group by btrim(brand)
    )
    select jsonb_build_object(
      'defaults',coalesce((
        select jsonb_agg(id order by sort_order,label)
        from category_options
        where kind='group' and id in ('group:non_alcoholic','group:grocery','group:alcoholic')
      ),'[]'::jsonb),
      'categories',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',id,'label',label,'kind',kind,'products',products,'retailers',retailers
        ) order by sort_order,products desc,label)
        from category_options
      ),'[]'::jsonb),
      'brands',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',id,'label',label,'kind',kind,'products',products,'retailers',retailers
        ) order by products desc,label)
        from brand_options
      ),'[]'::jsonb),
      'maxSeries',8,
      'industrySlug',v_industry
    )
  );
end;
$$;

create or replace function public.enterprise_daily_pricing_trend_v2(
  p_organization_id uuid,
  p_days integer default 30,
  p_series text[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
  v_days integer:=greatest(7,least(coalesce(p_days,30),365));
  v_today date:=(current_timestamp at time zone 'America/Santiago')::date;
  v_series text[]:=case when coalesce(cardinality(p_series),0)=0
    then array['group:non_alcoholic','group:grocery','group:alcoholic']::text[]
    else p_series end;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with selected_raw as materialized (
      select btrim(token) id,min(ord)::integer ord
      from unnest(v_series) with ordinality values(token,ord)
      where nullif(btrim(token),'') is not null
        and (token like 'group:%' or token like 'smart:%' or token like 'brand:%')
      group by btrim(token)
      order by min(ord)
      limit 8
    ), selected as materialized (
      select id,ord,
        case when id like 'brand:%' then 'brand' else 'category' end dimension,
        case when id like 'group:%' then 'group' when id like 'smart:%' then 'smart' else 'brand' end kind,
        case
          when id='group:non_alcoholic' then 'Bebidas no alcohólicas'
          when id='group:grocery' then 'Abarrotes'
          when id='group:alcoholic' then 'Bebidas alcohólicas'
          else substring(id from position(':' in id)+1)
        end label,
        substring(id from position(':' in id)+1) filter_value
      from selected_raw
    ), scoped as materialized (
      select d.*,coalesce(nullif(btrim(p.smart_category),''),nullif(btrim(d.category),''),'Sin categoría') smart_category
      from public.daily_pricing_live d
      join public.products p on p.id=d.product_id
      where d.price_date>=v_today-(v_days-1)
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(
          select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(d.brand,''))
        ))
        and (coalesce(cardinality(v_categories),0)=0 or exists(
          select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(d.category,''))
        ))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), matched as materialized (
      select s.id series_id,s.label,s.dimension,s.kind,s.ord,d.price_date,d.effective_price,d.product_id
      from scoped d
      join selected s on (
        (s.kind='group' and d.category_group=s.filter_value)
        or (s.kind='smart' and lower(d.smart_category)=lower(s.filter_value))
        or (s.kind='brand' and lower(coalesce(d.brand,''))=lower(s.filter_value))
      )
      where d.effective_price>0
    ), ranked as (
      select m.*,percent_rank() over(partition by m.price_date,m.series_id order by m.effective_price) price_rank
      from matched m
    ), daily as materialized (
      select price_date,series_id,
        round(coalesce(
          avg(effective_price) filter(where price_rank between 0.05 and 0.95),
          avg(effective_price)
        )::numeric,0) average_price,
        case when count(*) filter(where price_rank between 0.05 and 0.95)>0
          then count(*) filter(where price_rank between 0.05 and 0.95)
          else count(*) end::integer sku_count
      from ranked
      group by price_date,series_id
    ), period as (
      select count(distinct price_date)::integer available_days,min(price_date) first_date,
        max(price_date) last_date,max(observed_at) refreshed_at
      from scoped
    ), day_counts as (
      select count(*) filter(where price_date=v_today)::integer today_count,
        count(*) filter(where price_date=v_today-1)::integer previous_count
      from scoped
    ), series_json as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'label',s.label,'dimension',s.dimension,'kind',s.kind,
        'points',coalesce((
          select jsonb_agg(jsonb_build_object(
            'date',d.price_date,'price',d.average_price,'skus',d.sku_count
          ) order by d.price_date)
          from daily d where d.series_id=s.id
        ),'[]'::jsonb)
      ) order by s.ord),'[]'::jsonb) value
      from selected s
    )
    select jsonb_build_object(
      'series',(select value from series_json),
      'selectedSeries',coalesce((select jsonb_agg(id order by ord) from selected),'[]'::jsonb),
      'daysRequested',v_days,
      'availableDays',coalesce((select available_days from period),0),
      'firstDate',(select first_date from period),
      'lastDate',(select last_date from period),
      'refreshedAt',(select refreshed_at from period),
      'latestObservationAt',(select refreshed_at from period),
      'partialDay',coalesce((select last_date=v_today from period),false),
      'live',true,'pollingSeconds',20,'historicalDaysFrozen',true,
      'currentDayObservations',coalesce((select today_count from day_counts),0),
      'previousDayObservations',coalesce((select previous_count from day_counts),0),
      'currentDayCoveragePct',case when coalesce((select previous_count from day_counts),0)=0 then null
        else least(100,round((select today_count from day_counts)::numeric/greatest((select previous_count from day_counts),1)*100,1)) end,
      'method','trimmed_mean_live_dynamic_series','trimLowerPct',5,'trimUpperPct',95,
      'minimumPresencePct',0,'currency','CLP','maxSeries',8
    )
  );
end;
$$;

grant execute on function public.enterprise_daily_pricing_filter_options(uuid) to authenticated;
grant execute on function public.enterprise_daily_pricing_trend_v2(uuid,integer,text[]) to authenticated;
