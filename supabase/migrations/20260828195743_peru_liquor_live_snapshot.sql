CREATE OR REPLACE FUNCTION public.brands_peru_liquor_snapshot_internal(p_slug text DEFAULT 'bodegas-don-luis'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with b as (
  select id from public.brands_vertical_brands where slug=p_slug and status='active' limit 1
),
latest as (
  select distinct on (l.source_id,coalesce(l.source_product_key,l.product_url))
    l.id,l.source_id,l.product_id,l.source_product_key,l.title,l.brand_name,l.category,l.product_url,
    l.regular_price,l.current_price,l.currency,l.attributes,l.observed_at,
    s.retailer_name,s.domain,s.priority,p.canonical_key,
    coalesce(l.attributes->>'actualBrand',l.brand_name,'Sin marca') actual_brand,
    coalesce(l.attributes->>'role','brand') item_role,
    coalesce(l.attributes->>'marketCategory',l.category,'Otros') market_category,
    nullif(l.attributes->>'ml','')::numeric ml,
    coalesce(nullif(l.attributes->>'discountPct','')::numeric,
      case when l.regular_price>l.current_price and l.current_price>0
           then round((1-l.current_price/l.regular_price)*100,1) end) discount_pct,
    (lower(coalesce(l.attributes->>'promotion','false'))='true'
      or (l.regular_price>l.current_price and l.current_price>0)) is_promo
  from public.brands_vertical_listings l
  join b on b.id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active
  left join public.brands_vertical_products p on p.id=l.product_id
  where l.current_price between 10 and 1000
  order by l.source_id,coalesce(l.source_product_key,l.product_url),l.observed_at desc
),
norm as (
  select *,case when ml>0 then round(current_price/(ml/1000.0),2) end unit_price from latest
),
retailer_groups as (
  select retailer_name,domain,max(priority) priority,max(observed_at) observed_at,
         count(*)::int item_count,count(*) filter(where is_promo)::int promo_count,
         min(current_price) lowest_price,max(discount_pct) max_discount,min(product_url) source_url
  from norm group by retailer_name,domain
),
sources_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'role','brand','brand','Bodegas Don Luis','channel',g.retailer_name,'location','Perú',
    'url',g.source_url,'domain',g.domain,'status','ok','observedAt',g.observed_at,
    'metrics',jsonb_build_object('items',g.item_count,'promoItems',g.promo_count,'lowestPrice',g.lowest_price,'maxDiscountPct',g.max_discount),
    'error',null,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'key',coalesce(n.canonical_key,n.source_product_key,n.id::text),'name',n.title,'category',n.category,
      'marketCategory',n.market_category,'currentPrice',n.current_price,'regularPrice',n.regular_price,
      'discountPct',n.discount_pct,'units',null,'unitPrice',n.unit_price,'benchmark','pen-l',
      'benchmarkLabel','S/ por litro','promotion',n.is_promo,'promoMechanic',nullif(n.attributes->>'promoMechanic','')
    ) order by case when n.item_role='brand' then 0 else 1 end,n.category,n.current_price)
      from norm n where n.domain=g.domain),'[]'::jsonb)
  ) order by g.priority desc,g.retailer_name),'[]'::jsonb) value
  from retailer_groups g
),
product_best as (
  select * from (
    select n.*,row_number() over(partition by canonical_key order by case when domain='tottus.com.pe' then 0 else 1 end,priority desc,observed_at desc) rn
    from norm n where canonical_key is not null
  ) z where rn=1
),
benchmark_defs(key,label,subject_key,competitor_key,note,sort_order) as (
  values
  ('pisco-mainstream','Pisco · Cuatro Gallos vs Santiago Queirolo','cg-quebranta-700','sq-quebranta-750','Comparación normalizada por litro frente a una referencia mainstream de pisco.',1),
  ('pisco-premium','Pisco · Cuatro Gallos vs Finca Rotondo MV','cg-quebranta-700','finca-mv-quebranta-750','Comparación normalizada por litro frente a una referencia premium de pisco.',2),
  ('vino-entry','Vino · E. Copello vs Santiago Queirolo','ecopello-tinto-750','sq-magdalena-750','Comparación de vinos de entrada en formato 750 ml.',3),
  ('ron-premium','Ron · Mandatario Solera vs Flor de Caña 12','mandatario-solera-750','flor-cana-12-750','Referencia de escalera premium; no implica equivalencia exacta de añejamiento.',4)
),
benchmarks_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',d.key,'label',d.label,
    'subject',jsonb_build_object('brand',s.actual_brand,'price',s.current_price,'unitPrice',s.unit_price),
    'competitor',jsonb_build_object('brand',c.actual_brand,'price',c.current_price,'unitPrice',c.unit_price),
    'gapPct',case when c.unit_price>0 then round((s.unit_price/c.unit_price-1)*100,1) end,
    'leader',case when s.unit_price<c.unit_price then s.actual_brand when c.unit_price<s.unit_price then c.actual_brand else 'Empate' end,
    'note',d.note
  ) order by d.sort_order),'[]'::jsonb) value
  from benchmark_defs d join product_best s on s.canonical_key=d.subject_key join product_best c on c.canonical_key=d.competitor_key
),
hist_raw as (
  select l.observed_at::date obs_day,
         coalesce(l.attributes->>'role','brand') item_role,
         coalesce(l.category,'Otros') market_cat,
         case when nullif(l.attributes->>'ml','')::numeric>0
              then l.current_price/(nullif(l.attributes->>'ml','')::numeric/1000.0)
              else l.current_price end unit_price
  from public.brands_vertical_listings l join b on b.id=l.brand_id
  where l.current_price between 10 and 1000 and l.observed_at>=now()-interval '30 days'
    and coalesce(l.category,'Otros') in ('Pisco','Ron','Vino')
),
hist_agg as (
  select obs_day,item_role,market_cat,round(avg(unit_price),2) avg_unit,
         round(min(unit_price),2) min_unit,round(max(unit_price),2) max_unit,count(*)::int products
  from hist_raw group by obs_day,item_role,market_cat
),
history_json as (
  select jsonb_build_object(
    'policy','public-monitoring','days',30,
    'from',(select min(obs_day)::text from hist_agg),'to',(select max(obs_day)::text from hist_agg),
    'categories',jsonb_build_array('Pisco · S/ por litro','Ron · S/ por litro','Vino · S/ por litro'),
    'points',coalesce((select jsonb_agg(jsonb_build_object(
      'date',h.obs_day::text,'brand',case when h.item_role='brand' then 'Bodegas Don Luis' else 'Benchmark mercado Perú' end,
      'role',h.item_role,'category',h.market_cat||' · S/ por litro','avgPrice',h.avg_unit,'avgUnitPrice',h.avg_unit,
      'minPrice',h.min_unit,'maxPrice',h.max_unit,'products',h.products
    ) order by h.obs_day,h.item_role,h.market_cat) from hist_agg h),'[]'::jsonb)
  ) value
),
fresh as (
  select max(observed_at) observed_at,count(*) filter(where item_role='brand') brand_rows,count(*) filter(where item_role='competitor') competitor_rows from norm
)
select case when not exists(select 1 from b) then null else jsonb_build_object(
  'status',case when f.brand_rows>0 and f.observed_at>=now()-interval '12 hours' then 'live' when f.brand_rows>0 then 'partial' else 'unavailable' end,
  'mode','persisted','freshness',case when f.observed_at is null then 'unavailable' when f.observed_at>=now()-interval '6 hours' then 'fresh' when f.observed_at>=now()-interval '24 hours' then 'recent' else 'stale' end,
  'sourcePolicy','public-monitoring','category','Pisco · Ron · Vino','subjectBrand','Bodegas Don Luis',
  'competitorBrand','Benchmark mercado Perú','channel','Tottus · Metro · Wong · Vivanda · Plaza Vea/Makro',
  'market','Perú','observedAt',f.observed_at,'sources',(select value from sources_json),
  'benchmarks',(select value from benchmarks_json),'history',(select value from history_json)
) end from fresh f;
$function$


revoke all on function public.brands_peru_liquor_snapshot_internal(text) from public,anon,authenticated;
grant execute on function public.brands_peru_liquor_snapshot_internal(text) to service_role;

CREATE OR REPLACE FUNCTION public.brands_peru_liquor_snapshot(p_slug text DEFAULT 'bodegas-don-luis'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select case when private.enterprise_brand_slug_allowed(p_slug)
    then public.brands_peru_liquor_snapshot_internal(p_slug) else null end;
$function$


revoke all on function public.brands_peru_liquor_snapshot(text) from public,anon;
grant execute on function public.brands_peru_liquor_snapshot(text) to authenticated,service_role;
