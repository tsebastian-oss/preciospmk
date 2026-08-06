drop materialized view if exists public.product_match_summary;

create materialized view public.product_match_summary as
with per_store as (
  select distinct on (l.match_key, l.supermarket)
    l.match_key,
    l.id,
    l.supermarket,
    l.name,
    l.brand,
    l.category,
    l.url,
    l.image_url,
    l.regular_price,
    l.offer_price,
    l.in_stock,
    l.observed_at
  from public.product_matching_listings l
  where l.offer_price > 0
  order by
    l.match_key,
    l.supermarket,
    l.in_stock desc,
    l.observed_at desc,
    l.offer_price asc,
    l.id
), grouped as (
  select
    p.match_key,
    min(p.name) as canonical_name,
    min(p.brand) filter (where nullif(p.brand,'') is not null) as canonical_brand,
    min(p.category) filter (where nullif(p.category,'') is not null) as category,
    count(*)::integer as listings,
    count(*)::integer as supermarkets,
    min(p.offer_price) as best_price,
    max(p.offer_price) as highest_price,
    avg(p.offer_price)::numeric(14,2) as average_price,
    max(p.offer_price) - min(p.offer_price) as price_gap,
    case when max(p.offer_price) > 0
      then round((max(p.offer_price)-min(p.offer_price))/max(p.offer_price)*100,1)
      else 0::numeric
    end as savings_pct,
    max(p.observed_at) as last_updated
  from per_store p
  group by p.match_key
  having count(*) >= 2
), best as (
  select distinct on (p.match_key)
    p.match_key,
    p.supermarket as best_supermarket,
    p.url as best_url,
    p.image_url,
    p.id as best_product_id
  from per_store p
  join grouped g using (match_key)
  order by p.match_key, p.in_stock desc, p.offer_price asc, p.observed_at desc
), details as (
  select
    p.match_key,
    jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'supermarket',p.supermarket,
        'name',p.name,
        'brand',p.brand,
        'price',p.offer_price,
        'regular_price',p.regular_price,
        'in_stock',p.in_stock,
        'url',p.url,
        'image_url',p.image_url,
        'observed_at',p.observed_at
      )
      order by case p.supermarket when 'Lider' then 1 when 'Jumbo' then 2 when 'Santa Isabel' then 3 else 9 end
    ) as store_listings
  from per_store p
  join grouped g using (match_key)
  group by p.match_key
)
select
  g.match_key,
  g.canonical_name,
  g.canonical_brand,
  g.category,
  g.listings,
  g.supermarkets,
  g.best_price,
  g.highest_price,
  g.average_price,
  g.price_gap,
  g.savings_pct,
  g.last_updated,
  b.best_supermarket,
  b.best_url,
  b.image_url,
  b.best_product_id,
  d.store_listings
from grouped g
join best b using (match_key)
join details d using (match_key);

create unique index product_match_summary_match_key_idx on public.product_match_summary(match_key);
create index product_match_summary_coverage_gap_idx on public.product_match_summary(supermarkets desc,price_gap desc);
create index product_match_summary_gap_idx on public.product_match_summary(price_gap desc);
create index product_match_summary_savings_idx on public.product_match_summary(savings_pct desc);
create index product_match_summary_name_trgm_idx on public.product_match_summary using gin(canonical_name gin_trgm_ops);

grant all on public.product_match_summary to anon, authenticated, service_role;

comment on materialized view public.product_match_summary is 'Price matches normalized to one current representative listing per retailer chain.';
