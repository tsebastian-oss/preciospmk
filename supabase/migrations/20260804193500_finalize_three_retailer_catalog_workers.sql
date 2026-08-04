alter table public.catalog_crawl_tasks
  drop constraint if exists catalog_crawl_tasks_kind_check;

alter table public.catalog_crawl_tasks
  add constraint catalog_crawl_tasks_kind_check
  check (kind in (
    'vtex_categories',
    'vtex_page',
    'sitemap',
    'product_page',
    'product_batch',
    'lider_listing',
    'lider_browse_sitemap',
    'lider_siteindex',
    'lider_product_sitemap',
    'lider_product_batch',
    'lider_product_page'
  ));

create or replace function public.claim_catalog_tasks_service(p_limit integer default 8)
returns table (
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
  perform pg_advisory_xact_lock(824631972);

  update public.catalog_crawl_tasks as stale_task
  set status = 'queued',
      claimed_at = null,
      available_at = now(),
      error = coalesce(stale_task.error, 'Recovered after a stale retailer worker claim')
  where stale_task.status = 'running'
    and stale_task.supermarket <> 'Lider'
    and stale_task.claimed_at < now() - interval '12 minutes';

  return query
  with ranked as (
    select
      task.id,
      row_number() over (
        partition by task.supermarket
        order by
          case when task.kind = 'vtex_categories' then 0 else 1 end,
          task.id
      ) as supermarket_rank
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.status = 'running'
      and task.supermarket <> 'Lider'
      and task.status = 'queued'
      and task.available_at <= now()
  ), selected as (
    select ranked.id
    from ranked
    order by ranked.supermarket_rank, ranked.id
    limit greatest(1, least(coalesce(p_limit, 8), 24))
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running',
        attempts = task.attempts + 1,
        claimed_at = now(),
        error = null
    from selected
    where task.id = selected.id
      and task.status = 'queued'
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.claim_lider_catalog_tasks_service(p_limit integer default 2)
returns table (
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
  perform pg_advisory_xact_lock(824631973);

  update public.catalog_crawl_tasks as stale_task
  set status = 'queued',
      claimed_at = null,
      available_at = now(),
      error = coalesce(stale_task.error, 'Recovered after a stale Lider product worker claim')
  where stale_task.status = 'running'
    and stale_task.supermarket = 'Lider'
    and stale_task.kind in (
      'lider_siteindex',
      'lider_product_sitemap',
      'lider_product_batch',
      'lider_product_page'
    )
    and stale_task.claimed_at < now() - interval '12 minutes';

  return query
  with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.status = 'running'
      and task.supermarket = 'Lider'
      and task.kind in (
        'lider_siteindex',
        'lider_product_sitemap',
        'lider_product_batch',
        'lider_product_page'
      )
      and task.status = 'queued'
      and task.available_at <= now()
    order by
      case task.kind
        when 'lider_siteindex' then 0
        when 'lider_product_sitemap' then 1
        when 'lider_product_page' then 2
        when 'lider_product_batch' then 3
        else 9
      end,
      task.id
    limit greatest(1, least(coalesce(p_limit, 2), 8))
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running',
        attempts = task.attempts + 1,
        claimed_at = now(),
        error = null
    from selected
    where task.id = selected.id
      and task.status = 'queued'
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.claim_lider_discovery_tasks_service(p_limit integer default 2)
returns table (
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
  perform pg_advisory_xact_lock(824631974);

  update public.catalog_crawl_tasks as stale_task
  set status = 'queued',
      claimed_at = null,
      available_at = now(),
      error = coalesce(stale_task.error, 'Recovered after a stale Lider discovery claim')
  where stale_task.status = 'running'
    and stale_task.supermarket = 'Lider'
    and stale_task.kind in ('lider_browse_sitemap', 'lider_listing')
    and stale_task.claimed_at < now() - interval '12 minutes';

  return query
  with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.status = 'running'
      and task.supermarket = 'Lider'
      and task.kind in ('lider_browse_sitemap', 'lider_listing')
      and task.status = 'queued'
      and task.available_at <= now()
    order by
      case task.kind
        when 'lider_browse_sitemap' then 0
        when 'lider_listing' then 1
        else 9
      end,
      task.id
    limit greatest(1, least(coalesce(p_limit, 2), 6))
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running',
        attempts = task.attempts + 1,
        claimed_at = now(),
        error = null
    from selected
    where task.id = selected.id
      and task.status = 'queued'
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;

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
      errors = errors || jsonb_build_array('Run exceeded the seven-day safety window')
  where status = 'running'
    and started_at < now() - interval '7 days';

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
    (
      new_run_id,
      'vtex-categories:jumbo',
      'Jumbo',
      'vtex_categories',
      jsonb_build_object(
        'base_url', 'https://jumbo.vtexcommercestable.com.br',
        'public_origin', 'https://www.jumbo.cl'
      )
    ),
    (
      new_run_id,
      'vtex-categories:santa-isabel',
      'Santa Isabel',
      'vtex_categories',
      jsonb_build_object(
        'base_url', 'https://santaisabel.vtexcommercestable.com.br',
        'public_origin', 'https://www.santaisabel.cl'
      )
    ),
    (
      new_run_id,
      'lider-product-sitemap:https://super.lider.cl/productSitemap.xml',
      'Lider',
      'lider_product_sitemap',
      jsonb_build_object('url', 'https://super.lider.cl/productSitemap.xml')
    ),
    (
      new_run_id,
      'lider-browse-sitemap:https://super.lider.cl/browseshelfSitemap.xml',
      'Lider',
      'lider_browse_sitemap',
      jsonb_build_object('url', 'https://super.lider.cl/browseshelfSitemap.xml')
    )
  on conflict (run_id, task_key) do nothing;

  update public.catalog_crawl_runs
  set tasks_total = (
    select count(*)::integer
    from public.catalog_crawl_tasks
    where run_id = new_run_id
  )
  where id = new_run_id;

  return new_run_id;
end;
$$;

revoke all on function public.claim_catalog_tasks_service(integer) from public, anon, authenticated;
revoke all on function public.claim_lider_catalog_tasks_service(integer) from public, anon, authenticated;
revoke all on function public.claim_lider_discovery_tasks_service(integer) from public, anon, authenticated;
revoke all on function public.start_catalog_crawl_service() from public, anon, authenticated;
grant execute on function public.claim_catalog_tasks_service(integer) to service_role;
grant execute on function public.claim_lider_catalog_tasks_service(integer) to service_role;
grant execute on function public.claim_lider_discovery_tasks_service(integer) to service_role;
grant execute on function public.start_catalog_crawl_service() to service_role;

do $$
declare
  job_record record;
begin
  for job_record in
    select jobid
    from cron.job
    where jobname in (
      'catalog-crawl-worker-every-10-seconds',
      'lider-crawl-worker-every-10-seconds',
      'lider-discovery-worker-every-10-seconds'
    )
  loop
    perform cron.unschedule(job_record.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'catalog-crawl-worker-every-10-seconds',
  '10 seconds',
  $cron$
    select net.http_post(
      url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/catalog-crawl-worker',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $cron$
);

select cron.schedule(
  'lider-crawl-worker-every-10-seconds',
  '10 seconds',
  $cron$
    select net.http_post(
      url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/lider-crawl-worker',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $cron$
);

select cron.schedule(
  'lider-discovery-worker-every-10-seconds',
  '10 seconds',
  $cron$
    select net.http_post(
      url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/lider-discovery-worker',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $cron$
);