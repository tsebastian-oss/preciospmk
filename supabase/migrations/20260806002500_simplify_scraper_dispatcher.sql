create or replace function public.dispatch_scraper_workers_service()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  worker public.scraper_worker_controls%rowtype;
  v_pending integer;
  v_needed integer;
  v_dispatched integer;
  v_status jsonb := '[]'::jsonb;
  i integer;
begin
  if not pg_try_advisory_xact_lock(824631990) then
    return jsonb_build_object('status', 'already_running');
  end if;

  for worker in
    select *
    from public.scraper_worker_controls
    where enabled
    order by worker_key
  loop
    select count(*)::integer
      into v_pending
    from net.http_request_queue
    where url = worker.url;

    v_dispatched := 0;

    if worker.last_dispatched_at is null
       or worker.last_dispatched_at <= now() - make_interval(secs => worker.min_interval_seconds) then
      v_needed := greatest(worker.max_pending_calls - v_pending, 0);

      if v_needed > 0 then
        for i in 1..v_needed loop
          perform net.http_post(
            url := worker.url,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := '{}'::jsonb,
            timeout_milliseconds := worker.timeout_ms
          );
          v_dispatched := v_dispatched + 1;
        end loop;

        update public.scraper_worker_controls
        set last_dispatched_at = now(),
            updated_at = now()
        where worker_key = worker.worker_key;
      end if;
    end if;

    v_status := v_status || jsonb_build_array(jsonb_build_object(
      'worker', worker.worker_key,
      'pendingCalls', v_pending,
      'dispatched', v_dispatched
    ));
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'workers', v_status,
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
      schedule => '59 seconds',
      active => true
    );
  end if;
end;
$$;
