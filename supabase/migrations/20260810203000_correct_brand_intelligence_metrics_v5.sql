-- Correct Brand Intelligence semantics:
--   * current KPIs come from the live latest-price snapshot;
--   * trends only use completed local calendar days;
--   * current-day partial scraping never becomes a brand-wide trend claim.

create or replace function public.enterprise_brand_intelligence_context_v5(
  p_organization_id uuid,
  p_brand text,
  p_retailer_type text default 'all',
  p_supermarket text default null,
  p_category text default null,
  p_stock text default 'all',
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '12s'
as $$
declare
  v_access jsonb;
  v_retailers text[] := '{}';
  v_brands text[] := '{}';
  v_categories text[] := '{}';
  v_industry text;
  v_timezone text;
  v_local_today date;
  v_days integer := greatest(7,least(coalesce(p_days,30),90));
  v_brand_key text := nullif(regexp_replace(lower(coalesce(p_brand,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_category_key text := nullif(regexp_replace(lower(coalesce(p_category,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_learning jsonb;
  v_closed_daily jsonb := '[]'::jsonb;
  v_closed_latest jsonb := '{}'::jsonb;
  v_safe_learning jsonb;
begin
  if auth.uid() is null and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'not_authenticated' using errcode='28000';
  end if;

  v_access := public.enterprise_access_context(p_organization_id,'pricing');
  select coalesce(array_agg(value),'{}') into v_retailers
    from jsonb_array_elements_text(coalesce(v_access->'retailers','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_brands
    from jsonb_array_elements_text(coalesce(v_access->'brands','[]'::jsonb)) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_categories
    from jsonb_array_elements_text(coalesce(v_access->'categories','[]'::jsonb)) t(value);
  v_industry := nullif(v_access->>'industrySlug','');
  v_timezone := coalesce(nullif(v_access->'settings'->>'timezone',''),'America/Santiago');
  v_local_today := (clock_timestamp() at time zone v_timezone)::date;

  v_learning := public.enterprise_ai_learning_context(
    p_organization_id,p_brand,p_category,p_retailer_type,p_supermarket,v_days
  );

  select coalesce(jsonb_agg(d.value order by d.value->>'date'),'[]'::jsonb)
    into v_closed_daily
  from jsonb_array_elements(coalesce(v_learning->'daily','[]'::jsonb)) d(value)
  where (d.value->>'date')::date < v_local_today;

  v_closed_latest := coalesce(v_closed_daily->-1,'{}'::jsonb);
  v_safe_learning := jsonb_build_object(
    'ready',jsonb_array_length(v_closed_daily)>0,
    'method','daily_grounded_feature_store_closed_days_only',
    'scope',coalesce(v_learning->'scope','{}'::jsonb) || jsonb_build_object(
      'latestDate',v_closed_latest->>'date',
      'currentPartialDayExcluded',v_local_today
    ),
    'training',coalesce(v_learning->'training','{}'::jsonb),
    'daily',v_closed_daily,
    'retailers','[]'::jsonb,
    'categories','[]'::jsonb,
    'movements','[]'::jsonb,
    'guardrails',coalesce(v_learning->'guardrails','{}'::jsonb) || jsonb_build_object(
      'closedDaysOnly',true,
      'currentDayPolicy','The current local calendar day is excluded because scraping coverage is incomplete.'
    ),
    'generatedAt',clock_timestamp()
  );

  return (
    with brand_products as materialized (
      select p.*
      from public.products p
      where p.brand is not null
        and regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_brand_key
    ), current_rows as materialized (
      select p.id,p.name,p.supermarket,p.retailer_type,
        coalesce(nullif(cf.category,''),nullif(p.smart_category,''),nullif(p.category,''),'Sin categoría') category,
        cf.format compare_format,cf.measure_type compare_measure,cf.size_bucket compare_size,
        s.regular_price,
        coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)) effective_price,
        s.in_stock,s.observed_at,
        case
          when s.regular_price is not null
            and s.regular_price>coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0))
          then round((s.regular_price-coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)))/s.regular_price*100,1)
          else 0
        end discount_pct
      from brand_products p
      left join private.product_comparison_features cf on cf.product_id=p.id
      join public.product_latest_price_state s on s.product_id=p.id
      where coalesce(p.source_metadata->>'capture_status','accepted')='accepted'
        and coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0))>0
        and p.retailer_type=any(array['supermarket','department_store','pharmacy','home_improvement'])
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or regexp_replace(lower(coalesce(cf.category,p.smart_category,p.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (coalesce(nullif(p_retailer_type,''),'all')='all' or p.retailer_type=p_retailer_type)
        and (nullif(btrim(coalesce(p_supermarket,'')),'') is null or p.supermarket=p_supermarket)
        and (v_category_key is null or regexp_replace(lower(coalesce(cf.category,p.smart_category,p.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_category_key)
        and (coalesce(p_stock,'all')='all' or (p_stock='in' and s.in_stock) or (p_stock='out' and not s.in_stock))
    ), summary as (
      select count(*)::int skus,count(distinct supermarket)::int retailers,count(distinct category)::int categories,
        count(distinct (category||'|'||coalesce(compare_format,'')||'|'||coalesce(compare_measure,'')||'|'||coalesce(compare_size::text,'')))::int comparison_clusters,
        count(in_stock)::int stock_known,count(*) filter(where in_stock)::int in_stock,
        count(*) filter(where regular_price is not null and regular_price>effective_price)::int offers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        round(avg(effective_price),0) average_price,min(effective_price) min_price,max(effective_price) max_price,
        round(avg(discount_pct) filter(where discount_pct>0),1) average_discount,
        max(observed_at) last_observed_at
      from current_rows
    ), retailer_stats as (
      select supermarket,retailer_type,count(*)::int skus,count(in_stock)::int stock_known,
        count(*) filter(where in_stock)::int in_stock,
        count(*) filter(where regular_price is not null and regular_price>effective_price)::int offers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        round(avg(effective_price),0) average_price,min(effective_price) min_price,max(effective_price) max_price,
        max(observed_at) last_observed_at
      from current_rows group by supermarket,retailer_type
    ), category_stats as (
      select category,count(*)::int skus,count(distinct supermarket)::int retailers,
        count(in_stock)::int stock_known,count(*) filter(where in_stock)::int in_stock,
        count(*) filter(where regular_price is not null and regular_price>effective_price)::int offers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        round(avg(effective_price),0) average_price,min(effective_price) min_price,max(effective_price) max_price
      from current_rows group by category order by skus desc limit 12
    ), offer_rows as (
      select name,supermarket,regular_price,effective_price,discount_pct,category
      from current_rows
      where regular_price is not null and regular_price>effective_price
      order by discount_pct desc,effective_price asc limit 10
    )
    select jsonb_build_object(
      'brand',p_brand,
      'found',s.skus>0,
      'current',jsonb_build_object(
        'basis','latest_price_state',
        'summary',jsonb_build_object(
          'skus',s.skus,'retailers',s.retailers,'categories',s.categories,'comparisonClusters',s.comparison_clusters,
          'stockKnown',s.stock_known,'inStock',s.in_stock,
          'availabilityPct',round(s.in_stock*100.0/nullif(s.stock_known,0),1),
          'offers',s.offers,'offerPct',round(s.offers*100.0/nullif(s.skus,0),1),
          'medianPrice',s.median_price,'averagePrice',s.average_price,'minPrice',s.min_price,'maxPrice',s.max_price,
          'averageDiscount',s.average_discount,'lastObservedAt',s.last_observed_at
        ),
        'retailers',coalesce((select jsonb_agg(jsonb_build_object(
          'retailer',supermarket,'type',retailer_type,'skus',skus,'stockKnown',stock_known,'inStock',in_stock,
          'availabilityPct',round(in_stock*100.0/nullif(stock_known,0),1),'offers',offers,
          'medianPrice',median_price,'averagePrice',average_price,'minPrice',min_price,'maxPrice',max_price,
          'lastObservedAt',last_observed_at
        ) order by skus desc) from retailer_stats),'[]'::jsonb),
        'categories',coalesce((select jsonb_agg(jsonb_build_object(
          'category',category,'skus',skus,'retailers',retailers,'stockKnown',stock_known,'inStock',in_stock,
          'availabilityPct',round(in_stock*100.0/nullif(stock_known,0),1),'offers',offers,
          'medianPrice',median_price,'averagePrice',average_price,'minPrice',min_price,'maxPrice',max_price
        ) order by skus desc) from category_stats),'[]'::jsonb),
        'topOffers',coalesce((select jsonb_agg(jsonb_build_object(
          'product',name,'retailer',supermarket,'category',category,'regularPrice',regular_price,
          'price',effective_price,'discountPct',discount_pct
        ) order by discount_pct desc) from offer_rows),'[]'::jsonb)
      ),
      'trend',jsonb_build_object(
        'days',v_days,'method','weighted_same_sku_day_over_day_closed_day',
        'points',v_closed_daily,'date',v_closed_latest->>'date',
        'products',coalesce((v_closed_latest->>'changedProducts')::integer,0),
        'observedProducts',coalesce((v_closed_latest->>'products')::integer,0),
        'retailers',coalesce((v_closed_latest->>'retailers')::integer,0),
        'coverageRetailerPct',round(coalesce((v_closed_latest->>'retailers')::numeric,0)*100/nullif(s.retailers,0),1),
        'coverageLevel',case
          when s.retailers=0 then 'none'
          when coalesce((v_closed_latest->>'retailers')::numeric,0)/s.retailers>=0.8 then 'high'
          when coalesce((v_closed_latest->>'retailers')::numeric,0)/s.retailers>=0.5 then 'medium'
          else 'low'
        end,
        'variationPct',(v_closed_latest->>'sameSkuChangePct')::numeric,
        'currentPartialDayExcluded',v_local_today
      ),
      'quality',jsonb_build_object(
        'dataScore',least(100,
          (case when s.skus>=10 then 40 when s.skus>=3 then 28 else 12 end)+
          (case when s.retailers>=3 then 30 when s.retailers=2 then 22 else 10 end)+
          (case when coalesce((v_closed_latest->>'changedProducts')::integer,0)>=5 then 20 when coalesce((v_closed_latest->>'changedProducts')::integer,0)>=2 then 12 else 5 end)+10),
        'priceScore',case
          when s.comparison_clusters=1 then least(100,65+(case when s.skus>=5 then 15 else s.skus*3 end)+(case when s.retailers>=2 then 15 else 5 end))
          else greatest(15,55-least(35,greatest(0,s.comparison_clusters-1)*5))
        end,
        'priceStatistic','median_ticket_sku','overallPriceComparable',(s.comparison_clusters=1),
        'priceWarning',case when s.comparison_clusters>1 then 'La mediana y el promedio global mezclan formatos, tamaños o tipos de producto; son descriptivos y no miden posicionamiento de precio.' else null end,
        'trendMethod','Cambio porcentual ponderado de los mismos SKU contra el día calendario anterior, usando solo días locales cerrados.',
        'trendProducts',coalesce((v_closed_latest->>'changedProducts')::integer,0),
        'lastObservedAt',s.last_observed_at
      ),
      'scope',jsonb_build_object(
        'retailerType',coalesce(nullif(p_retailer_type,''),'all'),'supermarket',p_supermarket,
        'category',p_category,'stock',coalesce(p_stock,'all'),'stockApplied',true,'days',v_days,
        'timezone',v_timezone,'latestClosedDate',v_closed_latest->>'date'
      ),
      'learning',v_safe_learning,
      'generatedAt',clock_timestamp()
    )
    from summary s
  );
end;
$$;

revoke all on function public.enterprise_brand_intelligence_context_v5(uuid,text,text,text,text,text,integer) from public, anon;
grant execute on function public.enterprise_brand_intelligence_context_v5(uuid,text,text,text,text,text,integer) to authenticated, service_role;

comment on function public.enterprise_brand_intelligence_context_v5(uuid,text,text,text,text,text,integer) is
  'Brand Intelligence live snapshot plus completed-day trend context, scoped to the authenticated organization.';
