alter table public.products
  add column if not exists retailer_type text not null default 'supermarket',
  add column if not exists seller text,
  add column if not exists seller_id text,
  add column if not exists parent_external_id text,
  add column if not exists variant text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

update public.products
set retailer_type = case
  when supermarket in ('Paris', 'Falabella', 'Ripley') then 'department_store'
  else 'supermarket'
end
where retailer_type is null or retailer_type = '';

alter table public.products drop constraint if exists products_retailer_type_check;
alter table public.products add constraint products_retailer_type_check
  check (retailer_type in ('supermarket', 'department_store'));

create index if not exists products_retailer_type_store_idx
  on public.products(retailer_type, supermarket);
create index if not exists products_seller_idx
  on public.products(supermarket, seller)
  where seller is not null;

alter table public.catalog_crawl_runs
  add column if not exists vertical text not null default 'supermarket',
  add column if not exists configuration jsonb not null default '{}'::jsonb;

alter table public.catalog_crawl_runs drop constraint if exists catalog_crawl_runs_vertical_check;
alter table public.catalog_crawl_runs add constraint catalog_crawl_runs_vertical_check
  check (vertical in ('supermarket', 'department_store'));
create index if not exists catalog_crawl_runs_vertical_status_idx
  on public.catalog_crawl_runs(vertical, status, started_at desc);

alter table public.catalog_crawl_tasks
  add column if not exists vertical text not null default 'supermarket';

update public.catalog_crawl_tasks task
set vertical = run.vertical
from public.catalog_crawl_runs run
where run.id = task.run_id and task.vertical is distinct from run.vertical;

alter table public.catalog_crawl_tasks drop constraint if exists catalog_crawl_tasks_vertical_check;
alter table public.catalog_crawl_tasks add constraint catalog_crawl_tasks_vertical_check
  check (vertical in ('supermarket', 'department_store'));

alter table public.catalog_crawl_tasks drop constraint if exists catalog_crawl_tasks_kind_check;
alter table public.catalog_crawl_tasks add constraint catalog_crawl_tasks_kind_check
  check (kind = any(array[
    'vtex_categories', 'vtex_page', 'sitemap', 'product_page', 'product_batch',
    'lider_listing', 'lider_browse_sitemap', 'lider_siteindex',
    'lider_product_sitemap', 'lider_product_batch', 'lider_product_page',
    'retail_sitemap', 'retail_product_batch', 'retail_product_page'
  ]::text[]));

create index if not exists catalog_crawl_tasks_vertical_queue_idx
  on public.catalog_crawl_tasks(vertical, status, available_at, id);

create table if not exists public.department_store_sources (
  retailer text primary key,
  public_origin text not null,
  robots_url text not null,
  sitemap_url text not null,
  enabled boolean not null default true,
  crawl_delay_ms integer not null default 800 check (crawl_delay_ms between 250 and 15000),
  access_status text not null default 'untested'
    check (access_status in ('untested', 'available', 'partial', 'blocked', 'error')),
  last_discovered_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.department_store_sources enable row level security;
revoke all on public.department_store_sources from public, anon, authenticated;
grant select, insert, update, delete on public.department_store_sources to service_role;

insert into public.department_store_sources(
  retailer, public_origin, robots_url, sitemap_url, crawl_delay_ms, access_status, metadata
) values
  (
    'Paris',
    'https://www.paris.cl',
    'https://www.paris.cl/robots.txt',
    'https://www.paris.cl/sitemap_index.xml',
    700,
    'available',
    jsonb_build_object('discovery', 'public_sitemap', 'product_url_hint', '.html')
  ),
  (
    'Falabella',
    'https://www.falabella.com/falabella-cl',
    'https://www.falabella.com/robots.txt',
    'https://www.falabella.com/static/site/sitemaps/pdp/pdp_cl_FA_COM-index.xml',
    1200,
    'partial',
    jsonb_build_object('discovery', 'public_pdp_sitemap', 'product_url_hint', '/falabella-cl/product/', 'pdp_access', 'cloudflare_validation_required')
  ),
  (
    'Ripley',
    'https://simple.ripley.cl',
    'https://simple.ripley.cl/robots.txt',
    'https://simple.ripley.cl/sitemap_ripley_index.xml',
    1500,
    'partial',
    jsonb_build_object('discovery', 'public_sitemap', 'pdp_access', 'cloudflare_validation_required')
  )
on conflict (retailer) do update set
  public_origin = excluded.public_origin,
  robots_url = excluded.robots_url,
  sitemap_url = excluded.sitemap_url,
  crawl_delay_ms = excluded.crawl_delay_ms,
  metadata = public.department_store_sources.metadata || excluded.metadata,
  updated_at = now();

create or replace function public.start_department_store_crawl_service(
  p_mode text default 'pilot',
  p_retailers text[] default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_run_id bigint;
  v_new_run_id bigint;
  v_mode text := lower(coalesce(p_mode, 'pilot'));
  v_source record;
begin
  if v_mode not in ('pilot', 'full') then
    raise exception 'Invalid department-store crawl mode: %', p_mode using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(824631981);

  update public.catalog_crawl_runs
  set status = 'failed',
      finished_at = now(),
      completion_reason = 'safety_timeout',
      errors = errors || jsonb_build_array('Department-store run exceeded its safety window')
  where vertical = 'department_store'
    and status = 'running'
    and started_at < now() - interval '5 days';

  select id into v_active_run_id
  from public.catalog_crawl_runs
  where vertical = 'department_store' and status = 'running'
  order by started_at desc
  limit 1;

  if v_active_run_id is not null then
    return v_active_run_id;
  end if;

  insert into public.catalog_crawl_runs(
    status, vertical, trigger_type, run_date, configuration
  ) values (
    'running',
    'department_store',
    'manual',
    (now() at time zone 'America/Santiago')::date,
    jsonb_build_object('mode', v_mode, 'retailers', coalesce(to_jsonb(p_retailers), 'null'::jsonb))
  ) returning id into v_new_run_id;

  for v_source in
    select *
    from public.department_store_sources source
    where source.enabled
      and (p_retailers is null or source.retailer = any(p_retailers))
    order by source.retailer
  loop
    insert into public.catalog_crawl_tasks(
      run_id, task_key, supermarket, vertical, kind, payload
    ) values (
      v_new_run_id,
      format('retail-sitemap:%s:%s', lower(v_source.retailer), v_source.sitemap_url),
      v_source.retailer,
      'department_store',
      'retail_sitemap',
      jsonb_build_object(
        'url', v_source.sitemap_url,
        'root_url', v_source.sitemap_url,
        'mode', v_mode,
        'depth', 0,
        'max_depth', 4,
        'max_product_urls', case when v_mode = 'pilot' then 300 else null end,
        'crawl_delay_ms', v_source.crawl_delay_ms
      )
    ) on conflict (run_id, task_key) do nothing;
  end loop;

  update public.catalog_crawl_runs
  set tasks_total = (
    select count(*)::integer from public.catalog_crawl_tasks where run_id = v_new_run_id
  )
  where id = v_new_run_id;

  if not exists (select 1 from public.catalog_crawl_tasks where run_id = v_new_run_id) then
    update public.catalog_crawl_runs
    set status = 'failed', finished_at = now(), completion_reason = 'no_sources'
    where id = v_new_run_id;
    raise exception 'No enabled department-store sources were selected';
  end if;

  return v_new_run_id;
end;
$$;

create or replace function public.enqueue_department_store_tasks_service(
  p_run_id bigint,
  p_tasks jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_inserted integer := 0;
begin
  if not exists (
    select 1 from public.catalog_crawl_runs
    where id = p_run_id and vertical = 'department_store' and status = 'running'
  ) then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    insert into public.catalog_crawl_tasks(
      run_id, task_key, supermarket, vertical, kind, payload
    ) values (
      p_run_id,
      v_item->>'task_key',
      v_item->>'supermarket',
      'department_store',
      v_item->>'kind',
      coalesce(v_item->'payload', '{}'::jsonb)
    ) on conflict (run_id, task_key) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  update public.catalog_crawl_runs
  set tasks_total = (
    select count(*)::integer from public.catalog_crawl_tasks where run_id = p_run_id
  )
  where id = p_run_id;

  return v_inserted;
end;
$$;

create or replace function public.claim_department_store_tasks_service(
  p_limit integer default 3
)
returns table(
  id bigint,
  run_id bigint,
  supermarket text,
  kind text,
  payload jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(824631982);

  update public.catalog_crawl_tasks task
  set status = 'queued',
      claimed_at = null,
      available_at = now(),
      error = coalesce(task.error, 'Recovered after stale department-store worker claim')
  where task.vertical = 'department_store'
    and task.status = 'running'
    and task.claimed_at < now() - interval '15 minutes';

  return query
  with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.vertical = 'department_store'
      and run.status = 'running'
      and task.vertical = 'department_store'
      and task.status = 'queued'
      and task.available_at <= now()
    order by
      case task.kind
        when 'retail_sitemap' then 0
        when 'retail_product_batch' then 1
        else 2
      end,
      task.attempts,
      task.id
    limit greatest(1, least(coalesce(p_limit, 3), 8))
    for update of task skip locked
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running',
        attempts = task.attempts + 1,
        claimed_at = now(),
        error = null
    from selected
    where task.id = selected.id
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.complete_department_store_task_service(
  p_task_id bigint,
  p_products jsonb default '[]'::jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.catalog_crawl_tasks%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_inserted integer := 0;
  v_remaining integer;
  v_failed integer;
  v_final_status text;
begin
  select * into v_task
  from public.catalog_crawl_tasks
  where id = p_task_id and vertical = 'department_store'
  for update;

  if not found then
    raise exception 'Unknown department-store task %', p_task_id using errcode = 'P0002';
  end if;

  if v_task.status <> 'running' then
    return jsonb_build_object('task_id', p_task_id, 'status', v_task.status);
  end if;

  if p_error is null then
    for v_item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
    loop
      insert into public.products(
        supermarket, external_id, name, brand, category, url, image_url,
        retailer_type, seller, seller_id, parent_external_id, variant,
        source_metadata, updated_at
      ) values (
        v_item->>'supermarket',
        v_item->>'external_id',
        v_item->>'name',
        nullif(v_item->>'brand', ''),
        nullif(v_item->>'category', ''),
        v_item->>'url',
        nullif(v_item->>'image_url', ''),
        'department_store',
        nullif(v_item->>'seller', ''),
        nullif(v_item->>'seller_id', ''),
        nullif(v_item->>'parent_external_id', ''),
        nullif(v_item->>'variant', ''),
        coalesce(v_item->'source_metadata', '{}'::jsonb),
        now()
      )
      on conflict (supermarket, external_id) do update set
        name = excluded.name,
        brand = excluded.brand,
        category = excluded.category,
        url = excluded.url,
        image_url = excluded.image_url,
        retailer_type = 'department_store',
        seller = excluded.seller,
        seller_id = excluded.seller_id,
        parent_external_id = excluded.parent_external_id,
        variant = excluded.variant,
        source_metadata = public.products.source_metadata || excluded.source_metadata,
        updated_at = now()
      returning id into v_product_id;

      insert into public.price_observations(
        product_id, regular_price, offer_price, unit, unit_price,
        in_stock, observed_at, crawl_run_id
      ) values (
        v_product_id,
        nullif(v_item->>'regular_price', '')::numeric,
        coalesce(nullif(v_item->>'offer_price', '')::numeric, 0),
        nullif(v_item->>'unit', ''),
        nullif(v_item->>'unit_price', '')::numeric,
        coalesce((v_item->>'in_stock')::boolean, false),
        coalesce((v_item->>'observed_at')::timestamptz, now()),
        v_task.run_id
      )
      on conflict (product_id, crawl_run_id) where crawl_run_id is not null
      do update set
        regular_price = excluded.regular_price,
        offer_price = excluded.offer_price,
        unit = excluded.unit,
        unit_price = excluded.unit_price,
        in_stock = excluded.in_stock,
        observed_at = excluded.observed_at;

      v_inserted := v_inserted + 1;
    end loop;

    update public.catalog_crawl_tasks
    set status = 'completed', finished_at = now(), products_found = v_inserted, error = null
    where id = p_task_id;

    update public.department_store_sources
    set last_success_at = case when v_inserted > 0 then now() else last_success_at end,
        last_discovered_at = case when v_task.kind = 'retail_sitemap' then now() else last_discovered_at end,
        access_status = case when v_inserted > 0 then 'available' else access_status end,
        updated_at = now()
    where retailer = v_task.supermarket;
  elsif v_task.attempts < 2 then
    update public.catalog_crawl_tasks
    set status = 'queued', claimed_at = null,
        available_at = now() + make_interval(mins => greatest(2, v_task.attempts * 5)),
        error = left(p_error, 4000)
    where id = p_task_id;
  else
    update public.catalog_crawl_tasks
    set status = 'failed', finished_at = now(), error = left(p_error, 4000)
    where id = p_task_id;

    update public.department_store_sources
    set last_error_at = now(),
        last_error = left(p_error, 4000),
        access_status = case when lower(p_error) like '%http 403%' or lower(p_error) like '%blocked%' then 'blocked' else 'error' end,
        updated_at = now()
    where retailer = v_task.supermarket;
  end if;

  select count(*)::integer into v_remaining
  from public.catalog_crawl_tasks
  where run_id = v_task.run_id and status in ('queued', 'running');

  select count(*)::integer into v_failed
  from public.catalog_crawl_tasks
  where run_id = v_task.run_id and status = 'failed';

  update public.catalog_crawl_runs run
  set tasks_total = stats.tasks_total,
      tasks_completed = stats.tasks_completed,
      tasks_failed = stats.tasks_failed,
      products_found = stats.products_found,
      source_counts = stats.source_counts,
      errors = stats.errors
  from (
    select
      (select count(*)::integer from public.catalog_crawl_tasks where run_id = v_task.run_id) tasks_total,
      (select count(*)::integer from public.catalog_crawl_tasks where run_id = v_task.run_id and status = 'completed') tasks_completed,
      (select count(*)::integer from public.catalog_crawl_tasks where run_id = v_task.run_id and status = 'failed') tasks_failed,
      (select count(distinct observation.product_id)::integer
       from public.price_observations observation
       where observation.crawl_run_id = v_task.run_id) products_found,
      coalesce((
        select jsonb_object_agg(grouped.supermarket, grouped.product_count)
        from (
          select product.supermarket, count(distinct observation.product_id)::integer product_count
          from public.price_observations observation
          join public.products product on product.id = observation.product_id
          where observation.crawl_run_id = v_task.run_id
          group by product.supermarket
        ) grouped
      ), '{}'::jsonb) source_counts,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'task_id', task.id,
          'retailer', task.supermarket,
          'kind', task.kind,
          'error', task.error
        ) order by task.id)
        from public.catalog_crawl_tasks task
        where task.run_id = v_task.run_id and task.status = 'failed'
      ), '[]'::jsonb) errors
  ) stats
  where run.id = v_task.run_id;

  if v_remaining = 0 then
    v_final_status := case when v_failed = 0 then 'completed' else 'completed_with_errors' end;
    update public.catalog_crawl_runs
    set status = v_final_status,
        finished_at = now(),
        completion_reason = case when v_failed = 0 then 'queue_completed' else 'queue_completed_with_errors' end
    where id = v_task.run_id and status = 'running';
  end if;

  return jsonb_build_object(
    'task_id', p_task_id,
    'run_id', v_task.run_id,
    'products_processed', v_inserted,
    'remaining_tasks', v_remaining,
    'failed_tasks', v_failed
  );
end;
$$;

create or replace function public.department_store_crawl_status_service(
  p_run_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.catalog_crawl_runs%rowtype;
begin
  if p_run_id is null then
    select * into v_run
    from public.catalog_crawl_runs
    where vertical = 'department_store'
    order by started_at desc
    limit 1;
  else
    select * into v_run
    from public.catalog_crawl_runs
    where id = p_run_id and vertical = 'department_store';
  end if;

  if not found then
    return jsonb_build_object(
      'status', 'not_started',
      'vertical', 'department_store',
      'sources', (
        select coalesce(jsonb_agg(to_jsonb(source) order by source.retailer), '[]'::jsonb)
        from public.department_store_sources source
      )
    );
  end if;

  return to_jsonb(v_run) || jsonb_build_object(
    'queued_tasks', (select count(*) from public.catalog_crawl_tasks where run_id = v_run.id and status = 'queued'),
    'running_tasks', (select count(*) from public.catalog_crawl_tasks where run_id = v_run.id and status = 'running'),
    'sources', (
      select coalesce(jsonb_agg(to_jsonb(source) order by source.retailer), '[]'::jsonb)
      from public.department_store_sources source
    )
  );
end;
$$;

revoke all on function public.start_department_store_crawl_service(text, text[]) from public, anon, authenticated;
revoke all on function public.enqueue_department_store_tasks_service(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.claim_department_store_tasks_service(integer) from public, anon, authenticated;
revoke all on function public.complete_department_store_task_service(bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.department_store_crawl_status_service(bigint) from public, anon, authenticated;

grant execute on function public.start_department_store_crawl_service(text, text[]) to service_role;
grant execute on function public.enqueue_department_store_tasks_service(bigint, jsonb) to service_role;
grant execute on function public.claim_department_store_tasks_service(integer) to service_role;
grant execute on function public.complete_department_store_task_service(bigint, jsonb, text) to service_role;
grant execute on function public.department_store_crawl_status_service(bigint) to service_role;

create or replace view public.department_store_latest_prices
with (security_invoker = true)
as
select distinct on (p.id)
  p.id,
  p.supermarket as retailer,
  p.external_id,
  p.parent_external_id,
  p.name,
  p.brand,
  p.category,
  p.seller,
  p.seller_id,
  p.variant,
  p.url,
  p.image_url,
  o.regular_price,
  o.offer_price,
  o.in_stock,
  o.observed_at,
  p.source_metadata
from public.products p
join public.price_observations o on o.product_id = p.id
where p.retailer_type = 'department_store'
order by p.id, o.observed_at desc, o.id desc;

revoke all on public.department_store_latest_prices from public, anon, authenticated;
grant select on public.department_store_latest_prices to service_role;
