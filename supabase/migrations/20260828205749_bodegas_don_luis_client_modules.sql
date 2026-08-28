CREATE OR REPLACE FUNCTION public.brands_peru_liquor_matrix(p_slug text DEFAULT 'bodegas-don-luis'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
with authorized as (
  select (p_slug = 'bodegas-don-luis' and private.enterprise_brand_slug_allowed(p_slug)) ok
),
b as (
  select id from public.brands_vertical_brands
  where slug = p_slug and status = 'active' and (select ok from authorized)
  limit 1
),
latest as (
  select distinct on (l.source_id, l.category, coalesce(l.source_product_key,l.product_url))
    s.retailer_name,
    s.domain,
    l.source_id,
    l.category,
    coalesce(l.source_product_key,l.product_url) source_product_key,
    l.title,
    coalesce(l.attributes->>'actualBrand',l.brand_name,'Sin marca') brand_name,
    l.current_price,
    l.regular_price,
    l.in_stock,
    nullif(l.attributes->>'ml','')::numeric ml,
    coalesce(
      nullif(l.attributes->>'discountPct','')::numeric,
      case when l.regular_price > l.current_price and l.current_price > 0
        then round((1 - l.current_price/l.regular_price) * 100, 1)
      end
    ) discount_pct,
    (lower(coalesce(l.attributes->>'promotion','false'))='true'
      or (l.regular_price > l.current_price and l.current_price > 0)) is_promo,
    l.observed_at
  from public.brands_vertical_listings l
  join b on b.id = l.brand_id
  join public.brands_vertical_sources s on s.id = l.source_id and s.active
  where l.category in ('Pisco','Ron','Vino')
    and l.current_price between 1 and 5000
  order by l.source_id, l.category, coalesce(l.source_product_key,l.product_url), l.observed_at desc, l.id desc
),
agg as (
  select retailer_name, domain, category,
    count(*)::int sku_count,
    round(avg(current_price),2) avg_price,
    round(min(current_price),2) min_price,
    round(max(current_price),2) max_price,
    count(*) filter (where is_promo)::int promo_count,
    round(avg(discount_pct) filter (where discount_pct > 0),1) avg_discount_pct,
    max(observed_at) observed_at
  from latest
  group by retailer_name, domain, category
),
retailers as (
  select retailer_name,
    min(domain) domain,
    sum(sku_count)::int sku_count,
    max(observed_at) observed_at
  from agg
  group by retailer_name
)
select case when not exists(select 1 from b) then null else jsonb_build_object(
  'currency','PEN',
  'categories',jsonb_build_array('Pisco','Ron','Vino'),
  'retailers',coalesce((
    select jsonb_agg(jsonb_build_object(
      'name',retailer_name,'domain',domain,'skuCount',sku_count,'observedAt',observed_at
    ) order by retailer_name)
    from retailers
  ),'[]'::jsonb),
  'cells',coalesce((
    select jsonb_agg(jsonb_build_object(
      'retailer',retailer_name,
      'domain',domain,
      'category',category,
      'avgPrice',avg_price,
      'minPrice',min_price,
      'maxPrice',max_price,
      'skuCount',sku_count,
      'promoCount',promo_count,
      'avgDiscountPct',avg_discount_pct,
      'observedAt',observed_at
    ) order by retailer_name, case category when 'Pisco' then 1 when 'Ron' then 2 else 3 end)
    from agg
  ),'[]'::jsonb),
  'lastObservedAt',(select max(observed_at) from latest),
  'totalSkuObservations',(select count(*) from latest)
) end;
$function$


revoke all on function public.brands_peru_liquor_matrix(text) from public, anon;
grant execute on function public.brands_peru_liquor_matrix(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brands_peru_liquor_search(p_slug text DEFAULT 'bodegas-don-luis'::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_retailer text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
with authorized as (
  select (p_slug = 'bodegas-don-luis' and private.enterprise_brand_slug_allowed(p_slug)) ok
),
b as (
  select id from public.brands_vertical_brands
  where slug = p_slug and status = 'active' and (select ok from authorized)
  limit 1
),
latest as (
  select distinct on (l.source_id,l.category,coalesce(l.source_product_key,l.product_url))
    s.retailer_name,
    s.domain,
    l.category,
    l.title,
    coalesce(l.attributes->>'actualBrand',l.brand_name,'Sin marca') brand_name,
    l.current_price,
    l.regular_price,
    l.in_stock,
    nullif(l.attributes->>'ml','')::numeric ml,
    nullif(l.attributes->>'unitPrice','')::numeric unit_price,
    coalesce(
      nullif(l.attributes->>'discountPct','')::numeric,
      case when l.regular_price > l.current_price and l.current_price > 0
        then round((1-l.current_price/l.regular_price)*100,1)
      end
    ) discount_pct,
    l.product_url,
    l.observed_at
  from public.brands_vertical_listings l
  join b on b.id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active
  where l.category in ('Pisco','Ron','Vino')
    and l.current_price between 1 and 5000
  order by l.source_id,l.category,coalesce(l.source_product_key,l.product_url),l.observed_at desc,l.id desc
),
filtered as (
  select *
  from latest
  where (p_category is null or btrim(p_category)='' or lower(category)=lower(btrim(p_category)))
    and (p_retailer is null or btrim(p_retailer)='' or retailer_name ilike '%'||btrim(p_retailer)||'%')
    and (
      p_query is null or btrim(p_query)='' or
      to_tsvector('simple',coalesce(title,'')||' '||coalesce(brand_name,'')||' '||coalesce(category,'')||' '||coalesce(retailer_name,''))
      @@ websearch_to_tsquery('simple',btrim(p_query))
      or title ilike '%'||btrim(p_query)||'%'
      or brand_name ilike '%'||btrim(p_query)||'%'
    )
  order by current_price asc, observed_at desc
  limit greatest(1,least(coalesce(p_limit,50),100))
)
select case when not exists(select 1 from b) then null else jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'retailer',retailer_name,
    'domain',domain,
    'category',category,
    'brand',brand_name,
    'product',title,
    'currentPrice',current_price,
    'regularPrice',regular_price,
    'discountPct',discount_pct,
    'inStock',in_stock,
    'ml',ml,
    'unitPrice',unit_price,
    'url',product_url,
    'observedAt',observed_at
  )) from filtered),'[]'::jsonb),
  'count',(select count(*) from filtered)
) end;
$function$


revoke all on function public.brands_peru_liquor_search(text,text,text,text,integer) from public, anon;
grant execute on function public.brands_peru_liquor_search(text,text,text,text,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brands_peru_liquor_history(p_slug text DEFAULT 'bodegas-don-luis'::text, p_category text DEFAULT NULL::text, p_brand text DEFAULT NULL::text, p_retailer text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
with authorized as (
  select (p_slug = 'bodegas-don-luis' and private.enterprise_brand_slug_allowed(p_slug)) ok
),
b as (
  select id from public.brands_vertical_brands
  where slug=p_slug and status='active' and (select ok from authorized)
  limit 1
),
raw as (
  select
    l.observed_at::date obs_day,
    s.retailer_name,
    l.category,
    coalesce(l.attributes->>'actualBrand',l.brand_name,'Sin marca') brand_name,
    l.current_price,
    l.regular_price,
    (lower(coalesce(l.attributes->>'promotion','false'))='true'
      or (l.regular_price > l.current_price and l.current_price > 0)) is_promo
  from public.brands_vertical_listings l
  join b on b.id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active
  where l.category in ('Pisco','Ron','Vino')
    and l.current_price between 1 and 5000
    and l.observed_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365)))
    and (p_category is null or btrim(p_category)='' or lower(l.category)=lower(btrim(p_category)))
    and (p_brand is null or btrim(p_brand)='' or coalesce(l.attributes->>'actualBrand',l.brand_name,'') ilike '%'||btrim(p_brand)||'%')
    and (p_retailer is null or btrim(p_retailer)='' or s.retailer_name ilike '%'||btrim(p_retailer)||'%')
),
agg as (
  select obs_day,retailer_name,category,brand_name,
    round(avg(current_price),2) avg_price,
    round(min(current_price),2) min_price,
    round(max(current_price),2) max_price,
    count(*)::int observations,
    count(*) filter(where is_promo)::int promo_count
  from raw
  group by obs_day,retailer_name,category,brand_name
)
select case when not exists(select 1 from b) then null else jsonb_build_object(
  'days',greatest(1,least(coalesce(p_days,30),365)),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'date',obs_day::text,
    'retailer',retailer_name,
    'category',category,
    'brand',brand_name,
    'avgPrice',avg_price,
    'minPrice',min_price,
    'maxPrice',max_price,
    'observations',observations,
    'promoCount',promo_count
  ) order by obs_day,retailer_name,category,brand_name) from agg),'[]'::jsonb)
) end;
$function$


revoke all on function public.brands_peru_liquor_history(text,text,text,text,integer) from public, anon;
grant execute on function public.brands_peru_liquor_history(text,text,text,text,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brands_peru_liquor_export(p_slug text DEFAULT 'bodegas-don-luis'::text, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
with authorized as (
  select (p_slug = 'bodegas-don-luis' and private.enterprise_brand_slug_allowed(p_slug)) ok
),
b as (
  select id from public.brands_vertical_brands
  where slug=p_slug and status='active' and (select ok from authorized)
  limit 1
),
latest as (
  select distinct on (l.source_id,l.category,coalesce(l.source_product_key,l.product_url))
    s.retailer_name,
    s.domain,
    l.category,
    coalesce(l.attributes->>'actualBrand',l.brand_name,'Sin marca') brand_name,
    l.title,
    coalesce(l.source_product_key,l.product_url) source_product_key,
    l.current_price,
    l.regular_price,
    coalesce(
      nullif(l.attributes->>'discountPct','')::numeric,
      case when l.regular_price > l.current_price and l.current_price > 0
        then round((1-l.current_price/l.regular_price)*100,1)
      end
    ) discount_pct,
    l.in_stock,
    nullif(l.attributes->>'ml','')::numeric ml,
    nullif(l.attributes->>'unitPrice','')::numeric unit_price,
    l.currency,
    l.product_url,
    l.observed_at
  from public.brands_vertical_listings l
  join b on b.id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active
  where l.category in ('Pisco','Ron','Vino')
    and l.current_price between 1 and 5000
    and (p_category is null or btrim(p_category)='' or lower(l.category)=lower(btrim(p_category)))
  order by l.source_id,l.category,coalesce(l.source_product_key,l.product_url),l.observed_at desc,l.id desc
)
select case when not exists(select 1 from b) then null else jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'cadena',retailer_name,
    'dominio',domain,
    'categoria',category,
    'marca',brand_name,
    'producto',title,
    'skuFuente',source_product_key,
    'precioActual',current_price,
    'precioRegular',regular_price,
    'descuentoPct',discount_pct,
    'stock',in_stock,
    'ml',ml,
    'precioPorLitro',unit_price,
    'moneda',currency,
    'url',product_url,
    'observadoAt',observed_at
  ) order by category,retailer_name,brand_name,title) from latest),'[]'::jsonb),
  'count',(select count(*) from latest),
  'lastObservedAt',(select max(observed_at) from latest)
) end;
$function$


revoke all on function public.brands_peru_liquor_export(text,text) from public, anon;
grant execute on function public.brands_peru_liquor_export(text,text) to authenticated, service_role;