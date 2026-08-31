
create or replace function public.brands_piwen_marketplace_snapshot_internal(p_slug text default 'piwen')
returns jsonb
language sql
stable
security definer
set search_path to public,pg_temp
as $$
with b as (
  select id from public.brands_vertical_brands where slug=p_slug and status='active' limit 1
),
src as (
  select s.id,s.retailer_name,s.domain,s.last_crawled_at,s.last_status,s.last_error
  from public.brands_vertical_sources s join b on b.id=s.brand_id
  where s.domain='mercadolibre.cl' and s.active
  limit 1
),
latest as (
  select distinct on (l.source_product_key)
    l.source_product_key,l.title,l.brand_name,l.seller_name,l.category,l.product_url,
    l.regular_price,l.current_price,l.currency,l.in_stock,l.observed_at,l.attributes,l.raw,
    coalesce(l.attributes->>'actualBrand',l.brand_name,'Sin marca') as actual_brand,
    coalesce(l.attributes->>'role','competitor') as item_role,
    coalesce(l.attributes->>'family',l.category,'Frutos secos') as family,
    nullif(l.attributes->>'grams','')::numeric as grams,
    coalesce(
      nullif(l.attributes->>'pricePerKg','')::numeric,
      case when nullif(l.attributes->>'grams','')::numeric>0 and l.current_price>0
           then round(l.current_price*1000/nullif(l.attributes->>'grams','')::numeric,0) end
    ) as price_per_kg,
    coalesce(
      nullif(l.attributes->>'discountPct','')::numeric,
      case when l.regular_price>l.current_price and l.current_price>0
           then round((1-l.current_price/l.regular_price)*100,1) end
    ) as discount_pct,
    coalesce(l.attributes->>'verification','persisted') as verification,
    l.attributes->>'sourceFreshness' as source_freshness
  from public.brands_vertical_listings l
  join src s on s.id=l.source_id
  order by l.source_product_key,l.observed_at desc
),
summary as (
  select
    count(*)::int products,
    count(*) filter(where current_price>0)::int priced,
    count(*) filter(where in_stock is true)::int in_stock,
    count(distinct actual_brand)::int brands,
    max(observed_at) observed_at
  from latest
)
select case when not exists(select 1 from src) then null else jsonb_build_object(
  'status',case when s.products>0 then 'available' else 'empty' end,
  'source','MercadoLibre Chile',
  'domain','mercadolibre.cl',
  'lastCrawledAt',(select last_crawled_at from src),
  'lastStatus',(select last_status from src),
  'observedAt',s.observed_at,
  'products',s.products,
  'pricedProducts',s.priced,
  'inStockProducts',s.in_stock,
  'brands',s.brands,
  'listings',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',x.source_product_key,
      'retailer','MercadoLibre Chile',
      'brand',x.actual_brand,
      'role',x.item_role,
      'name',x.title,
      'family',x.family,
      'grams',x.grams,
      'format',case when x.grams is null then 'Sin formato'
                    when x.grams>=1000 and mod(x.grams,1000)=0 then (x.grams/1000)::text||' kg'
                    else x.grams::text||' g' end,
      'currentPrice',x.current_price,
      'regularPrice',x.regular_price,
      'pricePerKg',x.price_per_kg,
      'promotionPct',x.discount_pct,
      'inStock',x.in_stock,
      'seller',x.seller_name,
      'observedAt',x.observed_at,
      'url',x.product_url,
      'verification',x.verification,
      'sourceFreshness',x.source_freshness
    ) order by case x.actual_brand when 'Piwén' then 0 when 'Alto La Cruz' then 1 else 2 end,x.family,x.title)
    from latest x
  ),'[]'::jsonb)
) end
from summary s;
$$;

revoke all on function public.brands_piwen_marketplace_snapshot_internal(text) from public,anon,authenticated;
grant execute on function public.brands_piwen_marketplace_snapshot_internal(text) to service_role;

create or replace function public.brands_piwen_marketplace_snapshot(p_slug text default 'piwen')
returns jsonb
language sql
stable
security definer
set search_path to public,private,pg_temp
as $$
  select case when private.enterprise_brand_slug_allowed(p_slug)
    then public.brands_piwen_marketplace_snapshot_internal(p_slug) else null end;
$$;

revoke all on function public.brands_piwen_marketplace_snapshot(text) from public,anon;
grant execute on function public.brands_piwen_marketplace_snapshot(text) to authenticated,service_role;
