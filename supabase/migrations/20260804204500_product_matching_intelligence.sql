create or replace function public.normalize_product_match_key(input_text text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(translate(coalesce(input_text, ''),
        'áéíóúüñÁÉÍÓÚÜÑ',
        'aeiouunAEIOUUN')),
      '\m(pack|paq|unidad|unidades|un|gr|kg|ml|cc|lt)\M',
      ' ', 'g'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

create or replace view public.product_matching_listings
with (security_invoker = true)
as
select
  p.id, p.supermarket, p.external_id, p.name, p.brand, p.category,
  p.url, p.image_url, p.regular_price, p.offer_price, p.unit,
  p.unit_price, p.in_stock, p.observed_at, p.savings, p.discount_pct,
  public.normalize_product_match_key(coalesce(p.brand, '') || ' ' || p.name) as match_key
from public.dashboard_products p
where p.offer_price > 0
  and length(public.normalize_product_match_key(coalesce(p.brand, '') || ' ' || p.name)) >= 8;

create materialized view public.product_match_summary as
with grouped as (
  select
    match_key,
    min(name) as canonical_name,
    min(brand) filter (where brand is not null and brand <> '') as canonical_brand,
    min(category) filter (where category is not null and category <> '') as category,
    count(*)::integer as listings,
    count(distinct supermarket)::integer as supermarkets,
    min(offer_price) as best_price,
    max(offer_price) as highest_price,
    avg(offer_price)::numeric(14,2) as average_price,
    max(offer_price) - min(offer_price) as price_gap,
    case when max(offer_price) > 0
      then round(((max(offer_price) - min(offer_price)) / max(offer_price) * 100)::numeric, 1)
      else 0::numeric
    end as savings_pct,
    max(observed_at) as last_updated
  from public.product_matching_listings
  group by match_key
  having count(distinct supermarket) >= 2
), best as (
  select distinct on (l.match_key)
    l.match_key,
    l.supermarket as best_supermarket,
    l.url as best_url,
    l.image_url,
    l.id as best_product_id
  from public.product_matching_listings l
  join grouped g using (match_key)
  order by l.match_key, l.offer_price asc, l.in_stock desc, l.observed_at desc
), details as (
  select
    l.match_key,
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'supermarket', l.supermarket,
        'name', l.name,
        'brand', l.brand,
        'price', l.offer_price,
        'regular_price', l.regular_price,
        'in_stock', l.in_stock,
        'url', l.url,
        'image_url', l.image_url,
        'observed_at', l.observed_at
      ) order by l.offer_price asc, l.supermarket asc
    ) as store_listings
  from public.product_matching_listings l
  join grouped g using (match_key)
  group by l.match_key
)
select g.*, b.best_supermarket, b.best_url, b.image_url, b.best_product_id, d.store_listings
from grouped g
join best b using (match_key)
join details d using (match_key)
with data;

create unique index product_match_summary_match_key_idx on public.product_match_summary(match_key);
create index product_match_summary_gap_idx on public.product_match_summary(price_gap desc);
create index product_match_summary_savings_idx on public.product_match_summary(savings_pct desc);
create index product_match_summary_name_trgm_idx on public.product_match_summary using gin (canonical_name gin_trgm_ops);
create index if not exists products_normalized_match_key_idx
on public.products (public.normalize_product_match_key(coalesce(brand, '') || ' ' || name));

grant select on public.product_matching_listings to anon, authenticated;
grant select on public.product_match_summary to anon, authenticated;
revoke all on function public.normalize_product_match_key(text) from public;
grant execute on function public.normalize_product_match_key(text) to anon, authenticated, service_role;

select cron.schedule(
  'refresh-product-match-summary',
  '*/15 * * * *',
  $$refresh materialized view concurrently public.product_match_summary$$
)
where not exists (select 1 from cron.job where jobname = 'refresh-product-match-summary');
