-- Preserve rejected pharmacy captures for audit while keeping them out of user-facing catalog views.

update public.products p
set source_metadata=p.source_metadata||jsonb_build_object(
  'capture_status','rejected_non_product',
  'rejection_reason','service_or_legal_page_detected_during_pharmacy_pilot',
  'rejected_at',now()
)
where p.retailer_type='pharmacy'
  and p.supermarket='Cruz Verde'
  and (
    p.url ilike '%/servicio-al-cliente/%'
    or p.url ilike '%/servicios/%'
    or p.url ilike '%/bases-legales/%'
    or p.url ilike '%/contents-content-pages-module/%'
  );

update public.products p
set source_metadata=p.source_metadata||jsonb_build_object(
  'capture_status','rejected_price_missing',
  'rejection_reason','no_positive_public_price_in_initial_pilot',
  'rejected_at',now()
)
where p.retailer_type='pharmacy'
  and coalesce(p.source_metadata->>'capture_status','accepted')='accepted'
  and not exists(
    select 1 from public.price_observations po
    where po.product_id=p.id and po.offer_price>0
  );

create or replace function public.ingest_pharmacy_products_service(p_run_id bigint,p_products jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb; v_product_id uuid; v_count integer:=0;
begin
  if not exists(
    select 1 from public.catalog_crawl_runs
    where id=p_run_id and vertical='pharmacy' and status='running'
  ) then raise exception 'Pharmacy run % is not active',p_run_id; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_products,'[]'::jsonb)) loop
    if nullif(v_item->>'supermarket','') is null
      or nullif(v_item->>'external_id','') is null
      or nullif(v_item->>'name','') is null
      or coalesce(nullif(v_item->>'offer_price','')::numeric,0)<=0
    then continue; end if;

    insert into public.products(
      supermarket,external_id,name,brand,category,url,image_url,retailer_type,
      seller,seller_id,parent_external_id,variant,source_metadata,updated_at
    ) values(
      v_item->>'supermarket',v_item->>'external_id',v_item->>'name',nullif(v_item->>'brand',''),
      nullif(v_item->>'category',''),v_item->>'url',nullif(v_item->>'image_url',''),'pharmacy',
      nullif(v_item->>'seller',''),nullif(v_item->>'seller_id',''),nullif(v_item->>'parent_external_id',''),
      nullif(v_item->>'variant',''),coalesce(v_item->'source_metadata','{}'::jsonb),now()
    )
    on conflict(supermarket,external_id) do update set
      name=excluded.name,brand=excluded.brand,category=excluded.category,url=excluded.url,
      image_url=excluded.image_url,retailer_type='pharmacy',seller=excluded.seller,seller_id=excluded.seller_id,
      parent_external_id=excluded.parent_external_id,variant=excluded.variant,
      source_metadata=public.products.source_metadata||excluded.source_metadata,updated_at=now()
    returning id into v_product_id;

    insert into public.price_observations(
      product_id,regular_price,offer_price,unit,unit_price,in_stock,observed_at,crawl_run_id
    ) values(
      v_product_id,nullif(v_item->>'regular_price','')::numeric,nullif(v_item->>'offer_price','')::numeric,
      nullif(v_item->>'unit',''),nullif(v_item->>'unit_price','')::numeric,
      coalesce((v_item->>'in_stock')::boolean,false),
      coalesce((v_item->>'observed_at')::timestamptz,now()),p_run_id
    )
    on conflict(product_id,crawl_run_id) where crawl_run_id is not null do update set
      regular_price=excluded.regular_price,offer_price=excluded.offer_price,
      unit=excluded.unit,unit_price=excluded.unit_price,
      in_stock=excluded.in_stock,observed_at=excluded.observed_at;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.finish_pharmacy_task_service(
  p_task_id bigint,p_products_found integer default 0,p_error text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_task public.catalog_crawl_tasks%rowtype;v_remaining integer;v_status text;
begin
  select * into v_task
  from public.catalog_crawl_tasks
  where id=p_task_id and vertical='pharmacy'
  for update;
  if not found then raise exception 'Unknown pharmacy task %',p_task_id; end if;
  if v_task.status<>'running' then
    return jsonb_build_object('task_id',p_task_id,'status',v_task.status);
  end if;

  if p_error is null then
    update public.catalog_crawl_tasks
    set status='completed',finished_at=now(),
        products_found=greatest(coalesce(p_products_found,0),0),error=null
    where id=p_task_id;
    update public.pharmacy_sources
    set last_success_at=case when p_products_found>0 then now() else last_success_at end,
        last_discovered_at=case when v_task.kind in ('pharmacy_sitemap','pharmacy_listing_page') then now() else last_discovered_at end,
        access_status=case
          when p_products_found>0 then 'available'
          when v_task.kind in ('pharmacy_sitemap','pharmacy_listing_page') and access_status='untested' then 'partial'
          else access_status
        end,
        last_error=null,updated_at=now()
    where retailer=v_task.supermarket;
  elsif v_task.attempts<3 then
    update public.catalog_crawl_tasks
    set status='queued',claimed_at=null,
        available_at=now()+make_interval(mins=>greatest(2,v_task.attempts*4)),
        error=left(p_error,4000)
    where id=p_task_id;
  else
    update public.catalog_crawl_tasks
    set status='failed',finished_at=now(),error=left(p_error,4000)
    where id=p_task_id;
    update public.pharmacy_sources
    set last_error_at=now(),last_error=left(p_error,4000),
        access_status=case
          when lower(p_error) like '%http 403%'
            or lower(p_error) like '%http 429%'
            or lower(p_error) like '%blocked%'
          then 'blocked' else 'partial' end,
        updated_at=now()
    where retailer=v_task.supermarket;
  end if;

  select count(*)::integer into v_remaining
  from public.catalog_crawl_tasks
  where run_id=v_task.run_id and status in ('queued','running');
  if v_remaining=0 then perform public.refresh_pharmacy_run_status_service(v_task.run_id); end if;
  select status into v_status from public.catalog_crawl_tasks where id=p_task_id;
  return jsonb_build_object(
    'task_id',p_task_id,'run_id',v_task.run_id,
    'status',v_status,'remaining_tasks',v_remaining
  );
end;
$$;

create or replace view public.dashboard_products as
select
  p.id,
  p.supermarket,
  p.external_id,
  btrim(replace(replace(replace(replace(p.name,'&nbsp;',' '),'&amp;','&'),'&quot;','"'),'&#39;','''')) as name,
  p.brand,
  case
    when p.category is null or length(btrim(p.category))<=1 then null
    when p.category='juguetera a' then 'Juguetería'
    when p.category='librera a' then 'Librería'
    when p.category='tecnologa a' then 'Tecnología'
    when p.category='muebles y decoracion' then 'Muebles y decoración'
    when p.category='menaje cocina' then 'Menaje de cocina'
    when p.category='menaje comedor' then 'Menaje de comedor'
    when p.category='rutina para el cabello' then 'Cuidado capilar'
    when p.category='vestuario' then 'Vestuario'
    when p.category='electrohogar' then 'Electrohogar'
    when p.category='dormitorio' then 'Dormitorio'
    when p.category='destilados' then 'Destilados'
    when p.category='supermercado' then 'Supermercado'
    else p.category
  end as category,
  p.url,
  p.image_url,
  latest.regular_price,
  latest.offer_price,
  latest.unit,
  latest.unit_price,
  latest.in_stock,
  latest.observed_at,
  greatest(coalesce(latest.regular_price,latest.offer_price)-latest.offer_price,0) as savings,
  case
    when latest.regular_price is not null
      and latest.regular_price>latest.offer_price
      and latest.offer_price>0
    then round((latest.regular_price-latest.offer_price)/latest.regular_price*100,1)
    else 0
  end as discount_pct,
  p.retailer_type,
  p.industry_slug,
  p.seller,
  p.variant
from public.products p
join lateral (
  select po.regular_price,po.offer_price,po.unit,po.unit_price,po.in_stock,po.observed_at
  from public.price_observations po
  where po.product_id=p.id and po.crawl_run_id is not null
  order by po.observed_at desc
  limit 1
) latest on true
where p.retailer_type in ('supermarket','department_store','pharmacy')
  and coalesce(p.source_metadata->>'capture_status','accepted')='accepted'
  and (p.retailer_type<>'pharmacy' or latest.offer_price>0);

create or replace view public.product_matching_listings as
select
  id,supermarket,external_id,name,brand,category,url,image_url,
  regular_price,offer_price,unit,unit_price,in_stock,observed_at,
  savings,discount_pct,
  public.normalize_product_match_key(coalesce(brand,'')||' '||name) as match_key
from public.dashboard_products product
where product.retailer_type='supermarket'
  and product.offer_price>0
  and length(public.normalize_product_match_key(coalesce(product.brand,'')||' '||product.name))>=8;

grant select on public.dashboard_products to anon,authenticated,service_role;
grant select on public.product_matching_listings to anon,authenticated,service_role;

update public.pharmacy_sources source
set access_status=case
  when exists(
    select 1
    from public.products product
    join public.price_observations observation on observation.product_id=product.id
    where product.retailer_type='pharmacy'
      and product.supermarket=source.retailer
      and coalesce(product.source_metadata->>'capture_status','accepted')='accepted'
      and observation.offer_price>0
  ) then 'available'
  when source.last_discovered_at is not null then 'partial'
  else source.access_status
end,
updated_at=now();