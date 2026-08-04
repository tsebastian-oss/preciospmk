alter table public.catalog_crawl_tasks
  drop constraint if exists catalog_crawl_tasks_kind_check;

alter table public.catalog_crawl_tasks
  add constraint catalog_crawl_tasks_kind_check
  check (kind in ('vtex_categories', 'vtex_page', 'sitemap', 'product_page', 'product_batch'));

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
  set status = 'failed', finished_at = now(),
      errors = errors || jsonb_build_array('Run exceeded the twelve-hour safety window')
  where status = 'running' and started_at < now() - interval '12 hours';

  select id into active_run_id
  from public.catalog_crawl_runs
  where status = 'running'
  order by started_at desc
  limit 1;

  if active_run_id is not null then return active_run_id; end if;

  insert into public.catalog_crawl_runs(status)
  values ('running') returning id into new_run_id;

  insert into public.catalog_crawl_tasks(run_id, task_key, supermarket, kind, payload)
  values
    (new_run_id, 'vtex-categories:jumbo', 'Jumbo', 'vtex_categories',
      jsonb_build_object('base_url', 'https://jumbo.vtexcommercestable.com.br', 'public_origin', 'https://www.jumbo.cl')),
    (new_run_id, 'vtex-categories:santa-isabel', 'Santa Isabel', 'vtex_categories',
      jsonb_build_object('base_url', 'https://santaisabel.vtexcommercestable.com.br', 'public_origin', 'https://www.santaisabel.cl')),
    (new_run_id, 'sitemap:https://super.lider.cl/siteindex.xml', 'Lider', 'sitemap',
      jsonb_build_object('url', 'https://super.lider.cl/siteindex.xml'))
  on conflict (run_id, task_key) do nothing;

  update public.catalog_crawl_runs
  set tasks_total = (select count(*)::integer from public.catalog_crawl_tasks where run_id = new_run_id)
  where id = new_run_id;
  return new_run_id;
end;
$$;

revoke all on function public.start_catalog_crawl_service() from public, anon, authenticated;
grant execute on function public.start_catalog_crawl_service() to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'catalog-crawl-worker-every-minute'
  limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
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
