drop materialized view if exists public.product_match_summary;

create materialized view public.product_match_summary as
with unified as (
  select
    f.exact_match_key as match_key,
    f.product_id,
    f.supermarket,
    f.name,
    f.brand,
    f.category,
    f.smart_category,
    f.url,
    f.image_url,
    f.regular_price,
    f.offer_price,
    f.in_stock,
    f.observed_at,
    'exact'::text as listing_match_method,
    1::numeric as listing_confidence
  from public.product_match_features f
  where not (
    f.supermarket='Lider'
    and exists(
      select 1 from public.product_match_fuzzy_assignments a
      where a.lider_product_id=f.product_id
    )
  )

  union all

  select
    a.target_match_key as match_key,
    f.product_id,
    f.supermarket,
    f.name,
    f.brand,
    f.category,
    f.smart_category,
    f.url,
    f.image_url,
    f.regular_price,
    f.offer_price,
    f.in_stock,
    f.observed_at,
    a.match_method as listing_match_method,
    a.confidence_score as listing_confidence
  from public.product_match_fuzzy_assignments a
  join public.product_match_features f on f.product_id=a.lider_product_id
), ranked as (
  select
    u.*,
    row_number() over(
      partition by match_key,supermarket
      order by in_stock desc,observed_at desc,offer_price asc,product_id
    ) as chain_rank
  from unified u
), dedup as (
  select * from ranked where chain_rank=1
), grouped as (
  select
    match_key,
    (array_agg(name order by case supermarket when 'Jumbo' then 1 when 'Santa Isabel' then 2 else 3 end,observed_at desc))[1] as canonical_name,
    (array_agg(brand order by case supermarket when 'Jumbo' then 1 when 'Santa Isabel' then 2 else 3 end,observed_at desc))[1] as canonical_brand,
    (array_agg(category order by case supermarket when 'Jumbo' then 1 when 'Santa Isabel' then 2 else 3 end,observed_at desc))[1] as category,
    (array_agg(smart_category order by case supermarket when 'Jumbo' then 1 when 'Santa Isabel' then 2 else 3 end,observed_at desc))[1] as smart_category,
    count(*)::integer as listings,
    count(distinct supermarket)::integer as supermarkets,
    min(offer_price) as best_price,
    max(offer_price) as highest_price,
    avg(offer_price)::numeric(14,2) as average_price,
    max(offer_price)-min(offer_price) as price_gap,
    case when max(offer_price)>0 then round((max(offer_price)-min(offer_price))/max(offer_price)*100,1) else 0 end as savings_pct,
    max(observed_at) as last_updated,
    case when bool_and(listing_match_method='exact') then 'exact' else 'hybrid_ai' end as match_method,
    min(listing_confidence)::numeric(6,4) as match_confidence
  from dedup
  group by match_key
  having count(distinct supermarket)>=2
), best as (
  select distinct on (d.match_key)
    d.match_key,
    d.supermarket as best_supermarket,
    d.url as best_url,
    d.image_url,
    d.product_id as best_product_id
  from dedup d
  join grouped g using(match_key)
  order by d.match_key,d.offer_price,d.in_stock desc,d.observed_at desc
), details as (
  select
    d.match_key,
    jsonb_agg(
      jsonb_build_object(
        'id',d.product_id,
        'supermarket',d.supermarket,
        'name',d.name,
        'brand',d.brand,
        'price',d.offer_price,
        'regular_price',d.regular_price,
        'in_stock',d.in_stock,
        'url',d.url,
        'image_url',d.image_url,
        'observed_at',d.observed_at,
        'matchMethod',d.listing_match_method,
        'confidence',d.listing_confidence
      )
      order by case d.supermarket when 'Lider' then 1 when 'Jumbo' then 2 else 3 end
    ) as store_listings
  from dedup d
  join grouped g using(match_key)
  group by d.match_key
)
select
  g.match_key,
  g.canonical_name,
  g.canonical_brand,
  g.category,
  g.smart_category,
  g.listings,
  g.supermarkets,
  g.best_price,
  g.highest_price,
  g.average_price,
  g.price_gap,
  g.savings_pct,
  g.last_updated,
  g.match_method,
  g.match_confidence,
  b.best_supermarket,
  b.best_url,
  b.image_url,
  b.best_product_id,
  d.store_listings
from grouped g
join best b using(match_key)
join details d using(match_key);

create unique index product_match_summary_match_key_idx on public.product_match_summary(match_key);
create index product_match_summary_coverage_gap_idx on public.product_match_summary(supermarkets desc,price_gap desc);
create index product_match_summary_savings_idx on public.product_match_summary(supermarkets desc,savings_pct desc);
create index product_match_summary_method_confidence_idx on public.product_match_summary(match_method,match_confidence desc);
create index product_match_summary_name_trgm_idx on public.product_match_summary using gin(canonical_name gin_trgm_ops);

grant select on public.product_match_summary to anon, authenticated, service_role;
