-- Enforce one active crawl run per vertical and close abandoned runs without impacting interactive traffic.

-- Keep the newest active run for each vertical if an old race created duplicates.
with ranked as (
  select id,
         row_number() over (partition by vertical order by started_at desc, id desc) as rn
  from public.catalog_crawl_runs
  where status = 'running'
)
update public.catalog_crawl_runs r
set status = 'cancelled',
    finished_at = now(),
    completion_reason = coalesce(r.completion_reason, 'superseded_duplicate_running_vertical')
from ranked x
where r.id = x.id
  and x.rn > 1
  and r.status = 'running';

-- Hard safety ceiling for orphaned runs. Historical product/price data is preserved.
update public.catalog_crawl_runs
set status = 'cancelled',
    finished_at = now(),
    completion_reason = coalesce(completion_reason, 'crawl_safety_max_runtime_exceeded')
where status = 'running'
  and started_at < now() - interval '36 hours';

create unique index if not exists catalog_crawl_runs_one_running_per_vertical_idx
  on public.catalog_crawl_runs(vertical)
  where status = 'running';

create or replace function private.reconcile_crawl_runs()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  r record;
  v_updated integer := 0;
  v_closed integer := 0;
  v_last timestamptz;
  v_queued integer;
  v_running integer;
  v_completed integer;
  v_failed integer;
  v_products integer;
begin
  -- Close any run that missed its explicit window plus a small grace period.
  update public.catalog_crawl_runs
  set status = 'cancelled',
      finished_at = now(),
      completion_reason = coalesce(completion_reason, 'crawl_window_expired')
  where status = 'running'
    and window_end_at is not null
    and now() > window_end_at + interval '15 minutes';

  -- Close orphaned manual/legacy runs even if a worker keeps touching them.
  update public.catalog_crawl_runs
  set status = 'cancelled',
      finished_at = now(),
      completion_reason = coalesce(completion_reason, 'crawl_safety_max_runtime_exceeded')
  where status = 'running'
    and started_at < now() - interval '36 hours';

  for r in
    select id, vertical, started_at
    from public.catalog_crawl_runs
    where status = 'running'
  loop
    select
      count(*) filter(where status = 'queued'),
      count(*) filter(where status = 'running'),
      count(*) filter(where status = 'completed'),
      count(*) filter(where status = 'failed'),
      coalesce(sum(products_found),0)::integer,
      max(greatest(created_at,coalesce(claimed_at,created_at),coalesce(finished_at,created_at)))
    into v_queued,v_running,v_completed,v_failed,v_products,v_last
    from public.catalog_crawl_tasks
    where run_id = r.id;

    update public.catalog_crawl_runs
    set tasks_total = coalesce(v_queued,0)+coalesce(v_running,0)+coalesce(v_completed,0)+coalesce(v_failed,0),
        tasks_completed = coalesce(v_completed,0),
        tasks_failed = coalesce(v_failed,0),
        products_found = greatest(coalesce(products_found,0),coalesce(v_products,0))
    where id = r.id;
    v_updated := v_updated + 1;

    if coalesce(v_queued,0)+coalesce(v_running,0)=0 then
      update public.catalog_crawl_runs
      set status = case when coalesce(v_failed,0)>0 then 'completed_with_errors' else 'completed' end,
          finished_at = coalesce(finished_at,now()),
          completion_reason = case when coalesce(v_failed,0)>0 then 'queue_completed_with_errors' else 'queue_completed' end
      where id = r.id;
      v_closed := v_closed + 1;
    elsif r.started_at < now()-interval '24 hours'
      and coalesce(v_last,r.started_at) < now()-interval '24 hours' then
      update public.catalog_crawl_tasks
      set status='failed',
          finished_at=coalesce(finished_at,now()),
          error=coalesce(error,'Stopped after 24h without crawl activity')
      where run_id=r.id
        and status in ('queued','running');

      update public.catalog_crawl_runs
      set status='completed_with_errors',
          finished_at=now(),
          completion_reason='abandoned_no_activity_24h',
          errors=coalesce(errors,'[]'::jsonb)||jsonb_build_array(
            jsonb_build_object('kind','run_watchdog','error','Run closed after 24h without task activity','at',now())
          )
      where id=r.id;
      v_closed := v_closed + 1;
    end if;
  end loop;

  return jsonb_build_object('updated',v_updated,'closed',v_closed,'checkedAt',now());
end;
$$;
