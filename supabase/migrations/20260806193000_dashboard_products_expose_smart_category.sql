create or replace view public.dashboard_products as
select
  p.id,
  p.supermarket,
  p.external_id,
  btrim(replace(replace(replace(replace(p.name, '&nbsp;', ' '), '&amp;', '&'), '&quot;', '"'), '&#39;', '''')) as name,
  p.brand,
  case
    when p.category is null or length(btrim(p.category)) <= 1 then null::text
    when p.category = 'juguetera a' then 'Juguetería'
    when p.category = 'librera a' then 'Librería'
    when p.category = 'tecnologa a' then 'Tecnología'
    when p.category = 'muebles y decoracion' then 'Muebles y decoración'
    when p.category = 'menaje cocina' then 'Menaje de cocina'
    when p.category = 'menaje comedor' then 'Menaje de comedor'
    when p.category = 'rutina para el cabello' then 'Cuidado capilar'
    when p.category = 'vestuario' then 'Vestuario'
    when p.category = 'electrohogar' then 'Electrohogar'
    when p.category = 'dormitorio' then 'Dormitorio'
    when p.category = 'destilados' then 'Destilados'
    when p.category = 'supermercado' then 'Supermercado'
    else p.category
  end as category,
  p.url,
  p.image_url,
  o.regular_price,
  o.offer_price,
  o.unit,
  o.unit_price,
  o.in_stock,
  o.observed_at,
  greatest(coalesce(o.regular_price, o.offer_price) - o.offer_price, 0::numeric) as savings,
  case
    when o.regular_price is not null and o.regular_price > o.offer_price and o.offer_price > 0
      then round((o.regular_price - o.offer_price) / o.regular_price * 100, 1)
    else 0::numeric
  end as discount_pct,
  p.retailer_type,
  p.industry_slug,
  p.seller,
  p.variant,
  p.smart_category
from public.products p
join lateral (
  select
    po.regular_price,
    po.offer_price,
    po.unit,
    po.unit_price,
    po.in_stock,
    po.observed_at
  from public.price_observations po
  where po.product_id = p.id
    and po.crawl_run_id is not null
  order by po.observed_at desc
  limit 1
) o on true
where p.retailer_type = any (array['supermarket'::text, 'department_store'::text, 'pharmacy'::text])
  and coalesce(p.source_metadata ->> 'capture_status', 'accepted') = 'accepted'
  and (p.retailer_type <> 'pharmacy' or o.offer_price > 0);
