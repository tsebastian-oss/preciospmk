-- Expand the light brand payload so official catalog rows are not displaced by marketplace freshness.
create or replace function public.brands_vertical_light_payload(p_slug text default 'victorinox'::text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with b as (
  select id,slug,name,country_code,official_url from public.brands_vertical_brands where slug=p_slug and status='active' limit 1
), latest as (
  select distinct on(l.source_id,coalesce(l.source_product_key,l.product_url)) l.*
  from public.brands_vertical_listings l join b on b.id=l.brand_id
  order by l.source_id,coalesce(l.source_product_key,l.product_url),l.observed_at desc
), lr as (
  select r.status run_status,r.sources_attempted,r.sources_succeeded,r.listings_found,r.products_found,r.started_at,r.finished_at,r.notes
  from public.brands_vertical_discovery_runs r join b on b.id=r.brand_id order by r.created_at desc limit 1
)
select jsonb_build_object(
  'brand',(select jsonb_build_object('id',id,'slug',slug,'name',name,'countryCode',country_code,'officialUrl',official_url) from b),
  'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'retailer_name',s.retailer_name,'domain',s.domain,'source_type',s.source_type,'priority',s.priority,'last_crawled_at',s.last_crawled_at,'last_status',s.last_status,'last_error',s.last_error) order by s.priority desc) from public.brands_vertical_sources s join b on b.id=s.brand_id where s.active),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'sku',p.external_sku,'ean',p.ean,'name',p.name,'category',p.category,'subcategory',p.subcategory,'url',p.product_url,'imageUrl',p.image_url,'attributes',p.attributes,'lastSeenAt',p.last_seen_at) order by p.last_seen_at desc) from (select p.* from public.brands_vertical_products p join b on b.id=p.brand_id where p.active order by p.last_seen_at desc limit 1000) p),'[]'::jsonb),
  'listings',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'source',s.retailer_name,'domain',s.domain,'title',l.title,'seller',l.seller_name,'category',l.category,'url',l.product_url,'imageUrl',l.image_url,'regularPrice',l.regular_price,'currentPrice',l.current_price,'currency',l.currency,'inStock',l.in_stock,'rating',l.rating,'reviewCount',l.review_count,'observedAt',l.observed_at) order by l.observed_at desc) from (select * from latest order by observed_at desc limit 1000) l join public.brands_vertical_sources s on s.id=l.source_id),'[]'::jsonb),
  'lastRun',(select jsonb_build_object('status',run_status,'sourcesAttempted',sources_attempted,'sourcesSucceeded',sources_succeeded,'listingsFound',listings_found,'productsFound',products_found,'startedAt',started_at,'finishedAt',finished_at,'notes',notes) from lr)
);
$function$;

revoke execute on function public.brands_vertical_light_payload(text) from public, anon;
grant execute on function public.brands_vertical_light_payload(text) to authenticated, service_role;
