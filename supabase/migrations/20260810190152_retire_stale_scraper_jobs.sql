-- Remove one-off recovery jobs and ensure a slow pharmacy crawl cannot block
-- the next day's snapshot.

create or replace function public.start_daily_non_supermarket_crawls_if_due_service()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_local_timestamp timestamp := now() at time zone 'America/Santiago';
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_result jsonb := jsonb_build_object('runDate',v_local_date,'localTime',v_local_timestamp);
  v_value jsonb;
begin
  if v_local_timestamp::time<time '00:20' or v_local_timestamp::time>=time '01:20' then
    return v_result||jsonb_build_object('started',false,'reason','outside_start_window');
  end if;

  begin
    v_value:=public.start_daily_department_store_refresh_service(array['Paris','Falabella']);
    v_result:=v_result||jsonb_build_object('departmentStores',v_value);
  exception when others then
    v_result:=v_result||jsonb_build_object('departmentStores',jsonb_build_object('error',sqlerrm));
  end;

  begin
    v_value:=public.start_home_improvement_crawl_service(null);
    v_result:=v_result||jsonb_build_object('homeImprovement',v_value);
  exception when others then
    v_result:=v_result||jsonb_build_object('homeImprovement',jsonb_build_object('error',sqlerrm));
  end;

  begin
    update public.catalog_crawl_tasks task
    set status='failed',
        finished_at=coalesce(task.finished_at,now()),
        claimed_at=null,
        error=left(concat_ws('; ',nullif(task.error,''),'Superseded by the next daily pharmacy refresh'),4000)
    where task.vertical='pharmacy'
      and task.status in('queued','running')
      and exists(
        select 1
        from public.catalog_crawl_runs run
        where run.id=task.run_id
          and run.vertical='pharmacy'
          and run.status='running'
          and (run.started_at<now()-interval '20 hours' or run.run_date<v_local_date)
      );

    update public.catalog_crawl_runs
    set status='completed_with_errors',
        finished_at=coalesce(finished_at,now()),
        completion_reason='superseded_by_daily_refresh'
    where vertical='pharmacy'
      and status='running'
      and (started_at<now()-interval '20 hours' or run_date<v_local_date);

    v_value:=public.start_pharmacy_crawls_service('full',null);
    update public.catalog_crawl_runs
    set trigger_type='daily_refresh',run_date=v_local_date
    where vertical='pharmacy'
      and status='running'
      and id in(
        select nullif(item->>'runId','')::bigint
        from jsonb_array_elements(coalesce(v_value->'runs','[]'::jsonb)) item
      );
    v_result:=v_result||jsonb_build_object('pharmacies',v_value);
  exception when others then
    v_result:=v_result||jsonb_build_object('pharmacies',jsonb_build_object('error',sqlerrm));
  end;

  return v_result||jsonb_build_object('started',true);
end;
$function$;

revoke all on function public.start_daily_non_supermarket_crawls_if_due_service() from public,anon,authenticated;
grant execute on function public.start_daily_non_supermarket_crawls_if_due_service() to service_role;

do $block$
begin
  if exists(select 1 from cron.job where jobname='rebuild-paris-refresh-queue') then
    perform cron.unschedule('rebuild-paris-refresh-queue');
  end if;
  if exists(select 1 from cron.job where jobname='home-improvement-daily-start') then
    perform cron.unschedule('home-improvement-daily-start');
  end if;
end
$block$;
