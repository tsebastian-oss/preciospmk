-- Serve Brand Intelligence from the continuously refreshed feature store.
-- The previous v3 function rebuilt multi-day SKU history on every question and
-- could hit its 30 second statement timeout for common brands.

create or replace function public.enterprise_brand_intelligence_context_v4(
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
set statement_timeout to '10s'
as $$
declare
  v_learning jsonb;
  v_latest jsonb;
  v_retailers jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_points jsonb := '[]'::jsonb;
  v_products integer := 0;
  v_retailer_count integer := 0;
  v_category_count integer := 0;
  v_day_count integer := 0;
  v_changed_products integer := 0;
  v_ready boolean := false;
begin
  -- Enforce the Brand Intelligence/pricing module before using the shared
  -- organization-scoped learning service.
  perform public.enterprise_access_context(p_organization_id,'pricing');

  v_learning := public.enterprise_ai_learning_context(
    p_organization_id,
    p_brand,
    p_category,
    p_retailer_type,
    p_supermarket,
    p_days
  );

  v_ready := coalesce((v_learning->>'ready')::boolean,false);
  v_latest := coalesce(v_learning->'daily'->-1,'{}'::jsonb);
  v_products := coalesce((v_latest->>'products')::integer,0);
  v_retailer_count := coalesce((v_latest->>'retailers')::integer,0);
  v_category_count := jsonb_array_length(coalesce(v_learning->'categories','[]'::jsonb));
  v_day_count := jsonb_array_length(coalesce(v_learning->'daily','[]'::jsonb));
  v_changed_products := coalesce((v_latest->>'changedProducts')::integer,0);

  select coalesce(jsonb_agg(jsonb_build_object(
    'retailer',r.value->>'supermarket',
    'type',r.value->>'retailer_type',
    'skus',coalesce((r.value->>'products')::integer,0),
    'inStock',null,
    'offers',null,
    'medianPrice',null,
    'averagePrice',(r.value->>'average_price')::numeric,
    'minPrice',null,
    'maxPrice',null,
    'sameSkuChangePct',(r.value->>'same_sku_change_pct')::numeric,
    'changedProducts',coalesce((r.value->>'changed_products')::integer,0),
    'lastObservedAt',r.value->>'source_observed_at'
  ) order by coalesce((r.value->>'products')::integer,0) desc),'[]'::jsonb)
  into v_retailers
  from jsonb_array_elements(coalesce(v_learning->'retailers','[]'::jsonb)) r(value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'category',c.value->>'category',
    'skus',coalesce((c.value->>'products')::integer,0),
    'retailers',coalesce((c.value->>'retailers')::integer,0),
    'medianPrice',null,
    'averagePrice',(c.value->>'average_price')::numeric,
    'minPrice',null,
    'maxPrice',null,
    'inStock',null,
    'offers',null,
    'sameSkuChangePct',(c.value->>'same_sku_change_pct')::numeric,
    'changedProducts',coalesce((c.value->>'changed_products')::integer,0)
  ) order by coalesce((c.value->>'products')::integer,0) desc),'[]'::jsonb)
  into v_categories
  from jsonb_array_elements(coalesce(v_learning->'categories','[]'::jsonb)) c(value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'date',d.value->>'date',
    'products',coalesce((d.value->>'products')::integer,0),
    'retailers',coalesce((d.value->>'retailers')::integer,0),
    'averagePrice',(d.value->>'averagePrice')::numeric,
    'sameSkuChangePct',(d.value->>'sameSkuChangePct')::numeric,
    'changedProducts',coalesce((d.value->>'changedProducts')::integer,0),
    'sourceObservedAt',d.value->>'sourceObservedAt'
  ) order by d.value->>'date'),'[]'::jsonb)
  into v_points
  from jsonb_array_elements(coalesce(v_learning->'daily','[]'::jsonb)) d(value);

  return jsonb_build_object(
    'brand',p_brand,
    'found',v_ready and v_products>0,
    'current',jsonb_build_object(
      'summary',jsonb_build_object(
        'skus',v_products,
        'retailers',v_retailer_count,
        'categories',v_category_count,
        'comparisonClusters',v_category_count,
        'inStock',null,
        'offers',null,
        'medianPrice',null,
        'averagePrice',(v_latest->>'averagePrice')::numeric,
        'minPrice',null,
        'maxPrice',null,
        'averageDiscount',null,
        'changedProducts',v_changed_products,
        'lastObservedAt',v_latest->>'sourceObservedAt'
      ),
      'retailers',v_retailers,
      'categories',v_categories,
      'topOffers','[]'::jsonb
    ),
    'trend',jsonb_build_object(
      'days',greatest(7,least(coalesce(p_days,30),90)),
      'method','same_sku_previous_calendar_day_weighted_mean',
      'points',v_points,
      'products',v_changed_products,
      'variationPct',(v_latest->>'sameSkuChangePct')::numeric
    ),
    'quality',jsonb_build_object(
      'dataScore',least(100,
        (case when v_products>=10 then 40 when v_products>=3 then 28 else 12 end)+
        (case when v_retailer_count>=3 then 30 when v_retailer_count=2 then 22 else 10 end)+
        (case when v_day_count>=7 then 20 when v_day_count>=2 then 12 else 5 end)+10),
      'priceScore',15,
      'priceStatistic','weighted_average_ticket',
      'overallPriceComparable',false,
      'priceWarning','El promedio amplio mezcla formatos y tamaños; es descriptivo y no sirve por sí solo para afirmar posicionamiento de precio.',
      'trendMethod','Cambio porcentual ponderado de los mismos SKU contra el día calendario anterior; ratios fuera de 0.10x-10x se excluyen.',
      'trendProducts',v_changed_products,
      'lastObservedAt',v_latest->>'sourceObservedAt'
    ),
    'scope',coalesce(v_learning->'scope','{}'::jsonb) || jsonb_build_object(
      'stock',coalesce(nullif(p_stock,''),'all'),
      'stockApplied',false
    ),
    'learning',v_learning,
    'generatedAt',clock_timestamp()
  );
end;
$$;

revoke all on function public.enterprise_brand_intelligence_context_v4(uuid,text,text,text,text,text,integer) from public, anon;
grant execute on function public.enterprise_brand_intelligence_context_v4(uuid,text,text,text,text,text,integer) to authenticated, service_role;

comment on function public.enterprise_brand_intelligence_context_v4(uuid,text,text,text,text,text,integer) is
  'Fast organization-scoped Brand Intelligence context backed by the continuously refreshed daily feature store.';
