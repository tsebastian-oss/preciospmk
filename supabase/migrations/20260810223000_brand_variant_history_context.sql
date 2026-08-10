-- Variant-level current and historical context for MGP Intelligence.
-- Keeps questions such as "Coca-Cola Zero" scoped to the requested family
-- while calculating evolution only from the same SKU across closed local days.

create or replace function public.enterprise_brand_variant_context_v1(
  p_organization_id uuid,
  p_brand text,
  p_name_terms text[],
  p_exclude_terms text[] default '{}',
  p_variant_label text default null,
  p_exclude_composites boolean default true,
  p_format text default null,
  p_package_mode text default 'all',
  p_volume_ml numeric default null,
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
  v_name_terms text[] := '{}';
  v_exclude_terms text[] := '{}';
  v_industry text;
  v_timezone text;
  v_local_today date;
  v_days integer := greatest(7,least(coalesce(p_days,30),90));
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
  select coalesce(array_agg(term),'{}') into v_name_terms
    from (
      select nullif(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g'),'') term
      from unnest(coalesce(p_name_terms,'{}'::text[])) value
    ) q where term is not null;
  select coalesce(array_agg(term),'{}') into v_exclude_terms
    from (
      select nullif(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g'),'') term
      from unnest(coalesce(p_exclude_terms,'{}'::text[])) value
    ) q where term is not null;
  v_industry := nullif(v_access->>'industrySlug','');
  v_timezone := coalesce(nullif(v_access->'settings'->>'timezone',''),'America/Santiago');
  v_local_today := (clock_timestamp() at time zone v_timezone)::date;

  return (
    with scoped_products as materialized (
      select p.id,p.name,p.supermarket,p.retailer_type,p.brand,
        coalesce(nullif(cf.category,''),nullif(p.smart_category,''),nullif(p.category,''),'Sin categoría') category,
        cf.format compare_format,cf.measure_type compare_measure,cf.size_bucket compare_size,
        coalesce(cf.package_count,1) package_count,cf.volume_ml,coalesce(cf.is_composite,false) is_composite
      from public.products p
      left join private.product_comparison_features cf on cf.product_id=p.id
      where p.brand is not null
        and regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_brand_key
        and coalesce(p.source_metadata->>'capture_status','accepted')='accepted'
        and p.retailer_type=any(array['supermarket','department_store','pharmacy','home_improvement'])
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or regexp_replace(lower(coalesce(p.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or regexp_replace(lower(coalesce(cf.category,p.smart_category,p.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (coalesce(nullif(p_retailer_type,''),'all')='all' or p.retailer_type=p_retailer_type)
        and (nullif(btrim(coalesce(p_supermarket,'')),'') is null or p.supermarket=p_supermarket)
        and (v_category_key is null or regexp_replace(lower(coalesce(cf.category,p.smart_category,p.category,'')),'[^[:alnum:]áéíóúüñ]+','','g')=v_category_key)
        and not exists (
          select 1 from unnest(v_name_terms) term
          where regexp_replace(lower(coalesce(p.name,'')),'[^[:alnum:]áéíóúüñ]+','','g') not like '%'||term||'%'
        )
        and not exists (
          select 1 from unnest(v_exclude_terms) term
          where regexp_replace(lower(coalesce(p.name,'')),'[^[:alnum:]áéíóúüñ]+','','g') like '%'||term||'%'
        )
        and (
          not coalesce(p_exclude_composites,true)
          or (not coalesce(cf.is_composite,false) and position('+' in coalesce(p.name,''))=0)
        )
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
    ), current_rows as materialized (
      select p.*,s.regular_price,
        coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)) effective_price,
        s.in_stock,s.observed_at,
        case
          when s.regular_price is not null
            and s.regular_price>coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0))
          then round((s.regular_price-coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)))/s.regular_price*100,1)
          else 0
        end discount_pct
      from scoped_products p
      join public.product_latest_price_state s on s.product_id=p.id
      where coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0))>0
        and (coalesce(p_stock,'all')='all' or (p_stock='in' and s.in_stock) or (p_stock='out' and not s.in_stock))
    ), summary as (
      select count(*)::int skus,count(distinct supermarket)::int retailers,count(distinct category)::int categories,
        count(distinct (category||'|'||coalesce(compare_format,'')||'|'||coalesce(compare_measure,'')||'|'||coalesce(volume_ml::text,'')||'|'||package_count::text))::int comparison_clusters,
        count(in_stock)::int stock_known,count(*) filter(where in_stock)::int in_stock,
        count(*) filter(where regular_price is not null and regular_price>effective_price)::int offers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        round(avg(effective_price),0) average_price,min(effective_price) min_price,max(effective_price) max_price,
        round(avg(discount_pct) filter(where discount_pct>0),1) average_discount,max(observed_at) last_observed_at
      from current_rows
    ), retailer_stats as (
      select supermarket,retailer_type,count(*)::int skus,count(in_stock)::int stock_known,
        count(*) filter(where in_stock)::int in_stock,
        count(*) filter(where regular_price is not null and regular_price>effective_price)::int offers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_price,
        min(effective_price) min_price,max(effective_price) max_price,max(observed_at) last_observed_at
      from current_rows group by supermarket,retailer_type
    ), package_stats as (
      select case when package_count>1 then 'multipack' else 'single' end package_mode,
        package_count,count(*)::int skus,count(distinct supermarket)::int retailers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_ticket,
        min(effective_price) min_ticket,max(effective_price) max_ticket
      from current_rows group by case when package_count>1 then 'multipack' else 'single' end,package_count
      order by package_count
    ), size_stats as (
      select volume_ml,compare_size size_bucket,package_count,count(*)::int skus,
        count(distinct supermarket)::int retailers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_ticket,
        min(effective_price) min_ticket,max(effective_price) max_ticket
      from current_rows group by volume_ml,compare_size,package_count
      order by volume_ml nulls last,package_count
    ), examples as (
      select name,supermarket,category,compare_format format,volume_ml,package_count,effective_price price,in_stock
      from current_rows order by package_count,volume_ml nulls last,effective_price limit 16
    ), history_rows as materialized (
      select d.product_id,d.price_date,d.supermarket,d.effective_price
      from public.daily_pricing_live d
      join scoped_products p on p.id=d.product_id
      where d.price_date>=v_local_today-v_days and d.price_date<v_local_today
        and d.effective_price between 50 and 2000000
    ), daily_summary as (
      select price_date,count(*)::int products,count(distinct supermarket)::int retailers,
        round((percentile_cont(.5) within group(order by effective_price))::numeric,0) median_ticket,
        round(avg(effective_price),0) average_ticket,min(effective_price) min_ticket,max(effective_price) max_ticket
      from history_rows group by price_date
    ), paired as (
      select current.price_date,current.product_id,current.effective_price current_price,previous.effective_price previous_price
      from history_rows current
      join history_rows previous on previous.product_id=current.product_id and previous.price_date=current.price_date-1
      where current.effective_price/previous.effective_price between .10 and 10
    ), daily_change as (
      select price_date,count(*)::int matched_products,
        count(*) filter(where current_price<>previous_price)::int changed_products,
        round((sum(current_price)/nullif(sum(previous_price),0)-1)*100,2) same_sku_change_pct
      from paired group by price_date
    ), points as (
      select d.price_date,d.products,d.retailers,d.median_ticket,d.average_ticket,d.min_ticket,d.max_ticket,
        coalesce(c.matched_products,0)::int matched_products,coalesce(c.changed_products,0)::int changed_products,
        c.same_sku_change_pct
      from daily_summary d left join daily_change c using(price_date)
    ), bounds as (
      select min(price_date) first_date,max(price_date) last_date from history_rows
    ), period_pairs as (
      select first.product_id,first.effective_price first_price,last.effective_price last_price
      from bounds b
      join history_rows first on first.price_date=b.first_date
      join history_rows last on last.product_id=first.product_id and last.price_date=b.last_date
      where last.effective_price/first.effective_price between .10 and 10
    ), period_change as (
      select count(*)::int matched_products,
        count(*) filter(where first_price<>last_price)::int changed_products,
        round((sum(last_price)/nullif(sum(first_price),0)-1)*100,2) change_pct
      from period_pairs
    ), latest_point as (
      select * from points order by price_date desc limit 1
    ), history_stats as (
      select count(*)::int days,count(*) filter(where matched_products>0)::int comparable_days from points
    )
    select jsonb_build_object(
      'brand',p_brand,
      'found',(s.skus>0 or hs.days>0),
      'current',jsonb_build_object(
        'basis','latest_price_state_brand_variant',
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
        ) order by skus desc) from retailer_stats),'[]'::jsonb)
      ),
      'segment',jsonb_build_object(
        'active',true,'variant',coalesce(nullif(p_variant_label,''),array_to_string(p_name_terms,' ')),
        'nameTerms',v_name_terms,'excludedTerms',v_exclude_terms,'format',v_format,
        'packageMode',v_package_mode,'volumeMl',p_volume_ml,
        'needsPriceClarification',(p_volume_ml is null or v_package_mode='all' or s.comparison_clusters<>1),
        'priceClarification','Para comparar tickets elige tamaño y si es unidad individual o multipack.',
        'packageBreakdown',coalesce((select jsonb_agg(to_jsonb(p) order by package_count) from package_stats p),'[]'::jsonb),
        'sizeBreakdown',coalesce((select jsonb_agg(to_jsonb(z) order by volume_ml nulls last,package_count) from size_stats z),'[]'::jsonb),
        'examples',coalesce((select jsonb_agg(to_jsonb(e)) from examples e),'[]'::jsonb)
      ),
      'trend',jsonb_build_object(
        'available',(hs.comparable_days>0),'days',v_days,'method','same_sku_closed_day_variant',
        'points',coalesce((select jsonb_agg(jsonb_build_object(
          'date',price_date,'products',products,'retailers',retailers,'medianTicket',median_ticket,
          'averageTicket',average_ticket,'minTicket',min_ticket,'maxTicket',max_ticket,
          'matchedProducts',matched_products,'changedProducts',changed_products,'sameSkuChangePct',same_sku_change_pct
        ) order by price_date) from points),'[]'::jsonb),
        'date',lp.price_date,'variationPct',lp.same_sku_change_pct,
        'matchedProducts',lp.matched_products,'changedProducts',lp.changed_products,
        'periodStart',(select first_date from bounds),'periodEnd',(select last_date from bounds),
        'periodVariationPct',pc.change_pct,'periodMatchedProducts',pc.matched_products,
        'periodChangedProducts',pc.changed_products,
        'coverageLevel',case
          when coalesce(lp.products,0)=0 or coalesce(lp.matched_products,0)=0 then 'none'
          when lp.matched_products::numeric/lp.products>=.8 then 'high'
          when lp.matched_products::numeric/lp.products>=.5 then 'medium'
          else 'low'
        end,
        'currentPartialDayExcluded',v_local_today,
        'reason',case when hs.comparable_days=0 then 'No hay dos días cerrados consecutivos con el mismo SKU para esta variante y alcance.' else null end
      ),
      'quality',jsonb_build_object(
        'dataScore',least(100,
          (case when s.skus>=10 then 35 when s.skus>=3 then 25 else 10 end)+
          (case when s.retailers>=3 then 25 when s.retailers=2 then 18 else 8 end)+
          (case when hs.comparable_days>=3 then 25 when hs.comparable_days>=1 then 15 else 0 end)+15),
        'priceScore',case when s.comparison_clusters=1 then 90 else greatest(10,55-least(40,(s.comparison_clusters-1)*6)) end,
        'priceStatistic','same_sku_change_for_trend_median_ticket_descriptive',
        'overallPriceComparable',(s.comparison_clusters=1),
        'priceWarning',case when s.comparison_clusters>1 then 'La variante contiene tamaños o packs distintos. Los tickets agregados son descriptivos; la evolución usa sólo los mismos SKU.' else null end,
        'trendProducts',lp.matched_products,'lastObservedAt',s.last_observed_at
      ),
      'scope',jsonb_build_object(
        'variant',coalesce(nullif(p_variant_label,''),array_to_string(p_name_terms,' ')),
        'retailerType',coalesce(nullif(p_retailer_type,''),'all'),'supermarket',p_supermarket,
        'category',p_category,'stock',coalesce(p_stock,'all'),'stockAppliedToTrend',false,
        'format',v_format,'packageMode',v_package_mode,'volumeMl',p_volume_ml,
        'days',v_days,'timezone',v_timezone,'latestClosedDate',lp.price_date
      ),
      'learning',jsonb_build_object(
        'ready',(hs.days>=2),'method','daily_grounded_variant_closed_days_only',
        'daily',coalesce((select jsonb_agg(to_jsonb(p) order by price_date) from points p),'[]'::jsonb),
        'guardrails',jsonb_build_object(
          'factsOnly',true,'source','daily_pricing_live','closedDaysOnly',true,
          'trend','Same SKU against the previous closed calendar day; ratios outside 0.10x-10x excluded.',
          'broadAverageWarning','Ticket averages and medians mix sizes and packs and are descriptive only.'
        )
      ),
      'generatedAt',clock_timestamp()
    )
    from summary s
    cross join history_stats hs
    left join latest_point lp on true
    cross join period_change pc
  );
end;
$$;

revoke all on function public.enterprise_brand_variant_context_v1(uuid,text,text[],text[],text,boolean,text,text,numeric,text,text,text,text,integer) from public, anon;
grant execute on function public.enterprise_brand_variant_context_v1(uuid,text,text[],text[],text,boolean,text,text,numeric,text,text,text,text,integer) to authenticated, service_role;

comment on function public.enterprise_brand_variant_context_v1(uuid,text,text[],text[],text,boolean,text,text,numeric,text,text,text,text,integer) is
  'Organization-scoped current and closed-day same-SKU history for a named product variant within a brand.';
