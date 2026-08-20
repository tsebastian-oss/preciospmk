create or replace function public.brands_qsr_competitive_snapshot(p_slug text default 'krispy-kreme')
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
with cfg as (
  select b.id as brand_id,b.slug,
    case when b.slug='krispy-kreme' then 'Krispy Kreme' when b.slug='little-caesars' then 'Little Caesars' else b.name end as subject_brand,
    case when b.slug='krispy-kreme' then 'Dunkin' when b.slug='little-caesars' then 'Papa Johns' else null end as competitor_brand,
    case when b.slug='krispy-kreme' then 'Donuts & café' when b.slug='little-caesars' then 'Pizza QSR' else 'Competitive pricing' end as category,
    case when b.slug='krispy-kreme' then 'Rappi' else 'Canales digitales' end as channel,
    'Santiago de Chile'::text as market
  from public.brands_vertical_brands b
  where b.slug=p_slug and b.status='active'
  limit 1
), ranked as (
  select l.*,s.domain,s.retailer_name,s.priority,
    coalesce(l.attributes->>'actualBrand',l.brand_name) as actual_brand,
    coalesce(l.attributes->>'role',case when l.brand_name=(select subject_brand from cfg) then 'brand' else 'competitor' end) as role,
    nullif(l.attributes->>'benchmark','') as benchmark_key,
    nullif(l.attributes->>'units','')::numeric as units,
    case when lower(coalesce(l.attributes->>'promotion','false'))='true' or (l.regular_price>l.current_price and l.current_price>0) then true else false end as is_promo,
    coalesce(nullif(l.attributes->>'discountPct','')::numeric,case when l.regular_price>l.current_price and l.current_price>0 then round((1-l.current_price/l.regular_price)*100,1) else null end) as discount_pct,
    row_number() over (partition by l.product_id order by case when s.domain='rappi.cl' then 0 else 1 end,s.priority desc,l.observed_at desc) as rn
  from public.brands_vertical_listings l
  join cfg on cfg.brand_id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active
  where l.current_price>0
), latest as (select * from ranked where rn=1),
source_rows as (
  select role,actual_brand,max(observed_at) as observed_at,
    (array_agg(case when domain='rappi.cl' then 'Rappi' else retailer_name end order by case when domain='rappi.cl' then 0 else 1 end,priority desc))[1] as channel_name,
    (array_agg(coalesce(attributes->>'location',(select market from cfg)) order by observed_at desc))[1] as location_name,
    (array_agg(product_url order by observed_at desc))[1] as source_url,
    count(*)::int as item_count,count(*) filter(where is_promo)::int as promo_count,
    min(current_price) as lowest_price,max(discount_pct) as max_discount
  from latest group by role,actual_brand
), source_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'role',sr.role,'brand',sr.actual_brand,'channel',sr.channel_name,'location',sr.location_name,'url',sr.source_url,'status','ok','observedAt',sr.observed_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'key',coalesce(p.canonical_key,l.source_product_key,l.id::text),'name',l.title,'category',coalesce(l.category,'Sin categoría'),'currentPrice',l.current_price,'regularPrice',l.regular_price,
      'discountPct',l.discount_pct,'units',l.units,'unitPrice',case when l.units>0 then round(l.current_price/l.units) else null end,'benchmark',l.benchmark_key,
      'benchmarkLabel',case l.benchmark_key when 'pack-6' then 'Pack 6' when 'pack-12' then 'Docena' when 'pack-24' then 'Doble docena / 24' when 'pepperoni-familiar' then 'Pepperoni familiar' else null end,
      'promotion',l.is_promo,'promoMechanic',nullif(l.attributes->>'promoMechanic','')) order by l.is_promo desc,l.category,l.current_price)
      from latest l left join public.brands_vertical_products p on p.id=l.product_id where l.role=sr.role and l.actual_brand=sr.actual_brand),'[]'::jsonb),
    'metrics',jsonb_build_object('items',sr.item_count,'promoItems',sr.promo_count,'lowestPrice',sr.lowest_price,'maxDiscountPct',sr.max_discount),'error',null
  ) order by case when sr.role='brand' then 0 else 1 end,sr.actual_brand),'[]'::jsonb) as value from source_rows sr
), benchmark_pairs as (
  select a.benchmark_key as key,a.actual_brand as subject_brand,a.current_price as subject_price,
    case when a.units>0 then round(a.current_price/a.units) else a.current_price end as subject_unit_price,
    c.actual_brand as competitor_brand,c.current_price as competitor_price,
    case when c.units>0 then round(c.current_price/c.units) else c.current_price end as competitor_unit_price,
    a.domain as subject_domain,c.domain as competitor_domain
  from latest a join latest c on c.benchmark_key=a.benchmark_key and c.role='competitor'
  where a.role='brand' and a.benchmark_key is not null
), benchmarks as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',bp.key,'label',case bp.key when 'pack-6' then 'Pack 6' when 'pack-12' then 'Docena' when 'pack-24' then 'Doble docena / 24' when 'pepperoni-familiar' then 'Pepperoni familiar' else bp.key end,
    'subject',jsonb_build_object('brand',bp.subject_brand,'price',bp.subject_price,'unitPrice',bp.subject_unit_price),
    'competitor',jsonb_build_object('brand',bp.competitor_brand,'price',bp.competitor_price,'unitPrice',bp.competitor_unit_price),
    'gapPct',case when bp.competitor_unit_price>0 then round((bp.subject_unit_price/bp.competitor_unit_price-1)*100,1) else null end,
    'leader',case when bp.subject_unit_price<bp.competitor_unit_price then bp.subject_brand when bp.competitor_unit_price<bp.subject_unit_price then bp.competitor_brand else 'Empate' end,
    'note',case when bp.subject_domain='rappi.cl' and bp.competitor_domain='rappi.cl' then 'Comparación de precio efectivo por unidad dentro del mismo canal Rappi.' else 'Comparación digital sobre la última observación válida de cada marca.' end
  ) order by case bp.key when 'pack-6' then 1 when 'pack-12' then 2 when 'pack-24' then 3 else 4 end),'[]'::jsonb) as value from benchmark_pairs bp
), freshness as (
  select max(observed_at) as observed_at,count(*) filter(where role='brand') as brand_rows,count(*) filter(where role='competitor') as competitor_rows from latest
)
select case when not exists(select 1 from cfg) then null else jsonb_build_object(
  'status',case when f.brand_rows>0 and f.competitor_rows>0 and f.observed_at>=now()-interval '24 hours' then 'live' when f.brand_rows>0 or f.competitor_rows>0 then 'partial' else 'unavailable' end,
  'mode','persisted','freshness',case when f.observed_at is null then 'unavailable' when f.observed_at>=now()-interval '6 hours' then 'fresh' when f.observed_at>=now()-interval '24 hours' then 'recent' else 'stale' end,
  'category',cfg.category,'subjectBrand',cfg.subject_brand,'competitorBrand',cfg.competitor_brand,'channel',cfg.channel,'market',cfg.market,'observedAt',f.observed_at,
  'sources',(select value from source_json),'benchmarks',(select value from benchmarks)
) end from cfg cross join freshness f;
$function$;

grant execute on function public.brands_qsr_competitive_snapshot(text) to authenticated,service_role;
