create or replace function public.ingest_pharmacy_products_service(p_run_id bigint, p_products jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item jsonb;
  v_product_id uuid;
  v_count integer:=0;
begin
  if not exists(select 1 from public.catalog_crawl_runs where id=p_run_id and vertical='pharmacy' and status='running') then
    raise exception 'Pharmacy run % is not active',p_run_id;
  end if;

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
      v_item->>'supermarket',v_item->>'external_id',v_item->>'name',nullif(v_item->>'brand',''),nullif(v_item->>'category',''),
      split_part(v_item->>'url','?',1),nullif(v_item->>'image_url',''),'pharmacy',nullif(v_item->>'seller',''),nullif(v_item->>'seller_id',''),
      nullif(v_item->>'parent_external_id',''),nullif(v_item->>'variant',''),coalesce(v_item->'source_metadata','{}'::jsonb),now()
    )
    on conflict(supermarket,external_id) do update set
      name=excluded.name,
      brand=coalesce(excluded.brand,public.products.brand),
      category=coalesce(excluded.category,public.products.category),
      url=excluded.url,
      image_url=coalesce(excluded.image_url,public.products.image_url),
      retailer_type='pharmacy',
      seller=coalesce(excluded.seller,public.products.seller),
      seller_id=coalesce(excluded.seller_id,public.products.seller_id),
      parent_external_id=coalesce(excluded.parent_external_id,public.products.parent_external_id),
      variant=coalesce(excluded.variant,public.products.variant),
      source_metadata=public.products.source_metadata||excluded.source_metadata,
      updated_at=now()
    returning id into v_product_id;

    update public.products
    set category=smart_category,
        source_metadata=source_metadata||jsonb_build_object('category_origin','canonical_classifier')
    where id=v_product_id
      and (category is null or btrim(category)='')
      and smart_category is not null
      and btrim(smart_category)<>'';

    insert into public.price_observations(product_id,regular_price,offer_price,unit,unit_price,in_stock,observed_at,crawl_run_id)
    values(
      v_product_id,
      nullif(v_item->>'regular_price','')::numeric,
      nullif(v_item->>'offer_price','')::numeric,
      nullif(v_item->>'unit',''),
      nullif(v_item->>'unit_price','')::numeric,
      coalesce((v_item->>'in_stock')::boolean,false),
      coalesce((v_item->>'observed_at')::timestamptz,now()),
      p_run_id
    )
    on conflict(product_id,crawl_run_id) where crawl_run_id is not null do update set
      regular_price=excluded.regular_price,
      offer_price=excluded.offer_price,
      unit=excluded.unit,
      unit_price=excluded.unit_price,
      in_stock=excluded.in_stock,
      observed_at=excluded.observed_at;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

update public.products
set url=split_part(url,'?',1),
    category=coalesce(nullif(category,''),smart_category),
    source_metadata=case
      when (category is null or btrim(category)='') and smart_category is not null
        then source_metadata||jsonb_build_object('category_origin','canonical_classifier')
      else source_metadata
    end,
    updated_at=updated_at
where retailer_type='pharmacy'
  and (
    position('?' in url)>0
    or ((category is null or btrim(category)='') and smart_category is not null)
  );

update public.pharmacy_sources
set metadata=jsonb_set(
      metadata,
      '{seed_urls}',
      '["https://beta.cruzverde.cl/medicamentos-1/","https://beta.cruzverde.cl/medicamentos/ofertas/","https://beta.cruzverde.cl/ofertas/","https://beta.cruzverde.cl/precios-bajos/medicamentos/"]'::jsonb,
      true
    ),
    access_status='available',
    last_error=null,
    updated_at=now()
where retailer='Cruz Verde';

update public.pharmacy_sources
set metadata=jsonb_set(
      metadata,
      '{seed_urls}',
      '["https://salcobrand.cl/","https://salcobrand.cl/mi-salcobrand-productos","https://salcobrand.cl/t/medicamentos"]'::jsonb,
      true
    ),
    access_status='available',
    last_error=null,
    updated_at=now()
where retailer='Salcobrand';

revoke all on function public.ingest_pharmacy_products_service(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_pharmacy_products_service(bigint,jsonb) to service_role;
