create or replace function public.enterprise_ai_learning_context(
  p_organization_id uuid,
  p_brand text default null,
  p_category text default null,
  p_retailer_type text default 'all',
  p_supermarket text default null,
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '20s'
as $$
declare
  v_access jsonb;
  v_retailers text[] := '{}';
  v_brands text[] := '{}';
  v_categories text[] := '{}';
  v_industry text;
  v_days integer := greatest(7,least(coalesce(p_days,30),90));
  v_brand_key text := nullif(regexp_replace(lower(coalesce(p_brand,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_category_key text := nullif(regexp_replace(lower(coalesce(p_category,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
begin
  -- Brand Intelligence, Price Map and Competitive AI enforce their own modules.
  -- The shared learning service enforces membership plus organization data scopes.
  v_access:=public.enterprise_access_context(p_organization_id,null);
  select coalesce(array_agg(value),'{}') into v_retailers
    from jsonb_array_elements_text(coalesce(v_access->'retailers','[]')) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_brands
    from jsonb_array_elements_text(coalesce(v_access->'brands','[]')) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_categories
    from jsonb_array_elements_text(coalesce(v_access->'categories','[]')) t(value);
  v_industry:=nullif(v_access->>'industrySlug','');

  return (
    with state as (
      select * from private.ai_learning_state where singleton
    ), scoped as materialized (
      select f.*
      from private.ai_daily_learning_features f
      where f.fact_date>=current_date-(v_days-1)
        and (coalesce(cardinality(v_retailers),0)=0 or f.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or f.brand_key=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or f.category_key=any(v_categories))
        and public.product_industry_allowed(v_industry,nullif(f.industry_slug,'unclassified'),f.retailer_type)
        and (coalesce(nullif(p_retailer_type,''),'all')='all' or f.retailer_type=p_retailer_type)
        and (nullif(btrim(coalesce(p_supermarket,'')),'') is null or f.supermarket=p_supermarket)
        and (v_brand_key is null or f.brand_key=v_brand_key)
        and (v_category_key is null or f.category_key=v_category_key)
    ), latest as (
      select max(fact_date) fact_date from scoped
    ), daily as (
      select fact_date,
        sum(product_count)::bigint products,
        count(distinct supermarket)::integer retailers,
        round(sum(price_sum)/nullif(sum(product_count),0),2) average_price,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct,
        max(source_max_observed_at) source_observed_at
      from scoped group by fact_date order by fact_date
    ), retailer_latest as (
      select supermarket,retailer_type,sum(product_count)::bigint products,
        round(sum(price_sum)/nullif(sum(product_count),0),2) average_price,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct,
        max(source_max_observed_at) source_observed_at
      from scoped where fact_date=(select fact_date from latest)
      group by supermarket,retailer_type order by products desc
    ), category_latest as (
      select category_key,min(category) category,sum(product_count)::bigint products,
        count(distinct supermarket)::integer retailers,
        round(sum(price_sum)/nullif(sum(product_count),0),2) average_price,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct
      from scoped where fact_date=(select fact_date from latest)
      group by category_key order by products desc limit 12
    ), movements as (
      select brand_key,min(brand) brand,category_key,min(category) category,
        sum(product_count)::bigint products,count(distinct supermarket)::integer retailers,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct
      from scoped where fact_date=(select fact_date from latest)
      group by brand_key,category_key
      having sum(changed_product_count)>=2
      order by abs(sum(change_sum_pct)/nullif(sum(changed_product_count),0)) desc,
               sum(changed_product_count) desc
      limit 12
    )
    select jsonb_build_object(
      'ready',exists(select 1 from scoped),
      'method','daily_grounded_feature_store',
      'scope',jsonb_build_object(
        'brand',p_brand,'category',p_category,'retailerType',coalesce(nullif(p_retailer_type,''),'all'),
        'supermarket',p_supermarket,'days',v_days,'latestDate',(select fact_date from latest)
      ),
      'training',jsonb_build_object(
        'lastRunId',s.last_run_id,'trainedFrom',s.last_trained_from,'trainedTo',s.last_trained_to,
        'sourceMaxObservationId',s.source_max_observation_id,'sourceObservedAt',s.source_max_observed_at,
        'featureRows',s.feature_rows,'updatedAt',s.updated_at
      ),
      'daily',coalesce((select jsonb_agg(jsonb_build_object(
        'date',fact_date,'products',products,'retailers',retailers,'averagePrice',average_price,
        'sameSkuChangePct',same_sku_change_pct,'changedProducts',changed_products,
        'sourceObservedAt',source_observed_at
      ) order by fact_date) from daily),'[]'::jsonb),
      'retailers',coalesce((select jsonb_agg(to_jsonb(r) order by products desc) from retailer_latest r),'[]'::jsonb),
      'categories',coalesce((select jsonb_agg(to_jsonb(c) order by products desc) from category_latest c),'[]'::jsonb),
      'movements',coalesce((select jsonb_agg(to_jsonb(m) order by abs(same_sku_change_pct) desc nulls last) from movements m),'[]'::jsonb),
      'guardrails',jsonb_build_object(
        'factsOnly',true,'source','daily_pricing_live',
        'deduplication','one_valid_observation_per_product_per_day',
        'trend','same SKU vs previous calendar day; ratios outside 0.10x-10x excluded',
        'broadAverageWarning','Average prices across a changing assortment are descriptive; use sameSkuChangePct for trend claims.'
      ),
      'generatedAt',clock_timestamp()
    ) from state s
  );
end;
$$;

revoke all on function public.enterprise_ai_learning_context(uuid,text,text,text,text,integer) from public, anon;
grant execute on function public.enterprise_ai_learning_context(uuid,text,text,text,text,integer) to authenticated, service_role;
