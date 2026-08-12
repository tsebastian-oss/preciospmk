create or replace function public.ingest_automotive_products_service(
  p_run_id bigint,
  p_task_id bigint,
  p_dealer text,
  p_products jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
    v_meta:=coalesce(v_item->'metadata','{}'::jsonb)||jsonb_build_object(
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
    v_product_id:=null;

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
      name=excluded.name,
      brand=excluded.brand,
      category=excluded.category,
      url=excluded.url,
      image_url=coalesce(excluded.image_url,products.image_url),
      retailer_type='automotive',
      seller=excluded.seller,
      seller_id=excluded.seller_id,
      parent_external_id=excluded.parent_external_id,
      variant=excluded.variant,
      source_metadata=excluded.source_metadata,
      industry_slug='automotive',
      industry_confidence=1,
      industry_source='automotive_dealer_scraper',
      smart_category=excluded.smart_category,
      updated_at=now()
    where not (
      coalesce(excluded.source_metadata->>'capture_scope','')='version_listing_fallback'
      and coalesce(products.source_metadata->>'capture_scope','')<>'version_listing_fallback'
    )
    returning id into v_product_id;

    -- A listing fallback is deliberately ignored when a richer detail-page row already exists.
    if v_product_id is null then continue; end if;

    if v_final is not null and v_final>0 then
      insert into public.price_observations(
        product_id,regular_price,offer_price,unit,unit_price,in_stock,observed_at,crawl_run_id
      ) values (
        v_product_id,coalesce(v_list,v_final),v_final,'vehículo',null,true,now(),p_run_id
      )
      on conflict (product_id,crawl_run_id) where crawl_run_id is not null
      do update set
        regular_price=excluded.regular_price,
        offer_price=excluded.offer_price,
        unit=excluded.unit,
        unit_price=excluded.unit_price,
        in_stock=excluded.in_stock,
        observed_at=excluded.observed_at;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
