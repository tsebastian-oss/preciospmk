create or replace function public.finalize_catalog_run_assortment_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if new.status in ('completed','completed_with_errors')
     and old.status is distinct from new.status then
    -- Heavy snapshot/change calculation must not block the transaction that closes a crawl.
    update public.catalog_crawl_runs
       set assortment_summary = coalesce(assortment_summary,'{}'::jsonb)
         || jsonb_build_object('finalization_status','pending','queued_at',now())
     where id=new.id;
  end if;
  return new;
end;
$function$;

create or replace function private.finalize_pending_catalog_run_assortments()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_run_id bigint;
  v_result jsonb;
begin
  if not pg_try_advisory_xact_lock(824631974) then
    return jsonb_build_object('status','busy');
  end if;

  select r.id into v_run_id
  from public.catalog_crawl_runs r
  where r.status in ('completed','completed_with_errors')
    and coalesce(r.assortment_summary->>'finalization_status','')='pending'
  order by coalesce(r.finished_at,r.started_at),r.id
  limit 1
  for update skip locked;

  if v_run_id is null then
    return jsonb_build_object('status','idle');
  end if;

  update public.catalog_crawl_runs
     set assortment_summary=coalesce(assortment_summary,'{}'::jsonb)
       || jsonb_build_object('finalization_status','processing','started_at',now())
   where id=v_run_id;

  begin
    v_result:=public.finalize_catalog_run_assortment_service(v_run_id);
    update public.catalog_crawl_runs
       set assortment_summary=coalesce(assortment_summary,'{}'::jsonb)
         || jsonb_build_object('finalization_status','complete','finalized_at',now())
     where id=v_run_id;
    return jsonb_build_object('status','complete','run_id',v_run_id,'result',v_result);
  exception when others then
    update public.catalog_crawl_runs
       set assortment_summary=coalesce(assortment_summary,'{}'::jsonb)
         || jsonb_build_object('finalization_status','error','finalization_error',left(sqlerrm,1000),'failed_at',now())
     where id=v_run_id;
    return jsonb_build_object('status','error','run_id',v_run_id,'error',sqlerrm);
  end;
end;
$function$;

do $block$
begin
  if not exists (select 1 from cron.job where jobname='catalog-assortment-finalizer') then
    perform cron.schedule(
      'catalog-assortment-finalizer',
      '*/5 * * * *',
      'select private.finalize_pending_catalog_run_assortments();'
    );
  end if;
end
$block$;
