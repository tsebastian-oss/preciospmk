create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secrets (
  name text primary key,
  secret_hash text not null,
  created_at timestamptz not null default now()
);

insert into private.app_secrets(name, secret_hash)
values ('scrape_ingest', 'c8a652c05c694772d7d544814241dd03d678a6cd20131a039bf9d0fa01a6b53a')
on conflict (name) do update set secret_hash = excluded.secret_hash;

create or replace function private.check_app_secret(p_name text, p_secret text)
returns boolean
language sql
stable
security definer
set search_path = private, extensions, pg_temp
as $$
  select exists (
    select 1
    from private.app_secrets
    where name = p_name
      and secret_hash = encode(digest(p_secret, 'sha256'), 'hex')
  );
$$;

revoke all on function private.check_app_secret(text, text) from public, anon, authenticated;

create or replace function public.scrape_status(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
begin
  if not private.check_app_secret('scrape_ingest', p_secret) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  return not exists (
    select 1
    from public.scrape_runs
    where finished_at > now() - interval '15 minutes'
  );
end;
$$;

create or replace function public.ingest_scrape(
  p_secret text,
  p_started_at timestamptz,
  p_products jsonb,
  p_errors jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  item jsonb;
  product_uuid uuid;
  inserted_count integer := 0;
begin
  if not private.check_app_secret('scrape_ingest', p_secret) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
  loop
    insert into public.products (
      supermarket, external_id, name, brand, category, url, image_url, updated_at
    ) values (
      item->>'supermarket',
      item->>'external_id',
      item->>'name',
      nullif(item->>'brand', ''),
      nullif(item->>'category', ''),
      item->>'url',
      nullif(item->>'image_url', ''),
      now()
    )
    on conflict (supermarket, external_id) do update set
      name = excluded.name,
      brand = excluded.brand,
      category = excluded.category,
      url = excluded.url,
      image_url = excluded.image_url,
      updated_at = now()
    returning id into product_uuid;

    insert into public.price_observations (
      product_id, regular_price, offer_price, unit, unit_price, in_stock, observed_at
    ) values (
      product_uuid,
      nullif(item->>'regular_price', '')::numeric,
      (item->>'offer_price')::numeric,
      nullif(item->>'unit', ''),
      nullif(item->>'unit_price', '')::numeric,
      coalesce((item->>'in_stock')::boolean, true),
      coalesce((item->>'observed_at')::timestamptz, now())
    );

    inserted_count := inserted_count + 1;
  end loop;

  insert into public.scrape_runs(started_at, finished_at, products_found, errors)
  values (p_started_at, now(), inserted_count, coalesce(p_errors, '[]'::jsonb));

  return jsonb_build_object('products_found', inserted_count);
end;
$$;

revoke all on function public.scrape_status(text) from public;
revoke all on function public.ingest_scrape(text, timestamptz, jsonb, jsonb) from public;
grant execute on function public.scrape_status(text) to anon, authenticated;
grant execute on function public.ingest_scrape(text, timestamptz, jsonb, jsonb) to anon, authenticated;
