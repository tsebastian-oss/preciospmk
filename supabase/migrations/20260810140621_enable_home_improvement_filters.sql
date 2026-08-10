drop materialized view public.product_filter_facets;

create materialized view public.product_filter_facets as
select
  p.retailer_type,
  p.supermarket,
  p.industry_slug,
  coalesce(nullif(btrim(p.smart_category), ''), nullif(btrim(p.category), '')) as category,
  nullif(btrim(p.brand), '') as brand,
  count(*)::integer as products,
  count(*) filter (where s.in_stock)::integer as in_stock,
  count(*) filter (where not s.in_stock)::integer as out_of_stock,
  max(s.observed_at) as last_observed_at
from public.products p
join public.product_latest_price_state s on s.product_id = p.id
where p.retailer_type = any (array['supermarket'::text, 'department_store'::text, 'pharmacy'::text, 'home_improvement'::text])
  and coalesce(p.source_metadata ->> 'capture_status', 'accepted') = 'accepted'
  and (p.retailer_type <> 'pharmacy' or s.offer_price > 0)
group by
  p.retailer_type,
  p.supermarket,
  p.industry_slug,
  coalesce(nullif(btrim(p.smart_category), ''), nullif(btrim(p.category), '')),
  nullif(btrim(p.brand), '');

create index product_filter_facets_category_brand_idx on public.product_filter_facets (category, brand);
create unique index product_filter_facets_concurrent_uidx on public.product_filter_facets (retailer_type, supermarket, industry_slug, category, brand) nulls not distinct;
create index product_filter_facets_store_category_idx on public.product_filter_facets (supermarket, category);
create index product_filter_facets_type_store_idx on public.product_filter_facets (retailer_type, supermarket);
create unique index product_filter_facets_uidx on public.product_filter_facets (retailer_type, supermarket, coalesce(industry_slug, ''), coalesce(category, ''), coalesce(brand, ''));

update public.organization_scopes s
set retailers = coalesce(s.retailers, array[]::text[])
  || array(
    select candidate
    from unnest(array['Easy','Sodimac']::text[]) candidate
    where not (candidate = any(coalesce(s.retailers, array[]::text[])))
  ),
  updated_at = now()
where s.organization_id = (
  select o.id from public.organizations o where o.name = 'MGP Intelligence' order by o.created_at limit 1
);
