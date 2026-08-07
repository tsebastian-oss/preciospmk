create or replace function public.enterprise_contextual_pricing_trend(
  p_organization_id uuid,
  p_days integer default 30,
  p_retailer_type text default null,
  p_supermarket text default null,
  p_category text default null,
  p_brand text default null,
  p_stock text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
set statement_timeout = '8s'
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
  v_days integer := greatest(7, least(coalesce(p_days, 30), 365));
  v_today date := (current_timestamp at time zone 'America/Santiago')::date;
  v_type text := case when p_retailer_type in ('supermarket','department_store','pharmacy') then p_retailer_type else null end;
  v_store text := nullif(btrim(coalesce(p_supermarket,'')), '');
  v_category text := nullif(btrim(coalesce(p_category,'')), '');
  v_brand text := nullif(btrim(coalesce(p_brand,'')), '');
  v_stock text := case when p_stock in ('in','out') then p_stock else 'all' end;
  v_mode text;
  v_scope_label text;
begin
  perform public.enterprise_access_context(p_organization_id, 'overview');

  select s.retailers, s.brands, s.categories, os.industry_slug
    into v_retailers, v_brands, v_categories, v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id = s.organization_id
  where s.organization_id = p_organization_id;

  if v_brand is not null then
    v_mode := 'brand';
    v_scope_label := v_brand || ' · evolución de precio promedio';
  elsif v_category is not null then
    v_mode := 'brand_top';
    v_scope_label := 'Top 3 marcas · ' || v_category;
  elsif v_store is not null then
    v_mode := 'category_top';
    v_scope_label := 'Top 3 categorías · ' || v_store;
  elsif v_type is not null then
    v_mode := 'category_top';
    v_scope_label := 'Top 3 categorías · ' || case v_type when 'pharmacy' then 'Farmacias' when 'supermarket' then 'Supermercados' else 'Multitiendas' end;
  else
    v_mode := 'retailer_type';
    v_scope_label := 'Supermercados vs Farmacias · índice base 100';
  end if;

  return (
    with facet_scope as materialized (
      select f.*,
        case v_stock when 'in' then f.in_stock when 'out' then f.out_of_stock else f.products end as scoped_products
      from public.product_filter_facets f
      where (coalesce(cardinality(v_retailers),0)=0 or f.supermarket = any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or f.brand is null or f.brand = any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or f.category is null or f.category = any(v_categories))
        and public.product_industry_allowed(v_industry, f.industry_slug, f.retailer_type)
        and (v_type is null or f.retailer_type = v_type)
        and (v_store is null or f.supermarket = v_store)
        and (v_category is null or f.category = v_category)
        and (v_brand is null or f.brand = v_brand)
    ), category_ranked as materialized (
      select f.category as value, sum(f.scoped_products)::bigint products
      from facet_scope f
      where f.category is not null and f.scoped_products > 0
      group by f.category
      order by products desc, f.category asc
      limit 3
    ), brand_ranked as materialized (
      select f.brand as value, sum(f.scoped_products)::bigint products
      from facet_scope f
      where f.brand is not null and f.scoped_products > 0
      group by f.brand
      order by products desc, f.brand asc
      limit 3
    ), selected as materialized (
      select 'scope:supermarkets'::text id, 'Supermercados'::text label, 'group'::text kind, 'supermarket'::text filter_value, 1::integer ord where v_mode = 'retailer_type'
      union all
      select 'scope:pharmacies', 'Farmacias', 'group', 'pharmacy', 2 where v_mode = 'retailer_type'
      union all
      select 'smart:' || c.value, c.value, 'smart', c.value, row_number() over(order by c.products desc, c.value)::integer from category_ranked c where v_mode = 'category_top'
      union all
      select 'brand:' || b.value, b.value, 'brand', b.value, row_number() over(order by b.products desc, b.value)::integer from brand_ranked b where v_mode = 'brand_top'
      union all
      select 'brand:' || v_brand, v_brand, 'brand', v_brand, 1 where v_mode = 'brand'
    ), source as materialized (
      select d.product_id,d.price_date,d.observed_at,d.supermarket,d.brand,
        coalesce(nullif(btrim(p.smart_category),''), nullif(btrim(d.category),'')) as smart_category,
        p.retailer_type,d.effective_price
      from public.daily_pricing_live d
      join public.products p on p.id = d.product_id
      left join public.product_latest_price_state ls on ls.product_id = d.product_id
      where d.price_date >= v_today - (v_days - 1)
        and d.effective_price > 0
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket = any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or d.brand = any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(nullif(btrim(p.smart_category),''), nullif(btrim(d.category),'')) = any(v_categories))
        and public.product_industry_allowed(v_industry, p.industry_slug, p.retailer_type)
        and (v_type is null or p.retailer_type = v_type)
        and (v_store is null or d.supermarket = v_store)
        and (v_category is null or coalesce(nullif(btrim(p.smart_category),''), nullif(btrim(d.category),'')) = v_category)
        and (v_brand is null or d.brand = v_brand)
        and (v_stock = 'all' or (v_stock = 'in' and ls.in_stock is true) or (v_stock = 'out' and ls.in_stock is false))
    ), matched as materialized (
      select s.id series_id,s.label,s.kind,s.ord,d.price_date,d.effective_price,d.product_id,d.observed_at
      from source d join selected s on
        (v_mode = 'retailer_type' and d.retailer_type = s.filter_value)
        or (v_mode = 'category_top' and d.smart_category = s.filter_value)
        or (v_mode in ('brand_top','brand') and d.brand = s.filter_value)
    ), ranked as (
      select m.*, percent_rank() over(partition by price_date, series_id order by effective_price) price_rank from matched m
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
        'id',s.id,'label',s.label,'dimension',case when s.kind='brand' then 'brand' else 'category' end,'kind',s.kind,
        'points',coalesce((select jsonb_agg(jsonb_build_object('date',d.price_date,'price',d.average_price,'skus',d.sku_count) order by d.price_date) from daily d where d.series_id=s.id),'[]'::jsonb)
      ) order by s.ord),'[]'::jsonb) value from selected s
    )
    select jsonb_build_object(
      'series',(select value from series_json),'selectedSeries',coalesce((select jsonb_agg(id order by ord) from selected),'[]'::jsonb),
      'daysRequested',v_days,'availableDays',coalesce((select available_days from period),0),'firstDate',(select first_date from period),'lastDate',(select last_date from period),
      'refreshedAt',(select refreshed_at from period),'latestObservationAt',(select refreshed_at from period),'partialDay',coalesce((select last_date=v_today from period),false),
      'live',true,'pollingSeconds',60,'historicalDaysFrozen',true,'currentDayObservations',coalesce((select today_count from day_counts),0),
      'previousDayObservations',coalesce((select previous_count from day_counts),0),
      'currentDayCoveragePct',case when coalesce((select previous_count from day_counts),0)=0 then null else least(100,round((select today_count from day_counts)::numeric/greatest((select previous_count from day_counts),1)*100,1)) end,
      'method','trimmed_mean_contextual_auto_series','trimLowerPct',5,'trimUpperPct',95,'minimumPresencePct',0,'currency','CLP','maxSeries',3,
      'autoSelected',true,'mode',v_mode,'scopeLabel',v_scope_label
    )
  );
end;
$$;

revoke execute on function public.enterprise_contextual_pricing_trend(uuid,integer,text,text,text,text,text) from public;
revoke execute on function public.enterprise_contextual_pricing_trend(uuid,integer,text,text,text,text,text) from anon;
grant execute on function public.enterprise_contextual_pricing_trend(uuid,integer,text,text,text,text,text) to authenticated;
