create or replace function public.start_scrape_service()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_id bigint;
begin
  perform pg_advisory_xact_lock(824631970);

  if exists (
    select 1
    from public.scrape_runs
    where started_at > now() - interval '15 minutes'
  ) then
    raise exception 'A scraping run started recently' using errcode = 'P0001';
  end if;

  insert into public.scrape_runs(started_at, finished_at, products_found, errors)
  values (now(), null, 0, '["running"]'::jsonb)
  returning id into run_id;

  return run_id;
end;
$$;

revoke all on function public.start_scrape_service() from public, anon, authenticated;
grant execute on function public.start_scrape_service() to service_role;

create or replace function public.finish_scrape_service(
  p_run_id bigint,
  p_products jsonb,
  p_errors jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  item jsonb;
  product_uuid uuid;
  inserted_count integer := 0;
begin
  if not exists (
    select 1 from public.scrape_runs
    where id = p_run_id and finished_at is null
  ) then
    raise exception 'Invalid or already completed scrape run' using errcode = 'P0001';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
  loop
    insert into public.products (
      supermarket, external_id, name, brand, category, url, image_url, updated_at
    ) values (
      item->>'supermarket', item->>'external_id', item->>'name',
      nullif(item->>'brand', ''), nullif(item->>'category', ''),
      item->>'url', nullif(item->>'image_url', ''), now()
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

  update public.scrape_runs
  set finished_at = now(), products_found = inserted_count,
      errors = coalesce(p_errors, '[]'::jsonb)
  where id = p_run_id;

  return jsonb_build_object('run_id', p_run_id, 'products_found', inserted_count);
end;
$$;

revoke all on function public.finish_scrape_service(bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finish_scrape_service(bigint, jsonb, jsonb) to service_role;
