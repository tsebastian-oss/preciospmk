-- Falabella product pages reject datacenter requests, while its public category
-- listings expose complete priced records. Seed stable top-level categories and
-- keep Paris on the known-product worker.

create table if not exists private.department_store_daily_seeds(
  retailer text not null,
  url text not null,
  category_name text not null,
  enabled boolean not null default true,
  primary key(retailer,url)
);

revoke all on table private.department_store_daily_seeds from public,anon,authenticated;
grant select on table private.department_store_daily_seeds to service_role;

insert into private.department_store_daily_seeds(retailer,url,category_name)
values
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG36391/Accesorios-Moda','Accesorios Moda'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG10012/Alimentos-y-bebidas','Alimentos y bebidas'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG10598/Aseo-y-limpieza','Aseo y limpieza'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG10006/Automotriz','Automotriz'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat7660002/Belleza-higiene-y-salud','Belleza, higiene y salud'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG36089/Calzado','Calzado'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat01/Cocina-y-Bano','Cocina y Baño'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG10005/Construccion','Construcción'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat8950017/Decohogar','Decohogar'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat1005/Dormitorio','Dormitorio'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat16510006/Electrohogar','Electrohogar'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat170005/Especiales','Especiales'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG36220/Ferreteria','Ferretería'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG36263/Gasfiteria','Gasfitería'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG36264/Herramientas-y-maquinas','Herramientas y máquinas'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat7450065/Hombre','Hombre'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG10011/Jardin-y-terraza','Jardín y terraza'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat6990144/Libreria-y-celebraciones','Librería y celebraciones'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG34913/Maleteria-y-viajes','Maletería y viajes'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat9360001/Mascotas','Mascotas'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat1008/Muebles','Muebles'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat7330051/Mujer','Mujer'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat2008/Mundo-Bebe','Mundo Bebé'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/cat13550007/Ninos-y-Jugueteria','Niños y Juguetería'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG12035/Organizacion','Organización'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG10007/Pasatiempos','Pasatiempos'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG36265/Pinturas','Pinturas'),
  ('Falabella','https://www.falabella.com/falabella-cl/category/CATG12036/Servicios-e-Intangibles','Servicios e Intangibles')
on conflict(retailer,url) do update
set category_name=excluded.category_name,enabled=true;

create or replace function public.start_daily_department_store_refresh_service(
  p_retailers text[] default array['Paris','Falabella']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_local_date date := (now() at time zone 'America/Santiago')::date;
  v_allowed constant text[] := array['Paris','Falabella']::text[];
  v_retailers text[];
  v_run bigint;
  v_tasks integer := 0;
  v_existing boolean := false;
begin
  perform pg_advisory_xact_lock(824631986);

  select array_agg(distinct requested.retailer order by requested.retailer)
  into v_retailers
  from unnest(coalesce(p_retailers,v_allowed)) as requested(retailer)
  where requested.retailer=any(v_allowed);

  if coalesce(cardinality(v_retailers),0)=0 then
    raise exception 'No supported department-store retailer requested' using errcode='22023';
  end if;

  select id into v_run
  from public.catalog_crawl_runs
  where vertical='department_store'
    and status='running'
    and run_date=v_local_date
    and trigger_type='scheduled'
    and coalesce(configuration->>'strategy','')='daily_known_catalog_refresh'
  order by id desc limit 1;
  v_existing:=v_run is not null;

  if not v_existing then
    with stale_runs as (
      select id from public.catalog_crawl_runs
      where vertical='department_store' and status='running'
        and (started_at<now()-interval '20 hours' or run_date<v_local_date)
      for update
    )
    update public.catalog_crawl_tasks task
    set status='failed',finished_at=coalesce(task.finished_at,now()),claimed_at=null,
        error=left(concat_ws('; ',nullif(task.error,''),'Superseded by the next daily department-store refresh'),4000)
    where task.run_id in(select id from stale_runs) and task.status in('queued','running');

    update public.catalog_crawl_runs
    set status='completed_with_errors',finished_at=coalesce(finished_at,now()),
        completion_reason='superseded_by_daily_refresh'
    where vertical='department_store' and status='running'
      and (started_at<now()-interval '20 hours' or run_date<v_local_date);

    insert into public.catalog_crawl_runs(
      status,vertical,trigger_type,run_date,window_end_at,configuration,
      tasks_total,tasks_completed,tasks_failed,products_found
    ) values (
      'running','department_store','scheduled',v_local_date,now()+interval '20 hours',
      jsonb_build_object('mode','daily_refresh','strategy','daily_known_catalog_refresh',
        'retailers',to_jsonb(v_retailers),'paris_batch_size',50,'falabella_source','category_listings'),
      0,0,0,0
    ) returning id into v_run;
  end if;

  if 'Paris'=any(v_retailers) then
    with urls as (
      select url,row_number() over(order by url) as row_number
      from (
        select distinct regexp_replace(url,'[?#].*$','','g') as url
        from public.products
        where supermarket='Paris' and nullif(btrim(url),'') is not null
      ) unique_urls
    ), groups as (
      select ((row_number-1)/50)::integer as batch_number,jsonb_agg(url order by url) as urls
      from urls group by ((row_number-1)/50)::integer
    )
    insert into public.catalog_crawl_tasks(
      run_id,task_key,supermarket,vertical,kind,payload,status,available_at
    )
    select v_run,format('paris-daily:%s:%s',to_char(v_local_date,'YYYY-MM-DD'),batch_number),
           'Paris','department_store','retail_product_batch',
           jsonb_build_object('urls',urls,'crawl_delay_ms',300,'mode','daily_refresh'),'queued',now()
    from groups on conflict(run_id,task_key) do nothing;
  end if;

  if 'Falabella'=any(v_retailers) then
    insert into public.catalog_crawl_tasks(
      run_id,task_key,supermarket,vertical,kind,payload,status,available_at
    )
    select v_run,
           format('falabella-daily-seed:%s:%s',to_char(v_local_date,'YYYY-MM-DD'),md5(seed.url)),
           'Falabella','department_store','falabella_listing_page',
           jsonb_build_object('url',seed.url,'page',1,'depth',1,'category_name',seed.category_name,
             'discover_categories',true,'mode','daily_refresh'),
           'queued',now()
    from private.department_store_daily_seeds seed
    where seed.retailer='Falabella' and seed.enabled
    on conflict(run_id,task_key) do nothing;
  end if;

  select count(*)::integer into v_tasks from public.catalog_crawl_tasks where run_id=v_run;
  update public.catalog_crawl_runs
  set tasks_total=v_tasks,
      configuration=configuration||jsonb_build_object('retailers',to_jsonb(v_retailers),
        'paris_batch_size',50,'falabella_source','category_listings')
  where id=v_run;

  if v_tasks=0 then
    update public.catalog_crawl_runs set status='failed',finished_at=now(),completion_reason='no_daily_refresh_tasks'
    where id=v_run;
    raise exception 'No department-store refresh tasks were created';
  end if;

  return jsonb_build_object('runId',v_run,'existing',v_existing,'runDate',v_local_date,
    'retailers',to_jsonb(v_retailers),'tasks',v_tasks,'parisBatchSize',50,
    'falabellaSource','category_listings');
end;
$function$;

revoke all on function public.start_daily_department_store_refresh_service(text[]) from public,anon,authenticated;
grant execute on function public.start_daily_department_store_refresh_service(text[]) to service_role;

-- The generic product-page worker is now Paris-only again.
create or replace function public.claim_department_store_tasks_service(p_limit integer default 3)
returns table(id bigint,run_id bigint,supermarket text,kind text,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  update public.catalog_crawl_tasks task
  set status='queued',claimed_at=null,available_at=now(),
      error=coalesce(task.error,'Recovered after stale Paris worker claim')
  where task.vertical='department_store' and task.supermarket='Paris' and task.status='running'
    and task.kind in('retail_sitemap','retail_product_batch','retail_product_page')
    and task.claimed_at<now()-interval '15 minutes';

  return query with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id=task.run_id
    where run.vertical='department_store' and run.status='running'
      and task.vertical='department_store' and task.supermarket='Paris'
      and task.kind in('retail_sitemap','retail_product_batch','retail_product_page')
      and task.status='queued' and task.available_at<=now()
    order by case task.kind when 'retail_sitemap' then 0 when 'retail_product_batch' then 1 else 2 end,
             task.attempts,task.id
    limit greatest(1,least(coalesce(p_limit,3),8))
    for update of task skip locked
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status='running',attempts=task.attempts+1,claimed_at=now(),error=null
    from selected where task.id=selected.id
    returning task.id,task.run_id,task.supermarket,task.kind,task.payload,task.attempts
  )
  select claimed.id,claimed.run_id,claimed.supermarket,claimed.kind,claimed.payload,claimed.attempts
  from claimed order by claimed.id;
end;
$function$;

revoke all on function public.claim_department_store_tasks_service(integer) from public,anon,authenticated;
grant execute on function public.claim_department_store_tasks_service(integer) to service_role;

update public.scraper_worker_controls
set url='https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/falabella-listing-worker',
    min_interval_seconds=15,max_pending_calls=2,timeout_ms=120000,updated_at=now()
where worker_key='falabella';

-- Retire the product-page fallback tasks that Falabella rejects with 403.
update public.catalog_crawl_tasks task
set status='completed',finished_at=coalesce(finished_at,now()),claimed_at=null,
    error='Superseded by Falabella public category listing refresh'
where task.vertical='department_store' and task.supermarket='Falabella'
  and task.kind='retail_product_batch' and task.status in('queued','running')
  and exists(select 1 from public.catalog_crawl_runs run where run.id=task.run_id and run.status='running');

select public.start_daily_department_store_refresh_service(array['Paris','Falabella']);

update public.catalog_crawl_runs run
set tasks_total=(select count(*)::integer from public.catalog_crawl_tasks task where task.run_id=run.id),
    tasks_completed=(select count(*)::integer from public.catalog_crawl_tasks task where task.run_id=run.id and task.status='completed'),
    tasks_failed=(select count(*)::integer from public.catalog_crawl_tasks task where task.run_id=run.id and task.status='failed')
where run.vertical='department_store' and run.status='running'
  and run.run_date=(now() at time zone 'America/Santiago')::date;
