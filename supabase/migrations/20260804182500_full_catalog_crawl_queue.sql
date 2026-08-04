create table if not exists public.catalog_crawl_runs (
  id bigint generated always as identity primary key,
  status text not null default 'running'
    check (status in ('running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tasks_total integer not null default 0,
  tasks_completed integer not null default 0,
  tasks_failed integer not null default 0,
  products_found integer not null default 0,
  source_counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_crawl_tasks (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.catalog_crawl_runs(id) on delete cascade,
  task_key text not null,
  supermarket text not null,
  kind text not null check (kind in ('vtex_categories', 'vtex_page', 'sitemap', 'product_page')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  products_found integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  unique (run_id, task_key)
);

create index if not exists catalog_crawl_tasks_claim_idx
  on public.catalog_crawl_tasks (run_id, status, available_at, id);
create index if not exists catalog_crawl_tasks_stale_idx
  on public.catalog_crawl_tasks (status, claimed_at)
  where status = 'running';

alter table public.price_observations
  add column if not exists crawl_run_id bigint references public.catalog_crawl_runs(id) on delete set null;

create unique index if not exists price_observations_product_crawl_run_uidx
  on public.price_observations(product_id, crawl_run_id)
  where crawl_run_id is not null;

alter table public.catalog_crawl_runs enable row level security;
alter table public.catalog_crawl_tasks enable row level security;

revoke all on public.catalog_crawl_runs from public, anon, authenticated;
revoke all on public.catalog_crawl_tasks from public, anon, authenticated;
grant select on public.catalog_crawl_runs to anon, authenticated;

create policy "Public read catalog crawl runs"
  on public.catalog_crawl_runs
  for select
  to anon, authenticated
  using (true);

create or replace function public.start_catalog_crawl_service()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_run_id bigint;
  new_run_id bigint;
begin
  perform pg_advisory_xact_lock(824631971);

  update public.catalog_crawl_runs
  set status = 'failed',
      finished_at = now(),
      errors = errors || jsonb_build_array('Run exceeded the four-hour safety window')
  where status = 'running'
    and started_at < now() - interval '4 hours';

  select id into active_run_id
  from public.catalog_crawl_runs
  where status = 'running'
  order by started_at desc
  limit 1;

  if active_run_id is not null then
    return active_run_id;
  end if;

  insert into public.catalog_crawl_runs(status)
  values ('running')
  returning id into new_run_id;

  insert into public.catalog_crawl_tasks(run_id, task_key, supermarket, kind, payload)
  values
    (new_run_id, 'vtex-categories:jumbo', 'Jumbo', 'vtex_categories',
      jsonb_build_object('base_url', 'https://jumbo.vtexcommercestable.com.br', 'public_origin', 'https://www.jumbo.cl')),
    (new_run_id, 'vtex-categories:santa-isabel', 'Santa Isabel', 'vtex_categories',
      jsonb_build_object('base_url', 'https://santaisabel.vtexcommercestable.com.br', 'public_origin', 'https://www.santaisabel.cl')),
    (new_run_id, 'sitemap:https://super.lider.cl/siteindex.xml', 'Lider', 'sitemap',
      jsonb_build_object('url', 'https://super.lider.cl/siteindex.xml')),
    (new_run_id, 'sitemap:https://super.lider.cl/v/nc/sitemap/sitemap.xml', 'Lider', 'sitemap',
      jsonb_build_object('url', 'https://super.lider.cl/v/nc/sitemap/sitemap.xml')),
    (new_run_id, 'sitemap:https://www.lider.cl/statics.xml', 'Lider', 'sitemap',
      jsonb_build_object('url', 'https://www.lider.cl/statics.xml'))
  on conflict (run_id, task_key) do nothing;

  update public.catalog_crawl_runs
  set tasks_total = (select count(*)::integer from public.catalog_crawl_tasks where run_id = new_run_id)
  where id = new_run_id;

  return new_run_id;
end;
$$;

create or replace function public.claim_catalog_tasks_service(p_limit integer default 8)
returns table (id bigint, run_id bigint, supermarket text, kind text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.catalog_crawl_tasks
  set status = 'queued', claimed_at = null, available_at = now(),
      error = coalesce(error, 'Recovered after a stale worker claim')
  where status = 'running' and claimed_at < now() - interval '12 minutes';

  return query
  with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.status = 'running' and task.status = 'queued' and task.available_at <= now()
    order by task.id
    for update of task skip locked
    limit greatest(1, least(coalesce(p_limit, 8), 24))
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running', attempts = task.attempts + 1, claimed_at = now(), error = null
    from selected
    where task.id = selected.id
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed;
end;
$$;

create or replace function public.enqueue_catalog_tasks_service(p_run_id bigint, p_tasks jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  inserted_count integer := 0;
begin
  if not exists (select 1 from public.catalog_crawl_runs where id = p_run_id and status = 'running') then
    return 0;
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    insert into public.catalog_crawl_tasks(run_id, task_key, supermarket, kind, payload)
    values (p_run_id, item->>'task_key', item->>'supermarket', item->>'kind', coalesce(item->'payload', '{}'::jsonb))
    on conflict (run_id, task_key) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;

  update public.catalog_crawl_runs
  set tasks_total = (select count(*)::integer from public.catalog_crawl_tasks where run_id = p_run_id)
  where id = p_run_id;
  return inserted_count;
end;
$$;

create or replace function public.complete_catalog_task_service(
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
  task_record public.catalog_crawl_tasks%rowtype;
  item jsonb;
  product_uuid uuid;
  inserted_count integer := 0;
  remaining_count integer;
  failed_count integer;
  final_status text;
begin
  select * into task_record from public.catalog_crawl_tasks where id = p_task_id for update;
  if not found then raise exception 'Unknown catalog task %', p_task_id using errcode = 'P0002'; end if;
  if task_record.status <> 'running' then return jsonb_build_object('task_id', p_task_id, 'status', task_record.status); end if;

  if p_error is null then
    for item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
      insert into public.products(supermarket, external_id, name, brand, category, url, image_url, updated_at)
      values (item->>'supermarket', item->>'external_id', item->>'name', nullif(item->>'brand', ''),
        nullif(item->>'category', ''), item->>'url', nullif(item->>'image_url', ''), now())
      on conflict (supermarket, external_id) do update set
        name = excluded.name, brand = excluded.brand, category = excluded.category,
        url = excluded.url, image_url = excluded.image_url, updated_at = now()
      returning id into product_uuid;

      insert into public.price_observations(
        product_id, regular_price, offer_price, unit, unit_price, in_stock, observed_at, crawl_run_id
      ) values (
        product_uuid, nullif(item->>'regular_price', '')::numeric,
        coalesce(nullif(item->>'offer_price', '')::numeric, 0), nullif(item->>'unit', ''),
        nullif(item->>'unit_price', '')::numeric, coalesce((item->>'in_stock')::boolean, false),
        coalesce((item->>'observed_at')::timestamptz, now()), task_record.run_id
      )
      on conflict (product_id, crawl_run_id) where crawl_run_id is not null
      do update set regular_price = excluded.regular_price, offer_price = excluded.offer_price,
        unit = excluded.unit, unit_price = excluded.unit_price, in_stock = excluded.in_stock,
        observed_at = excluded.observed_at;
      inserted_count := inserted_count + 1;
    end loop;

    update public.catalog_crawl_tasks
    set status = 'completed', finished_at = now(), products_found = inserted_count, error = null
    where id = p_task_id;
  elsif task_record.attempts < 3 then
    update public.catalog_crawl_tasks
    set status = 'queued', claimed_at = null,
        available_at = now() + make_interval(mins => greatest(1, task_record.attempts * 2)),
        error = left(p_error, 4000)
    where id = p_task_id;
  else
    update public.catalog_crawl_tasks
    set status = 'failed', finished_at = now(), error = left(p_error, 4000)
    where id = p_task_id;
  end if;

  select count(*)::integer into remaining_count from public.catalog_crawl_tasks
  where run_id = task_record.run_id and status in ('queued', 'running');
  select count(*)::integer into failed_count from public.catalog_crawl_tasks
  where run_id = task_record.run_id and status = 'failed';

  update public.catalog_crawl_runs run
  set tasks_total = stats.tasks_total, tasks_completed = stats.tasks_completed,
      tasks_failed = stats.tasks_failed, products_found = stats.products_found,
      source_counts = stats.source_counts, errors = stats.errors
  from (
    select
      (select count(*)::integer from public.catalog_crawl_tasks where run_id = task_record.run_id) tasks_total,
      (select count(*)::integer from public.catalog_crawl_tasks where run_id = task_record.run_id and status = 'completed') tasks_completed,
      (select count(*)::integer from public.catalog_crawl_tasks where run_id = task_record.run_id and status = 'failed') tasks_failed,
      (select count(distinct observation.product_id)::integer from public.price_observations observation where observation.crawl_run_id = task_record.run_id) products_found,
      coalesce((select jsonb_object_agg(grouped.supermarket, grouped.product_count) from (
        select product.supermarket, count(distinct observation.product_id)::integer product_count
        from public.price_observations observation join public.products product on product.id = observation.product_id
        where observation.crawl_run_id = task_record.run_id group by product.supermarket
      ) grouped), '{}'::jsonb) source_counts,
      coalesce((select jsonb_agg(jsonb_build_object('task_id', task.id, 'supermarket', task.supermarket,
        'kind', task.kind, 'error', task.error) order by task.id)
        from public.catalog_crawl_tasks task where task.run_id = task_record.run_id and task.status = 'failed'), '[]'::jsonb) errors
  ) stats
  where run.id = task_record.run_id;

  if remaining_count = 0 then
    final_status := case when failed_count = 0 then 'completed' else 'completed_with_errors' end;
    update public.catalog_crawl_runs set status = final_status, finished_at = now()
    where id = task_record.run_id and status = 'running';
  end if;

  return jsonb_build_object('task_id', p_task_id, 'run_id', task_record.run_id,
    'products_processed', inserted_count, 'remaining_tasks', remaining_count, 'failed_tasks', failed_count);
end;
$$;

create or replace function public.catalog_crawl_status_service(p_run_id bigint default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(to_jsonb(run_row), '{}'::jsonb)
  from (
    select run.id, run.status, run.started_at, run.finished_at, run.tasks_total,
      run.tasks_completed, run.tasks_failed, run.products_found, run.source_counts, run.errors
    from public.catalog_crawl_runs run
    where p_run_id is null or run.id = p_run_id
    order by run.id desc limit 1
  ) run_row;
$$;

revoke all on function public.start_catalog_crawl_service() from public, anon, authenticated;
revoke all on function public.claim_catalog_tasks_service(integer) from public, anon, authenticated;
revoke all on function public.enqueue_catalog_tasks_service(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.complete_catalog_task_service(bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.catalog_crawl_status_service(bigint) from public, anon, authenticated;
grant execute on function public.start_catalog_crawl_service() to service_role;
grant execute on function public.claim_catalog_tasks_service(integer) to service_role;
grant execute on function public.enqueue_catalog_tasks_service(bigint, jsonb) to service_role;
grant execute on function public.complete_catalog_task_service(bigint, jsonb, text) to service_role;
grant execute on function public.catalog_crawl_status_service(bigint) to service_role;
