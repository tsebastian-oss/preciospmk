-- Automotive crawl quality follow-up.
-- 1) Prioritize vehicle/model pages so prices appear before exhaustive discovery completes.
-- 2) Normalize common dealership HTML entities at ingestion time.

create or replace function public.claim_automotive_tasks_service(p_limit integer default 4)
returns setof public.catalog_crawl_tasks
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  update public.catalog_crawl_tasks
  set status='queued',claimed_at=null,available_at=now()+interval '20 seconds',
      error=left(concat_ws('; ',nullif(error,''),'Requeued stale automotive task'),4000)
  where vertical='automotive' and status='running' and claimed_at < now()-interval '12 minutes';

  return query
  with picked as (
    select id
    from public.catalog_crawl_tasks
    where vertical='automotive' and status='queued' and available_at<=now()
    order by case when kind='automotive_model_page' then 0 else 1 end, available_at,id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,4),8))
  )
  update public.catalog_crawl_tasks t
  set status='running',claimed_at=now(),attempts=t.attempts+1,error=null
  from picked
  where t.id=picked.id
  returning t.*;
end;
$function$;

revoke all on function public.claim_automotive_tasks_service(integer) from public,anon,authenticated;
grant execute on function public.claim_automotive_tasks_service(integer) to service_role;

create or replace function public.ingest_automotive_products_service(
  p_run_id bigint,
  p_task_id bigint,
  p_dealer text,
  p_products jsonb
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_item jsonb;
  v_product_id uuid;
  v_count integer := 0;
  v_external_id text;
  v_brand text;
  v_model text;
  v_version text;
  v_list numeric;
  v_final numeric;
  v_cash numeric;
  v_meta jsonb;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_products,'[]'::jsonb)) loop
    v_external_id:=nullif(v_item->>'external_id','');
    v_brand:=nullif(v_item->>'brand','');
    v_model:=replace(replace(replace(coalesce(nullif(v_item->>'model',''),''),'&#215;','×'),'&amp;','&'),'&nbsp;',' ');
    v_model:=nullif(btrim(v_model),'');
    v_version:=replace(replace(replace(coalesce(nullif(v_item->>'version',''),v_model),'&#215;','×'),'&amp;','&'),'&nbsp;',' ');
    v_list:=nullif(v_item->>'list_price','')::numeric;
    v_cash:=nullif(v_item->>'cash_price','')::numeric;
    v_final:=coalesce(nullif(v_item->>'final_price','')::numeric,v_cash,v_list);
    v_meta:=coalesce(v_item->'metadata','{}'::jsonb)
      || jsonb_build_object(
        'model',v_model,
        'version',v_version,
        'dealer',p_dealer,
        'list_price',v_list,
        'cash_price',v_cash,
        'final_price',v_final,
        'source_type','dealer',
        'captured_at',now()
      );

    if v_external_id is null or v_brand is null or v_model is null then continue; end if;

    insert into public.products(
      supermarket,external_id,name,brand,category,url,image_url,retailer_type,seller,seller_id,
      parent_external_id,variant,source_metadata,industry_slug,industry_confidence,industry_source,smart_category,updated_at
    ) values (
      p_dealer,
      v_external_id,
      concat_ws(' ',v_brand,v_model,'·',v_version),
      v_brand,
      coalesce(nullif(v_item->>'body_type',''),'Vehículo'),
      coalesce(v_item->>'url',''),
      v_item->>'image_url',
      'automotive',
      p_dealer,
      coalesce(v_item->>'source_key',lower(regexp_replace(p_dealer,'[^a-zA-Z0-9]+','_','g'))),
      lower(v_brand)||':'||lower(v_model),
      v_version,
      v_meta,
      'automotive',1,'automotive_dealer_scraper',coalesce(nullif(v_item->>'body_type',''),'Vehículo'),now()
    )
    on conflict(supermarket,external_id) do update set
      name=excluded.name,brand=excluded.brand,category=excluded.category,url=excluded.url,
      image_url=coalesce(excluded.image_url,products.image_url),retailer_type='automotive',
      seller=excluded.seller,seller_id=excluded.seller_id,parent_external_id=excluded.parent_external_id,
      variant=excluded.variant,source_metadata=excluded.source_metadata,industry_slug='automotive',industry_confidence=1,
      industry_source='automotive_dealer_scraper',smart_category=excluded.smart_category,updated_at=now()
    returning id into v_product_id;

    if v_final is not null and v_final>0 then
      insert into public.price_observations(product_id,regular_price,offer_price,unit,unit_price,in_stock,observed_at,crawl_run_id)
      values(v_product_id,coalesce(v_list,v_final),v_final,'vehículo',null,true,now(),p_run_id);
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.ingest_automotive_products_service(bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_automotive_products_service(bigint,bigint,text,jsonb) to service_role;

-- Clean rows already captured during the bootstrap run.
update public.products
set
  name=replace(replace(replace(name,'&#215;','×'),'&amp;','&'),'&nbsp;',' '),
  variant=replace(replace(replace(variant,'&#215;','×'),'&amp;','&'),'&nbsp;',' '),
  parent_external_id=replace(replace(replace(parent_external_id,'&#215;','×'),'&amp;','&'),'&nbsp;',' '),
  source_metadata=jsonb_set(
    jsonb_set(source_metadata,'{model}',to_jsonb(replace(replace(replace(coalesce(source_metadata->>'model',''),'&#215;','×'),'&amp;','&'),'&nbsp;',' ')),true),
    '{version}',to_jsonb(replace(replace(replace(coalesce(source_metadata->>'version',''),'&#215;','×'),'&amp;','&'),'&nbsp;',' ')),true
  ),
  updated_at=now()
where retailer_type='automotive'
  and (name like '%&#215;%' or variant like '%&#215;%' or parent_external_id like '%&#215;%' or source_metadata::text like '%&#215;%');
