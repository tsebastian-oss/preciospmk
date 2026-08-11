-- Database exploration layer for MGP Intelligence.
-- Grounded on products, product_latest_price_state and daily_pricing_live.

create or replace function public.enterprise_ai_data_inventory_v1(
  p_organization_id uuid,
  p_days integer default 30
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '20s'
as $function$
declare
  v_access jsonb;
  v_retailers text[] := '{}';
  v_brands text[] := '{}';
  v_categories text[] := '{}';
  v_industry text;
  v_days integer := greatest(7,least(coalesce(p_days,30),365));
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
begin
  if auth.uid() is null and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'not_authenticated' using errcode='28000';
  end if;
  v_access := public.enterprise_access_context(p_organization_id,'pricing');
  select coalesce(array_agg(value),'{}') into v_retailers from jsonb_array_elements_text(coalesce(v_access->'retailers','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_brands from jsonb_array_elements_text(coalesce(v_access->'brands','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_categories from jsonb_array_elements_text(coalesce(v_access->'categories','[]'::jsonb)) t(value);
  v_industry := nullif(v_access->>'industrySlug','');

  return (
    with scoped as materialized (
      select d.price_date,d.product_id,d.observed_at,d.supermarket,d.brand,d.category,p.retailer_type,
             coalesce(nullif(p.smart_category,''),nullif(d.category,''),'Sin categoría') smart_category
      from public.daily_pricing_live d
      join public.products p on p.id=d.product_id
      where (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or regexp_replace(lower(coalesce(d.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or regexp_replace(lower(coalesce(p.smart_category,d.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), bounds as (
      select min(price_date) first_date,max(price_date) last_date,max(observed_at) last_observed_at,
             count(distinct product_id)::int products,count(distinct supermarket)::int retailers
      from scoped
    ), recent as materialized (
      select * from scoped where price_date>=v_today-(v_days-1)
    ), daily as (
      select price_date,count(*)::int rows,count(distinct product_id)::int products,count(distinct supermarket)::int retailers
      from recent group by price_date order by price_date
    ), retailer_stats as (
      select supermarket,retailer_type,count(distinct product_id)::int products,min(price_date) first_date,max(price_date) last_date
      from scoped group by supermarket,retailer_type order by products desc
    ), category_stats as (
      select smart_category category,count(distinct product_id)::int products,count(distinct supermarket)::int retailers
      from recent where smart_category is not null group by smart_category order by products desc limit 20
    ), brand_stats as (
      select brand,count(distinct product_id)::int products,count(distinct supermarket)::int retailers
      from recent where nullif(btrim(brand),'') is not null group by brand order by products desc limit 20
    )
    select jsonb_build_object(
      'found',coalesce(b.products,0)>0,
      'firstDate',b.first_date,'lastDate',b.last_date,'lastObservedAt',b.last_observed_at,
      'products',coalesce(b.products,0),'retailers',coalesce(b.retailers,0),
      'currentDay',v_today,'currentDayPartial',(b.last_date=v_today),
      'daysRequested',v_days,
      'daily',coalesce((select jsonb_agg(to_jsonb(d) order by price_date) from daily d),'[]'::jsonb),
      'retailerCoverage',coalesce((select jsonb_agg(to_jsonb(r) order by products desc) from retailer_stats r),'[]'::jsonb),
      'topCategories',coalesce((select jsonb_agg(to_jsonb(c) order by products desc) from category_stats c),'[]'::jsonb),
      'topBrands',coalesce((select jsonb_agg(to_jsonb(bs) order by products desc) from brand_stats bs),'[]'::jsonb),
      'source','daily_pricing_live','generatedAt',clock_timestamp()
    ) from bounds b
  );
end;
$function$;

create or replace function public.enterprise_ai_catalog_history_search_v1(
  p_organization_id uuid,
  p_query text default null,
  p_brand text default null,
  p_retailer_type text default 'all',
  p_supermarket text default null,
  p_category text default null,
  p_days integer default 30,
  p_limit integer default 24
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '25s'
as $function$
declare
  v_access jsonb;
  v_retailers text[] := '{}';
  v_brands text[] := '{}';
  v_categories text[] := '{}';
  v_industry text;
  v_days integer := greatest(7,least(coalesce(p_days,30),365));
  v_limit integer := greatest(5,least(coalesce(p_limit,24),50));
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
  v_query text := nullif(btrim(coalesce(p_query,'')),'');
  v_brand_key text := nullif(regexp_replace(lower(coalesce(p_brand,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_category_key text := nullif(regexp_replace(lower(coalesce(p_category,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
begin
  if auth.uid() is null and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'not_authenticated' using errcode='28000';
  end if;
  v_access := public.enterprise_access_context(p_organization_id,'pricing');
  select coalesce(array_agg(value),'{}') into v_retailers from jsonb_array_elements_text(coalesce(v_access->'retailers','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_brands from jsonb_array_elements_text(coalesce(v_access->'brands','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_categories from jsonb_array_elements_text(coalesce(v_access->'categories','[]'::jsonb)) t(value);
  v_industry := nullif(v_access->>'industrySlug','');

  return (
    with candidates as materialized (
      select p.id,p.name,p.brand,p.supermarket,p.retailer_type,
             coalesce(nullif(cf.category,''),nullif(p.smart_category,''),nullif(p.category,''),'Sin categoría') category,
             cf.format,cf.volume_ml,coalesce(cf.package_count,1) package_count,
             case when v_query is null then 1::real else greatest(similarity(lower(coalesce(p.name,'')),lower(v_query)),similarity(lower(coalesce(p.brand,'')),lower(v_query))) end score
      from public.products p
      left join private.product_comparison_features cf on cf.product_id=p.id
      where coalesce(p.source_metadata->>'capture_status','accepted')='accepted'
        and p.retailer_type=any(array['supermarket','department_store','pharmacy','home_improvement'])
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or regexp_replace(lower(coalesce(cf.category,p.smart_category,p.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (coalesce(nullif(p_retailer_type,''),'all')='all' or p.retailer_type=p_retailer_type)
        and (nullif(btrim(coalesce(p_supermarket,'')),'') is null or p.supermarket=p_supermarket)
        and (v_brand_key is null or regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_brand_key)
        and (v_category_key is null or regexp_replace(lower(coalesce(cf.category,p.smart_category,p.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_category_key)
        and (
          v_query is null
          or p.name % v_query
          or lower(p.name) like '%'||lower(v_query)||'%'
          or lower(coalesce(p.brand,''))=lower(v_query)
          or (v_brand_key is not null and regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_brand_key)
        )
      order by score desc,p.updated_at desc
      limit greatest(v_limit*5,60)
    ), current_rows as materialized (
      select c.*,s.regular_price,coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)) effective_price,s.in_stock,s.observed_at,
        case when s.regular_price is not null and s.regular_price>coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0))
          then round((s.regular_price-coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)))/s.regular_price*100,1) else 0 end discount_pct
      from candidates c join public.product_latest_price_state s on s.product_id=c.id
      where coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0))>0
      order by c.score desc,s.observed_at desc
      limit v_limit
    ), history_rows as materialized (
      select d.product_id,d.price_date,d.observed_at,d.supermarket,d.effective_price
      from public.daily_pricing_live d join current_rows c on c.id=d.product_id
      where d.price_date>=v_today-(v_days-1) and d.effective_price between 50 and 2000000
    ), daily as (
      select price_date,count(*)::int products,count(distinct supermarket)::int retailers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        round(avg(effective_price),0) average_price,min(effective_price) min_price,max(effective_price) max_price
      from history_rows group by price_date order by price_date
    ), bounds as (
      select min(price_date) first_date,max(price_date) last_date,count(distinct price_date)::int available_days from history_rows
    ), period_pairs as (
      select first.product_id,first.effective_price first_price,last.effective_price last_price
      from bounds b join history_rows first on first.price_date=b.first_date
      join history_rows last on last.product_id=first.product_id and last.price_date=b.last_date
      where last.effective_price/first.effective_price between .10 and 10
    ), period_change as (
      select count(*)::int matched_products,count(*) filter(where first_price<>last_price)::int changed_products,
        round((sum(last_price)/nullif(sum(first_price),0)-1)*100,2) change_pct from period_pairs
    ), retailer_current as (
      select supermarket,count(*)::int products,count(*) filter(where in_stock)::int in_stock,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        min(effective_price) min_price,max(effective_price) max_price,max(observed_at) last_observed_at
      from current_rows group by supermarket order by products desc
    ), product_series as (
      select c.id,c.name,c.brand,c.supermarket,c.category,c.format,c.volume_ml,c.package_count,c.effective_price current_price,c.in_stock,
        coalesce((select jsonb_agg(jsonb_build_object('date',h.price_date,'price',h.effective_price) order by h.price_date)
                  from history_rows h where h.product_id=c.id),'[]'::jsonb) points
      from current_rows c order by c.score desc,c.observed_at desc limit 12
    )
    select jsonb_build_object(
      'found',(select count(*)>0 from current_rows),'query',v_query,'brand',p_brand,
      'current',jsonb_build_object(
        'products',(select count(*) from current_rows),
        'examples',coalesce((select jsonb_agg(jsonb_build_object(
          'product',name,'brand',brand,'retailer',supermarket,'type',retailer_type,'category',category,'format',format,'volumeMl',volume_ml,'packageCount',package_count,
          'regularPrice',regular_price,'price',effective_price,'discountPct',discount_pct,'inStock',in_stock,'observedAt',observed_at,'matchScore',round(score::numeric,3)
        ) order by score desc,observed_at desc) from current_rows),'[]'::jsonb),
        'retailers',coalesce((select jsonb_agg(to_jsonb(r) order by products desc) from retailer_current r),'[]'::jsonb)
      ),
      'history',jsonb_build_object(
        'daysRequested',v_days,'availableDays',coalesce(b.available_days,0),'firstDate',b.first_date,'lastDate',b.last_date,
        'currentDayPartial',(b.last_date=v_today),'points',coalesce((select jsonb_agg(to_jsonb(d) order by price_date) from daily d),'[]'::jsonb),
        'periodVariationPct',pc.change_pct,'periodMatchedProducts',pc.matched_products,'periodChangedProducts',pc.changed_products,
        'productSeries',coalesce((select jsonb_agg(to_jsonb(ps)) from product_series ps),'[]'::jsonb),
        'method','same_product_daily_grounded'
      ),
      'guardrails',jsonb_build_object('factsOnly',true,'currentDayMayBePartial',true,'aggregatePricesMayMixDifferentSizes',true),
      'source','products + product_latest_price_state + daily_pricing_live','generatedAt',clock_timestamp()
    ) from bounds b cross join period_change pc
  );
end;
$function$;

create or replace function public.enterprise_ai_price_movements_v1(
  p_organization_id uuid,
  p_brand text default null,
  p_retailer_type text default 'all',
  p_supermarket text default null,
  p_category text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_direction text default 'both',
  p_limit integer default 20
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_access jsonb;
  v_retailers text[] := '{}';
  v_brands text[] := '{}';
  v_categories text[] := '{}';
  v_industry text;
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
  v_start date := coalesce(p_start_date,v_today-30);
  v_end date := least(coalesce(p_end_date,v_today),v_today);
  v_limit integer := greatest(5,least(coalesce(p_limit,20),50));
  v_brand_key text := nullif(regexp_replace(lower(coalesce(p_brand,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_category_key text := nullif(regexp_replace(lower(coalesce(p_category,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
begin
  if auth.uid() is null and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'not_authenticated' using errcode='28000';
  end if;
  if v_start>v_end then v_start:=v_end; end if;
  v_access := public.enterprise_access_context(p_organization_id,'pricing');
  select coalesce(array_agg(value),'{}') into v_retailers from jsonb_array_elements_text(coalesce(v_access->'retailers','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_brands from jsonb_array_elements_text(coalesce(v_access->'brands','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_categories from jsonb_array_elements_text(coalesce(v_access->'categories','[]'::jsonb)) t(value);
  v_industry := nullif(v_access->>'industrySlug','');

  return (
    with scoped as materialized (
      select d.product_id,d.price_date,d.effective_price,d.supermarket,p.name,p.brand,p.retailer_type,
             coalesce(nullif(p.smart_category,''),nullif(d.category,''),'Sin categoría') category
      from public.daily_pricing_live d join public.products p on p.id=d.product_id
      where d.price_date between v_start and v_end and d.effective_price between 50 and 2000000
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or regexp_replace(lower(coalesce(p.smart_category,d.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (coalesce(nullif(p_retailer_type,''),'all')='all' or p.retailer_type=p_retailer_type)
        and (nullif(btrim(coalesce(p_supermarket,'')),'') is null or d.supermarket=p_supermarket)
        and (v_brand_key is null or regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_brand_key)
        and (v_category_key is null or regexp_replace(lower(coalesce(p.smart_category,d.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_category_key)
    ), ranked as (
      select s.*,row_number() over(partition by product_id order by price_date) rn_first,
                 row_number() over(partition by product_id order by price_date desc) rn_last
      from scoped s
    ), paired as (
      select f.product_id,f.name,f.brand,f.supermarket,f.retailer_type,f.category,
             f.price_date start_date,f.effective_price start_price,
             l.price_date end_date,l.effective_price end_price,
             round((l.effective_price/nullif(f.effective_price,0)-1)*100,2) change_pct
      from ranked f join ranked l on l.product_id=f.product_id and l.rn_last=1
      where f.rn_first=1 and l.price_date>f.price_date and l.effective_price/f.effective_price between .10 and 10
    ), filtered as (
      select * from paired
      where (coalesce(p_direction,'both')='both')
         or (p_direction='up' and change_pct>0)
         or (p_direction='down' and change_pct<0)
         or (p_direction='changed' and change_pct<>0)
    ), top_rows as (
      select * from filtered
      order by case when p_direction='down' then change_pct end asc,
               case when p_direction='up' then change_pct end desc,
               case when coalesce(p_direction,'both') in ('both','changed') then abs(change_pct) end desc
      limit v_limit
    ), bounds as (select min(price_date) first_date,max(price_date) last_date,count(distinct price_date)::int available_days from scoped)
    select jsonb_build_object(
      'found',(select count(*)>0 from top_rows),'requestedStart',v_start,'requestedEnd',v_end,
      'firstDate',b.first_date,'lastDate',b.last_date,'availableDays',coalesce(b.available_days,0),'direction',coalesce(p_direction,'both'),
      'movements',coalesce((select jsonb_agg(jsonb_build_object(
        'product',name,'brand',brand,'retailer',supermarket,'type',retailer_type,'category',category,
        'startDate',start_date,'startPrice',start_price,'endDate',end_date,'endPrice',end_price,'changePct',change_pct
      ) order by case when p_direction='down' then change_pct end asc,
                 case when p_direction='up' then change_pct end desc,
                 case when coalesce(p_direction,'both') in ('both','changed') then abs(change_pct) end desc) from top_rows),'[]'::jsonb),
      'guardrails',jsonb_build_object('sameProductOnly',true,'ratioOutliersExcluded','outside 0.10x-10x','currentDayMayBePartial',(b.last_date=v_today)),
      'source','daily_pricing_live','generatedAt',clock_timestamp()
    ) from bounds b
  );
end;
$function$;

grant execute on function public.enterprise_ai_data_inventory_v1(uuid,integer) to authenticated,service_role;
grant execute on function public.enterprise_ai_catalog_history_search_v1(uuid,text,text,text,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.enterprise_ai_price_movements_v1(uuid,text,text,text,text,date,date,text,integer) to authenticated,service_role;
