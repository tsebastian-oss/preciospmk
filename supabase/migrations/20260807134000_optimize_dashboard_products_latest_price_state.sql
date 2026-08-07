create table if not exists public.product_latest_price_state (
  product_id uuid primary key,
  observation_id bigint not null,
  regular_price numeric(12,2),
  offer_price numeric(12,2) not null,
  unit text,
  unit_price numeric(12,2),
  in_stock boolean not null,
  observed_at timestamptz not null,
  crawl_run_id bigint not null,
  updated_at timestamptz not null default now()
);

revoke all on table public.product_latest_price_state from public, anon, authenticated;

insert into public.product_latest_price_state (
  product_id, observation_id, regular_price, offer_price, unit, unit_price,
  in_stock, observed_at, crawl_run_id, updated_at
)
select distinct on (po.product_id)
  po.product_id, po.id, po.regular_price, po.offer_price, po.unit, po.unit_price,
  po.in_stock, po.observed_at, po.crawl_run_id, clock_timestamp()
from public.price_observations po
where po.crawl_run_id is not null
order by po.product_id, po.observed_at desc, po.id desc
on conflict (product_id) do update set
  observation_id = excluded.observation_id,
  regular_price = excluded.regular_price,
  offer_price = excluded.offer_price,
  unit = excluded.unit,
  unit_price = excluded.unit_price,
  in_stock = excluded.in_stock,
  observed_at = excluded.observed_at,
  crawl_run_id = excluded.crawl_run_id,
  updated_at = excluded.updated_at
where excluded.observed_at > product_latest_price_state.observed_at
   or (excluded.observed_at = product_latest_price_state.observed_at and excluded.observation_id > product_latest_price_state.observation_id);

create index if not exists product_latest_price_state_observed_idx
  on public.product_latest_price_state (observed_at desc, product_id);
create index if not exists product_latest_price_state_stock_observed_idx
  on public.product_latest_price_state (in_stock, observed_at desc, product_id);
create index if not exists product_latest_price_state_offer_idx
  on public.product_latest_price_state (offer_price, product_id)
  where offer_price > 0;

create or replace function public.sync_product_latest_price_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.crawl_run_id is null then
    return new;
  end if;

  insert into public.product_latest_price_state (
    product_id, observation_id, regular_price, offer_price, unit, unit_price,
    in_stock, observed_at, crawl_run_id, updated_at
  ) values (
    new.product_id, new.id, new.regular_price, new.offer_price, new.unit, new.unit_price,
    new.in_stock, new.observed_at, new.crawl_run_id, clock_timestamp()
  )
  on conflict (product_id) do update set
    observation_id = excluded.observation_id,
    regular_price = excluded.regular_price,
    offer_price = excluded.offer_price,
    unit = excluded.unit,
    unit_price = excluded.unit_price,
    in_stock = excluded.in_stock,
    observed_at = excluded.observed_at,
    crawl_run_id = excluded.crawl_run_id,
    updated_at = excluded.updated_at
  where excluded.observed_at > product_latest_price_state.observed_at
     or (excluded.observed_at = product_latest_price_state.observed_at and excluded.observation_id > product_latest_price_state.observation_id);

  return new;
end;
$$;

revoke all on function public.sync_product_latest_price_state() from public, anon, authenticated;

drop trigger if exists trg_sync_product_latest_price_state on public.price_observations;
create trigger trg_sync_product_latest_price_state
after insert or update of regular_price, offer_price, unit, unit_price, in_stock, observed_at, crawl_run_id
on public.price_observations
for each row
execute function public.sync_product_latest_price_state();

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
  s.regular_price,
  s.offer_price,
  s.unit,
  s.unit_price,
  s.in_stock,
  s.observed_at,
  greatest(coalesce(s.regular_price, s.offer_price) - s.offer_price, 0::numeric) as savings,
  case
    when s.regular_price is not null and s.regular_price > s.offer_price and s.offer_price > 0
      then round((s.regular_price - s.offer_price) / s.regular_price * 100, 1)
    else 0::numeric
  end as discount_pct,
  p.retailer_type,
  p.industry_slug,
  p.seller,
  p.variant,
  p.smart_category
from public.product_latest_price_state s
join public.products p on p.id = s.product_id
where p.retailer_type = any (array['supermarket'::text, 'department_store'::text, 'pharmacy'::text])
  and coalesce(p.source_metadata ->> 'capture_status', 'accepted') = 'accepted'
  and (p.retailer_type <> 'pharmacy' or s.offer_price > 0);

grant select on public.dashboard_products to authenticated;

analyze public.product_latest_price_state;
