update public.scraper_worker_controls
set max_pending_calls = 1,
    min_interval_seconds = case worker_key
      when 'jumbo_price_refresh' then 300
      when 'falabella' then 240
      when 'paris' then 180
      when 'lider_discovery' then 180
      when 'lider_product' then 120
      when 'supermarket_catalog' then 120
      else greatest(min_interval_seconds, 120)
    end,
    updated_at = now()
where enabled;

create or replace function public.dispatch_scraper_workers_service()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  worker public.scraper_worker_controls%rowtype;
  v_pending integer;
begin
  if not pg_try_advisory_xact_lock(824631990) then
    return jsonb_build_object('status', 'already_running');
  end if;

  for worker in
    select *
    from public.scraper_worker_controls
    where enabled
      and (
        last_dispatched_at is null
        or last_dispatched_at <= now() - make_interval(secs => min_interval_seconds)
      )
    order by last_dispatched_at nulls first, worker_key
  loop
    select count(*)::integer
      into v_pending
    from net.http_request_queue
    where url = worker.url;

    if v_pending = 0 then
      perform net.http_post(
        url := worker.url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := worker.timeout_ms
      );

      update public.scraper_worker_controls
      set last_dispatched_at = now(),
          updated_at = now()
      where worker_key = worker.worker_key;

      return jsonb_build_object(
        'status', 'ok',
        'worker', worker.worker_key,
        'dispatched', 1,
        'dispatchedAt', now()
      );
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'idle',
    'dispatched', 0,
    'dispatchedAt', now()
  );
end;
$function$;

drop function if exists public.scraper_task_probe_service(
  text,
  text,
  text,
  text[],
  integer,
  integer,
  integer
);

do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'capacity-aware-scraper-dispatcher'
  order by jobid desc
  limit 1;

  if v_job_id is not null then
    perform cron.alter_job(
      v_job_id,
      schedule => '47 seconds',
      active => true
    );
  end if;
end;
$$;
