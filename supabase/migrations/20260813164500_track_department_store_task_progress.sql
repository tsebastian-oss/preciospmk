create or replace function public.finish_department_store_task_fast_service(
  p_task_id bigint,
  p_products_found integer default 0,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_task public.catalog_crawl_tasks%rowtype;
  v_remaining integer;
  v_status text;
begin
  select * into v_task
  from public.catalog_crawl_tasks
  where id=p_task_id and vertical='department_store'
  for update;

  if not found then
    raise exception 'Unknown department-store task %',p_task_id;
  end if;

  if v_task.status<>'running' then
    return jsonb_build_object('task_id',p_task_id,'status',v_task.status);
  end if;

  if p_error is null then
    update public.catalog_crawl_tasks
    set status='completed',finished_at=now(),products_found=greatest(coalesce(p_products_found,0),0),error=null
    where id=p_task_id;

    update public.catalog_crawl_runs
    set tasks_completed=coalesce(tasks_completed,0)+1
    where id=v_task.run_id;

    update public.department_store_sources
    set last_success_at=case when p_products_found>0 then now() else last_success_at end,
        last_discovered_at=case when v_task.kind in ('retail_sitemap','falabella_listing_seed') then now() else last_discovered_at end,
        access_status=case when p_products_found>0 then 'available' else access_status end,
        last_error=null,
        updated_at=now()
    where retailer=v_task.supermarket;
  elsif v_task.attempts<2 then
    update public.catalog_crawl_tasks
    set status='queued',claimed_at=null,available_at=now()+make_interval(mins=>greatest(2,v_task.attempts*5)),error=left(p_error,4000)
    where id=p_task_id;
  else
    update public.catalog_crawl_tasks
    set status='failed',finished_at=now(),error=left(p_error,4000)
    where id=p_task_id;

    update public.catalog_crawl_runs
    set tasks_failed=coalesce(tasks_failed,0)+1
    where id=v_task.run_id;

    update public.department_store_sources
    set last_error_at=now(),last_error=left(p_error,4000),
        access_status=case when lower(p_error) like '%http 403%' or lower(p_error) like '%blocked%' then 'blocked' else 'error' end,
        updated_at=now()
    where retailer=v_task.supermarket;
  end if;

  select count(*)::integer into v_remaining
  from public.catalog_crawl_tasks
  where run_id=v_task.run_id and status in ('queued','running');

  if v_remaining=0 then
    perform public.refresh_department_store_run_status_service(v_task.run_id);
  end if;

  select status into v_status
  from public.catalog_crawl_tasks
  where id=p_task_id;

  return jsonb_build_object(
    'task_id',p_task_id,
    'run_id',v_task.run_id,
    'status',v_status,
    'remaining_tasks',v_remaining
  );
end;
$$;