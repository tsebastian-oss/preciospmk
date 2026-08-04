create extension if not exists pg_trgm;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  supermarket text not null,
  external_id text not null,
  name text not null,
  brand text,
  category text,
  url text not null,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(supermarket, external_id)
);

create table public.price_observations (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  regular_price numeric(12,2),
  offer_price numeric(12,2) not null check (offer_price >= 0),
  unit text,
  unit_price numeric(12,2),
  in_stock boolean not null default true,
  observed_at timestamptz not null default now()
);

create table public.scrape_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  products_found integer not null default 0,
  errors jsonb not null default '[]'::jsonb
);

create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create index price_observations_product_time_idx on public.price_observations(product_id, observed_at desc);

create view public.latest_prices with (security_invoker = true) as
select distinct on (p.id)
  p.id, p.supermarket, p.external_id, p.name, p.brand, p.category, p.url, p.image_url,
  o.regular_price, o.offer_price, o.unit, o.unit_price, o.in_stock, o.observed_at
from public.products p
join public.price_observations o on o.product_id = p.id
order by p.id, o.observed_at desc;

alter table public.products enable row level security;
alter table public.price_observations enable row level security;
alter table public.scrape_runs enable row level security;

create policy "Public read products" on public.products for select to anon, authenticated using (true);
create policy "Public read prices" on public.price_observations for select to anon, authenticated using (true);
create policy "Public read scrape runs" on public.scrape_runs for select to authenticated using (true);

grant select on public.products, public.price_observations, public.latest_prices to anon, authenticated;
revoke all on public.scrape_runs from anon;
grant select on public.scrape_runs to authenticated;
