-- Product-segment context for Brand Intelligence. A question such as
-- "Coca-Cola en lata" must never reuse whole-brand KPIs.

create or replace function public.enterprise_brand_segment_context_v1(
  p_organization_id uuid,
  p_brand text,
  p_format text default null,
  p_package_mode text default 'all',
  p_volume_ml numeric default null,
  p_retailer_type text default 'all',
  p_supermarket text default null,
  p_category text default null,
  p_stock text default 'all'
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
  v_brand_key text := nullif(regexp_replace(lower(coalesce(p_brand,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_category_key text := nullif(regexp_replace(lower(coalesce(p_category,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_format text := nullif(lower(btrim(coalesce(p_format,''))),'');
  v_package_mode text := case when p_package_mode in ('single','multipack') then p_package_mode else 'all' end;
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
        coalesce(cf.package_count,1) package_count,cf.volume_ml,cf.is_composite,
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
        and (
          v_format is null
          or lower(coalesce(cf.format,''))=v_format
          or (v_format='lata' and lower(p.name) similar to '%(lata|lataa)%')
        )
        and (
          v_package_mode='all'
          or (v_package_mode='single' and coalesce(cf.package_count,1)=1)
          or (v_package_mode='multipack' and coalesce(cf.package_count,1)>1)
        )
        and (p_volume_ml is null or cf.volume_ml between p_volume_ml-5 and p_volume_ml+5)
    ), summary as (
      select count(*)::int skus,count(distinct supermarket)::int retailers,count(distinct category)::int categories,
        count(distinct (coalesce(compare_format,'')||'|'||coalesce(compare_measure,'')||'|'||coalesce(volume_ml::text,'')||'|'||package_count::text||'|'||coalesce(is_composite::text,'')))::int comparison_clusters,
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
        min(effective_price) min_price,max(effective_price) max_price,max(observed_at) last_observed_at
      from current_rows group by supermarket,retailer_type
    ), category_stats as (
      select category,count(*)::int skus,count(distinct supermarket)::int retailers,
        count(in_stock)::int stock_known,count(*) filter(where in_stock)::int in_stock,
        count(*) filter(where regular_price is not null and regular_price>effective_price)::int offers
      from current_rows group by category order by skus desc limit 12
    ), package_stats as (
      select case when package_count>1 then 'multipack' else 'single' end package_mode,
        package_count,count(*)::int skus,count(distinct supermarket)::int retailers,
        count(*) filter(where in_stock)::int in_stock,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_ticket,
        min(effective_price) min_ticket,max(effective_price) max_ticket
      from current_rows group by case when package_count>1 then 'multipack' else 'single' end,package_count
      order by package_count
    ), size_stats as (
      select volume_ml,compare_size size_bucket,package_count,count(*)::int skus,
        count(distinct supermarket)::int retailers,count(*) filter(where in_stock)::int in_stock,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_ticket,
        min(effective_price) min_ticket,max(effective_price) max_ticket
      from current_rows
      group by volume_ml,compare_size,package_count
      order by volume_ml nulls last,package_count
    ), offer_rows as (
      select name,supermarket,regular_price,effective_price,discount_pct,category,volume_ml,package_count
      from current_rows
      where regular_price is not null and regular_price>effective_price
      order by discount_pct desc,effective_price asc limit 10
    ), examples as (
      select name,supermarket,category,compare_format format,volume_ml,package_count,
        effective_price price,in_stock
      from current_rows order by package_count,volume_ml nulls last,effective_price limit 16
    )
    select jsonb_build_object(
      'brand',p_brand,
      'found',s.skus>0,
      'current',jsonb_build_object(
        'basis','latest_price_state_product_segment',
        'summary',jsonb_build_object(
          'skus',s.skus,'retailers',s.retailers,'categories',s.categories,
          'comparisonClusters',s.comparison_clusters,'priceComparable',(s.comparison_clusters=1),
          'stockKnown',s.stock_known,'inStock',s.in_stock,
          'availabilityPct',round(s.in_stock*100.0/nullif(s.stock_known,0),1),
          'offers',s.offers,'offerPct',round(s.offers*100.0/nullif(s.skus,0),1),
          'medianPrice',s.median_price,'averagePrice',s.average_price,'minPrice',s.min_price,'maxPrice',s.max_price,
          'averageDiscount',s.average_discount,'lastObservedAt',s.last_observed_at
        ),
        'retailers',coalesce((select jsonb_agg(jsonb_build_object(
          'retailer',supermarket,'type',retailer_type,'skus',skus,'stockKnown',stock_known,'inStock',in_stock,
          'availabilityPct',round(in_stock*100.0/nullif(stock_known,0),1),'offers',offers,
          'medianPrice',median_price,'minPrice',min_price,'maxPrice',max_price,'lastObservedAt',last_observed_at
        ) order by skus desc) from retailer_stats),'[]'::jsonb),
        'categories',coalesce((select jsonb_agg(jsonb_build_object(
          'category',category,'skus',skus,'retailers',retailers,'stockKnown',stock_known,'inStock',in_stock,
          'availabilityPct',round(in_stock*100.0/nullif(stock_known,0),1),'offers',offers
        ) order by skus desc) from category_stats),'[]'::jsonb),
        'topOffers',coalesce((select jsonb_agg(jsonb_build_object(
          'product',name,'retailer',supermarket,'category',category,'volumeMl',volume_ml,'packageCount',package_count,
          'regularPrice',regular_price,'price',effective_price,'discountPct',discount_pct
        ) order by discount_pct desc) from offer_rows),'[]'::jsonb)
      ),
      'segment',jsonb_build_object(
        'active',true,'format',v_format,'packageMode',v_package_mode,'volumeMl',p_volume_ml,
        'needsPriceClarification',(p_volume_ml is null or v_package_mode='all' or s.comparison_clusters<>1),
        'priceClarification','Para comparar precios elige tamaño y si es unidad individual o multipack.',
        'packageBreakdown',coalesce((select jsonb_agg(to_jsonb(p) order by package_count) from package_stats p),'[]'::jsonb),
        'sizeBreakdown',coalesce((select jsonb_agg(to_jsonb(z) order by volume_ml nulls last,package_count) from size_stats z),'[]'::jsonb),
        'examples',coalesce((select jsonb_agg(to_jsonb(e)) from examples e),'[]'::jsonb)
      ),
      'trend',jsonb_build_object(
        'available',false,'variationPct',null,'points','[]'::jsonb,'coverageLevel','none',
        'reason','El histórico aprendido todavía no tiene grano de formato, tamaño y pack; no se reutiliza la tendencia de toda la marca.'
      ),
      'quality',jsonb_build_object(
        'dataScore',least(100,
          (case when s.skus>=10 then 45 when s.skus>=3 then 30 else 12 end)+
          (case when s.retailers>=3 then 35 when s.retailers=2 then 25 else 12 end)+20),
        'priceScore',case when s.comparison_clusters=1 then 90 else greatest(10,55-least(40,(s.comparison_clusters-1)*8)) end,
        'priceStatistic','median_ticket_sku','overallPriceComparable',(s.comparison_clusters=1),
        'priceWarning',case when s.comparison_clusters>1 then 'El segmento contiene tamaños o packs distintos. No hay un único precio comparable hasta acotarlo.' else null end,
        'trendMethod',null,'trendProducts',0,'lastObservedAt',s.last_observed_at
      ),
      'scope',jsonb_build_object(
        'retailerType',coalesce(nullif(p_retailer_type,''),'all'),'supermarket',p_supermarket,
        'category',p_category,'stock',coalesce(p_stock,'all'),'stockApplied',true,
        'format',v_format,'packageMode',v_package_mode,'volumeMl',p_volume_ml
      ),
      'learning',jsonb_build_object('ready',false,'daily','[]'::jsonb,'reason','segment_grain_not_available'),
      'generatedAt',clock_timestamp()
    )
    from summary s
  );
end;
$$;

revoke all on function public.enterprise_brand_segment_context_v1(uuid,text,text,text,numeric,text,text,text,text) from public, anon;
grant execute on function public.enterprise_brand_segment_context_v1(uuid,text,text,text,numeric,text,text,text,text) to authenticated, service_role;

comment on function public.enterprise_brand_segment_context_v1(uuid,text,text,text,numeric,text,text,text,text) is
  'Organization-scoped live Brand Intelligence context filtered to an explicit product format, package mode and optional volume.';
