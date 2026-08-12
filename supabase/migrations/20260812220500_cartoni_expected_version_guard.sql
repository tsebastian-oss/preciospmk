create or replace function public.enqueue_automotive_tasks_service(p_parent_task_id bigint, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_parent public.catalog_crawl_tasks%rowtype;
  v_item jsonb;
  v_count integer := 0;
  v_kind text;
  v_url text;
  v_key text;
  v_expected integer;
  v_payload jsonb;
begin
  select * into v_parent
  from public.catalog_crawl_tasks
  where id=p_parent_task_id and vertical='automotive';
  if v_parent.id is null then raise exception 'Automotive parent task not found'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_url := nullif(v_item->>'url','');
    v_kind := coalesce(nullif(v_item->>'kind',''),'automotive_model_page');
    v_key := coalesce(nullif(v_item->>'task_key',''),md5(coalesce(v_url,'')||coalesce(v_item->>'stage','')));
    v_expected := case
      when coalesce(v_item->>'expected_products','') ~ '^\d+$' then (v_item->>'expected_products')::integer
      else null
    end;
    if v_url is null or v_kind not in ('automotive_dealer_catalog','automotive_model_page') then continue; end if;

    v_payload := (v_parent.payload - 'url' - 'stage') || jsonb_build_object(
      'url',v_url,
      'stage',coalesce(v_item->>'stage','model')
    );
    if v_expected is not null and v_expected > 0 then
      v_payload := v_payload || jsonb_build_object('expected_products',v_expected);
    end if;

    insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload,status,available_at)
    values(
      v_parent.run_id,
      'automotive:'||coalesce(v_parent.payload->>'source_key',lower(regexp_replace(v_parent.supermarket,'[^a-zA-Z0-9]+','_','g')))||':'||v_key,
      v_parent.supermarket,
      'automotive',
      v_kind,
      v_payload,
      'queued',
      now()
    )
    on conflict(run_id,task_key) do update set
      payload = case
        when excluded.payload ? 'expected_products'
          then public.catalog_crawl_tasks.payload || jsonb_build_object('expected_products',excluded.payload->'expected_products')
        else public.catalog_crawl_tasks.payload
      end;
    if found then v_count:=v_count+1; end if;
  end loop;

  update public.catalog_crawl_runs r
  set tasks_total=(select count(*) from public.catalog_crawl_tasks t where t.run_id=r.id)
  where r.id=v_parent.run_id;
  return v_count;
end;
$function$;
