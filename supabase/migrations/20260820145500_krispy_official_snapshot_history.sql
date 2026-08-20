create or replace function public.brands_qsr_official_snapshot(p_slug text default 'krispy-kreme')
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
with cfg as (
  select b.id as brand_id,b.slug,
    case when b.slug='krispy-kreme' then 'Krispy Kreme' else b.name end as subject_brand,
    case when b.slug='krispy-kreme' then 'Dunkin' else null end as competitor_brand,
    case when b.slug='krispy-kreme' then 'Donuts & café' else 'Competitive pricing' end as category,
    'Sitios oficiales'::text as channel,
    'Chile'::text as market
  from public.brands_vertical_brands b
  where b.slug=p_slug and b.status='active'
  limit 1
), official_rows as (
  select l.*,s.domain,s.retailer_name,s.priority,p.canonical_key,
    coalesce(l.attributes->>'actualBrand',l.brand_name) as actual_brand,
    coalesce(l.attributes->>'role',case when l.brand_name=(select subject_brand from cfg) then 'brand' else 'competitor' end) as role,
    coalesce(nullif(l.attributes->>'marketCategory',''),l.category,'Sin categoría') as market_category,
    nullif(l.attributes->>'benchmark','') as benchmark_key,
    nullif(l.attributes->>'units','')::numeric as units,
    case when lower(coalesce(l.attributes->>'promotion','false'))='true' or nullif(l.attributes->>'promoMechanic','') is not null then true else false end as is_promo,
    nullif(l.attributes->>'promoMechanic','') as promo_mechanic
  from public.brands_vertical_listings l
  join cfg on cfg.brand_id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active and s.source_type='official'
  left join public.brands_vertical_products p on p.id=l.product_id
  where l.current_price>0
    and coalesce(l.attributes->>'sourcePolicy','')='official-only'
    and coalesce(l.attributes->>'pricingSource','')='official'
), ranked as (
  select o.*,row_number() over (
    partition by o.actual_brand,coalesce(o.canonical_key,o.source_product_key,o.id::text)
    order by o.observed_at desc
  ) as rn
  from official_rows o
), latest as (select * from ranked where rn=1),
source_rows as (
  select role,actual_brand,max(observed_at) as observed_at,
    (array_agg(retailer_name order by observed_at desc))[1] as channel_name,
    (array_agg(domain order by observed_at desc))[1] as source_domain,
    (array_agg(product_url order by observed_at desc))[1] as source_url,
    count(*)::int as item_count,count(*) filter(where is_promo)::int as promo_count,min(current_price) as lowest_price
  from latest group by role,actual_brand
), source_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'role',sr.role,'brand',sr.actual_brand,'channel',sr.channel_name,'location','Chile','url',sr.source_url,'domain',sr.source_domain,'status','ok','observedAt',sr.observed_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'key',coalesce(l.canonical_key,l.source_product_key,l.id::text),'name',l.title,'category',l.category,'marketCategory',l.market_category,
      'currentPrice',l.current_price,'regularPrice',l.regular_price,'discountPct',null,'units',l.units,
      'unitPrice',case when l.units>0 then round(l.current_price/l.units) else null end,'benchmark',l.benchmark_key,
      'benchmarkLabel',case l.benchmark_key when 'pack-6' then 'Pack 6' when 'pack-12' then 'Docena' when 'pack-24' then '24 unidades' when 'americano-m' then 'Americano M' when 'latte-m' then 'Latte M' when 'cappuccino-m' then 'Cappuccino M' else null end,
      'promotion',l.is_promo,'promoMechanic',l.promo_mechanic
    ) order by l.market_category,l.current_price,l.title) from latest l where l.role=sr.role and l.actual_brand=sr.actual_brand),'[]'::jsonb),
    'metrics',jsonb_build_object('items',sr.item_count,'promoItems',sr.promo_count,'lowestPrice',sr.lowest_price,'maxDiscountPct',null),'error',null
  ) order by case when sr.role='brand' then 0 else 1 end,sr.actual_brand),'[]'::jsonb) as value
  from source_rows sr
), benchmark_pairs as (
  select a.benchmark_key as key,a.actual_brand as subject_brand,a.current_price as subject_price,
    case when a.units>0 then round(a.current_price/a.units) else a.current_price end as subject_unit_price,
    c.actual_brand as competitor_brand,c.current_price as competitor_price,
    case when c.units>0 then round(c.current_price/c.units) else c.current_price end as competitor_unit_price
  from latest a join latest c on c.benchmark_key=a.benchmark_key and c.role='competitor'
  where a.role='brand' and a.benchmark_key is not null
), benchmarks as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',bp.key,
    'label',case bp.key when 'pack-6' then 'Pack 6' when 'pack-12' then 'Docena' when 'pack-24' then '24 unidades' when 'americano-m' then 'Americano M' when 'latte-m' then 'Latte M' when 'cappuccino-m' then 'Cappuccino M' else bp.key end,
    'subject',jsonb_build_object('brand',bp.subject_brand,'price',bp.subject_price,'unitPrice',bp.subject_unit_price),
    'competitor',jsonb_build_object('brand',bp.competitor_brand,'price',bp.competitor_price,'unitPrice',bp.competitor_unit_price),
    'gapPct',case when bp.competitor_unit_price>0 then round((bp.subject_unit_price/bp.competitor_unit_price-1)*100,1) else null end,
    'leader',case when bp.subject_unit_price<bp.competitor_unit_price then bp.subject_brand when bp.competitor_unit_price<bp.subject_unit_price then bp.competitor_brand else 'Empate' end,
    'note','Comparación sobre precios publicados en los canales web oficiales de ambas marcas.'
  ) order by case bp.key when 'pack-6' then 1 when 'pack-12' then 2 when 'pack-24' then 3 when 'americano-m' then 4 when 'latte-m' then 5 when 'cappuccino-m' then 6 else 9 end),'[]'::jsonb) as value
  from benchmark_pairs bp
), history_ranked as (
  select o.*,(o.observed_at at time zone 'America/Santiago')::date as observed_date,
    row_number() over (
      partition by (o.observed_at at time zone 'America/Santiago')::date,o.actual_brand,coalesce(o.canonical_key,o.source_product_key,o.id::text)
      order by o.observed_at desc
    ) as day_rn
  from official_rows o where o.observed_at>=now()-interval '90 days'
), history_products as (select * from history_ranked where day_rn=1),
history_daily as (
  select observed_date,actual_brand,role,market_category,
    round(avg(current_price),0) as avg_price,
    round(avg(case when units>0 then current_price/units else current_price end),0) as avg_unit_price,
    min(current_price) as min_price,max(current_price) as max_price,count(*)::int as products
  from history_products group by observed_date,actual_brand,role,market_category
), history_json as (
  select jsonb_build_object(
    'policy','official-only','days',90,'from',min(observed_date),'to',max(observed_date),
    'categories',coalesce((select jsonb_agg(category order by sort_key,category) from (
      select distinct market_category as category,
        case market_category when 'Packs · 3 unidades' then 1 when 'Packs · 6 unidades' then 2 when 'Packs · 12 unidades' then 3 when 'Packs · 24 unidades' then 4 when 'Donut individual' then 5 when 'Café caliente' then 6 when 'Café frío' then 7 when 'Combos' then 8 when 'Edición limitada' then 9 else 20 end as sort_key
      from history_daily
    ) c),'[]'::jsonb),
    'points',coalesce(jsonb_agg(jsonb_build_object(
      'date',observed_date,'brand',actual_brand,'role',role,'category',market_category,'avgPrice',avg_price,'avgUnitPrice',avg_unit_price,
      'minPrice',min_price,'maxPrice',max_price,'products',products
    ) order by observed_date,market_category,role,actual_brand),'[]'::jsonb)
  ) as value from history_daily
), freshness as (
  select max(observed_at) as observed_at,count(*) filter(where role='brand') as brand_rows,count(*) filter(where role='competitor') as competitor_rows from latest
)
select case when not exists(select 1 from cfg) then null else jsonb_build_object(
  'status',case when f.brand_rows>0 and f.competitor_rows>0 and f.observed_at>=now()-interval '24 hours' then 'live' when f.brand_rows>0 or f.competitor_rows>0 then 'partial' else 'unavailable' end,
  'mode','persisted','freshness',case when f.observed_at is null then 'unavailable' when f.observed_at>=now()-interval '6 hours' then 'fresh' when f.observed_at>=now()-interval '24 hours' then 'recent' else 'stale' end,
  'sourcePolicy','official-only','category',cfg.category,'subjectBrand',cfg.subject_brand,'competitorBrand',cfg.competitor_brand,
  'channel',cfg.channel,'market',cfg.market,'observedAt',f.observed_at,'sources',(select value from source_json),'benchmarks',(select value from benchmarks),'history',(select value from history_json)
) end from cfg cross join freshness f;
$function$;

revoke all on function public.brands_qsr_official_snapshot(text) from public,anon;
grant execute on function public.brands_qsr_official_snapshot(text) to authenticated,service_role;

create or replace function public.dispatch_qsr_pricing_worker_sync()
returns jsonb
language plpgsql
security definer
set search_path = public,extensions
as $function$
declare
  v_token text;
  v_official extensions.http_response;
  v_little extensions.http_response;
begin
  select token into v_token from public.qsr_worker_config where id=1;
  if v_token is null then raise exception 'qsr_worker_token_missing'; end if;
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');

  v_official := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/krispy-official-pricing-worker'::varchar,
    array[row('x-qsr-worker-token',v_token)::extensions.http_header,row('accept','application/json')::extensions.http_header],
    'application/json'::varchar,
    '{}'::varchar
  )::extensions.http_request);

  v_little := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/qsr-pricing-worker'::varchar,
    array[row('x-qsr-worker-token',v_token)::extensions.http_header,row('accept','application/json')::extensions.http_header],
    'application/json'::varchar,
    '{"slug":"little-caesars"}'::varchar
  )::extensions.http_request);

  return jsonb_build_object(
    'krispyOfficial',jsonb_build_object('status',v_official.status,'content',case when coalesce(v_official.content,'')='' then '{}'::jsonb else v_official.content::jsonb end),
    'littleCaesars',jsonb_build_object('status',v_little.status,'content',case when coalesce(v_little.content,'')='' then '{}'::jsonb else v_little.content::jsonb end)
  );
end;
$function$;
