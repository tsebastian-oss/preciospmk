-- Pharmacy catalog vertical: Salcobrand, Cruz Verde and Farmacias Ahumada.
-- This migration never deletes catalog or price history.

alter table public.catalog_crawl_runs drop constraint if exists catalog_crawl_runs_vertical_check;
alter table public.catalog_crawl_runs add constraint catalog_crawl_runs_vertical_check
  check (vertical = any (array['supermarket'::text,'department_store'::text,'pharmacy'::text]));

alter table public.catalog_crawl_tasks drop constraint if exists catalog_crawl_tasks_vertical_check;
alter table public.catalog_crawl_tasks add constraint catalog_crawl_tasks_vertical_check
  check (vertical = any (array['supermarket'::text,'department_store'::text,'pharmacy'::text]));

alter table public.catalog_crawl_tasks drop constraint if exists catalog_crawl_tasks_kind_check;
alter table public.catalog_crawl_tasks add constraint catalog_crawl_tasks_kind_check check (kind = any (array[
  'vtex_categories'::text,'vtex_page'::text,'sitemap'::text,'product_page'::text,'product_batch'::text,
  'lider_listing'::text,'lider_browse_sitemap'::text,'lider_siteindex'::text,'lider_product_sitemap'::text,
  'lider_product_batch'::text,'lider_product_page'::text,'retail_sitemap'::text,'retail_product_batch'::text,
  'retail_product_page'::text,'falabella_listing_seed'::text,'falabella_listing_page'::text,
  'ripley_sitemap'::text,'ripley_product_batch'::text,
  'pharmacy_sitemap'::text,'pharmacy_listing_page'::text,'pharmacy_product_batch'::text,'pharmacy_product_page'::text
]));

alter table public.products drop constraint if exists products_retailer_type_check;
alter table public.products add constraint products_retailer_type_check
  check (retailer_type = any (array['supermarket'::text,'department_store'::text,'pharmacy'::text]));

create table if not exists public.pharmacy_sources (
  retailer text primary key,
  public_origin text not null,
  robots_url text not null,
  sitemap_url text not null,
  enabled boolean not null default true,
  crawl_delay_ms integer not null default 1200 check (crawl_delay_ms between 250 and 30000),
  access_status text not null default 'untested' check (access_status in ('untested','available','partial','blocked','error')),
  last_discovered_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.pharmacy_sources(
  retailer,public_origin,robots_url,sitemap_url,enabled,crawl_delay_ms,access_status,metadata
) values
(
  'Salcobrand','https://salcobrand.cl','https://salcobrand.cl/robots.txt','https://salcobrand.cl/sitemap.xml',
  true,1200,'untested',jsonb_build_object(
    'strategy','sitemap_and_public_listing','product_url_hint','/products/',
    'seed_urls',jsonb_build_array('https://salcobrand.cl/','https://salcobrand.cl/mi-salcobrand-productos'),
    'price_policy','internet_price_as_offer_pharmacy_price_as_regular'
  )
),
(
  'Cruz Verde','https://beta.cruzverde.cl','https://beta.cruzverde.cl/robots.txt','https://beta.cruzverde.cl/sitemap_index.xml',
  true,1400,'untested',jsonb_build_object(
    'strategy','sitemap_and_public_listing','platform','salesforce_commerce_cloud',
    'seed_urls',jsonb_build_array(
      'https://beta.cruzverde.cl/medicamentos/ofertas/',
      'https://beta.cruzverde.cl/productos-mas/',
      'https://beta.cruzverde.cl/ofertas/ofertas-imperdibles/'
    ),
    'price_policy','lowest_public_offer_and_highest_public_normal'
  )
),
(
  'Farmacias Ahumada','https://www.farmaciasahumada.cl','https://www.farmaciasahumada.cl/robots.txt',
  'https://www.farmaciasahumada.cl/sitemap_index.xml',true,1300,'untested',jsonb_build_object(
    'strategy','sitemap_and_public_listing','platform','salesforce_commerce_cloud','product_url_hint','-sku.html',
    'seed_urls',jsonb_build_array(
      'https://www.farmaciasahumada.cl/medicamentos',
      'https://www.farmaciasahumada.cl/genericos',
      'https://www.farmaciasahumada.cl/promociones',
      'https://www.farmaciasahumada.cl/hotdeals/medicamentos'
    ),
    'price_policy','json_ld_current_price'
  )
)
on conflict(retailer) do update set
  public_origin=excluded.public_origin,
  robots_url=excluded.robots_url,
  sitemap_url=excluded.sitemap_url,
  crawl_delay_ms=excluded.crawl_delay_ms,
  metadata=public.pharmacy_sources.metadata||excluded.metadata,
  updated_at=now();

create index if not exists catalog_crawl_tasks_pharmacy_queue_idx
  on public.catalog_crawl_tasks(status,available_at,id) where vertical='pharmacy';
create index if not exists products_pharmacy_retailer_idx
  on public.products(supermarket,updated_at desc) where retailer_type='pharmacy';

create or replace function public.start_pharmacy_crawl_service(
  p_mode text default 'pilot',
  p_retailers text[] default null
) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_mode text:=lower(coalesce(p_mode,'pilot'));
  v_active bigint;
  v_run bigint;
  v_source record;
  v_seed text;
begin
  if v_mode not in ('pilot','full') then
    raise exception 'Invalid pharmacy crawl mode: %',p_mode using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(936421705);

  update public.catalog_crawl_runs
  set status='failed',finished_at=now(),completion_reason='safety_timeout',
      errors=errors||jsonb_build_array('Pharmacy run exceeded its safety window')
  where vertical='pharmacy' and status='running' and started_at<now()-interval '3 days';

  select id into v_active
  from public.catalog_crawl_runs
  where vertical='pharmacy' and status='running'
  order by started_at desc limit 1;
  if v_active is not null then return v_active; end if;

  insert into public.catalog_crawl_runs(status,vertical,trigger_type,run_date,configuration)
  values(
    'running','pharmacy','manual',(now() at time zone 'America/Santiago')::date,
    jsonb_build_object('mode',v_mode,'retailers',coalesce(to_jsonb(p_retailers),'null'::jsonb))
  ) returning id into v_run;

  for v_source in
    select * from public.pharmacy_sources source
    where source.enabled and (p_retailers is null or source.retailer=any(p_retailers))
    order by source.retailer
  loop
    insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload)
    values(
      v_run,
      format('pharmacy-sitemap:%s:%s',lower(v_source.retailer),v_source.sitemap_url),
      v_source.retailer,'pharmacy','pharmacy_sitemap',
      jsonb_build_object(
        'url',v_source.sitemap_url,'root_url',v_source.sitemap_url,'mode',v_mode,'depth',0,'max_depth',4,
        'max_product_urls',case when v_mode='pilot' then 250 else null end,
        'crawl_delay_ms',v_source.crawl_delay_ms
      )
    ) on conflict(run_id,task_key) do nothing;

    for v_seed in
      select jsonb_array_elements_text(coalesce(v_source.metadata->'seed_urls','[]'::jsonb))
    loop
      insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload)
      values(
        v_run,format('pharmacy-listing:%s:%s',lower(v_source.retailer),md5(v_seed)),
        v_source.retailer,'pharmacy','pharmacy_listing_page',
        jsonb_build_object(
          'url',v_seed,'mode',v_mode,'page',1,
          'max_pages',case when v_mode='pilot' then 3 else 50 end,
          'crawl_delay_ms',v_source.crawl_delay_ms
        )
      ) on conflict(run_id,task_key) do nothing;
    end loop;
  end loop;

  update public.catalog_crawl_runs
  set tasks_total=(select count(*)::integer from public.catalog_crawl_tasks where run_id=v_run)
  where id=v_run;

  if not exists(select 1 from public.catalog_crawl_tasks where run_id=v_run) then
    update public.catalog_crawl_runs
    set status='failed',finished_at=now(),completion_reason='no_sources'
    where id=v_run;
    raise exception 'No enabled pharmacy sources selected';
  end if;
  return v_run;
end;
$$;

create or replace function public.enqueue_pharmacy_tasks_service(p_run_id bigint,p_tasks jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inserted integer:=0;
begin
  if not exists(
    select 1 from public.catalog_crawl_runs
    where id=p_run_id and vertical='pharmacy' and status='running'
  ) then return 0; end if;

  insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload)
  select p_run_id,item->>'task_key',item->>'supermarket','pharmacy',item->>'kind',coalesce(item->'payload','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_tasks,'[]'::jsonb)) item
  where nullif(item->>'task_key','') is not null
    and nullif(item->>'supermarket','') is not null
    and nullif(item->>'kind','') is not null
  on conflict(run_id,task_key) do nothing;

  get diagnostics v_inserted=row_count;
  if v_inserted>0 then
    update public.catalog_crawl_runs set tasks_total=tasks_total+v_inserted where id=p_run_id;
  end if;
  return v_inserted;
end;
$$;

create or replace function public.claim_pharmacy_tasks_service(p_limit integer default 3)
returns table(id bigint,run_id bigint,supermarket text,kind text,payload jsonb,attempts integer)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.catalog_crawl_tasks
  set status='queued',claimed_at=null,available_at=now(),
      error=coalesce(error,'Recovered after stale pharmacy worker claim')
  where vertical='pharmacy' and status='running' and claimed_at<now()-interval '15 minutes';

  return query
  with candidates as (
    select task.id,
      row_number() over(
        partition by task.supermarket
        order by
          case task.kind
            when 'pharmacy_sitemap' then 0
            when 'pharmacy_product_batch' then 1
            when 'pharmacy_product_page' then 2
            else 3
          end,
          task.attempts,task.id
      ) retailer_rank
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id=task.run_id
    where run.vertical='pharmacy' and run.status='running'
      and task.vertical='pharmacy'
      and task.kind in ('pharmacy_sitemap','pharmacy_listing_page','pharmacy_product_batch','pharmacy_product_page')
      and task.status='queued' and task.available_at<=now()
  ), selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join candidates c on c.id=task.id
    order by c.retailer_rank,
      case task.kind
        when 'pharmacy_sitemap' then 0
        when 'pharmacy_product_batch' then 1
        when 'pharmacy_product_page' then 2
        else 3
      end,
      task.supermarket,task.id
    limit greatest(3,least(coalesce(p_limit,3),6))
    for update of task skip locked
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status='running',attempts=task.attempts+1,claimed_at=now(),error=null
    from selected where task.id=selected.id
    returning task.id,task.run_id,task.supermarket,task.kind,task.payload,task.attempts
  )
  select claimed.id,claimed.run_id,claimed.supermarket,claimed.kind,claimed.payload,claimed.attempts
  from claimed order by claimed.supermarket,claimed.id;
end;
$$;

create or replace function public.ingest_pharmacy_products_service(p_run_id bigint,p_products jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_count integer:=0;
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
      v_product_id,nullif(v_item->>'regular_price','')::numeric,
      nullif(v_item->>'offer_price','')::numeric,nullif(v_item->>'unit',''),
      nullif(v_item->>'unit_price','')::numeric,coalesce((v_item->>'in_stock')::boolean,false),
      coalesce((v_item->>'observed_at')::timestamptz,now()),p_run_id
    )
    on conflict(product_id,crawl_run_id) where crawl_run_id is not null do update set
      regular_price=excluded.regular_price,offer_price=excluded.offer_price,unit=excluded.unit,
      unit_price=excluded.unit_price,in_stock=excluded.in_stock,observed_at=excluded.observed_at;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.refresh_pharmacy_run_status_service(p_run_id bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_queued integer;
  v_running integer;
  v_completed integer;
  v_failed integer;
  v_products integer;
  v_status text;
begin
  select
    count(*) filter(where status='queued'),
    count(*) filter(where status='running'),
    count(*) filter(where status='completed'),
    count(*) filter(where status='failed'),
    coalesce(sum(products_found),0)::integer
  into v_queued,v_running,v_completed,v_failed,v_products
  from public.catalog_crawl_tasks
  where run_id=p_run_id and vertical='pharmacy';

  if coalesce(v_queued,0)+coalesce(v_running,0)=0 then
    v_status:=case when coalesce(v_failed,0)>0 then 'completed_with_errors' else 'completed' end;
  else
    v_status:='running';
  end if;

  update public.catalog_crawl_runs
  set status=v_status,
      tasks_completed=coalesce(v_completed,0),
      tasks_failed=coalesce(v_failed,0),
      products_found=coalesce(v_products,0),
      finished_at=case when v_status='running' then null else coalesce(finished_at,now()) end,
      completion_reason=case
        when v_status='completed' then 'queue_completed'
        when v_status='completed_with_errors' then 'queue_completed_with_errors'
        else completion_reason
      end,
      source_counts=coalesce((
        select jsonb_object_agg(supermarket,cnt)
        from (
          select supermarket,sum(products_found)::integer cnt
          from public.catalog_crawl_tasks
          where run_id=p_run_id group by supermarket
        ) source_totals
      ),'{}'::jsonb)
  where id=p_run_id and vertical='pharmacy';

  return jsonb_build_object(
    'run_id',p_run_id,'status',v_status,'queued',coalesce(v_queued,0),
    'running',coalesce(v_running,0),'completed',coalesce(v_completed,0),
    'failed',coalesce(v_failed,0),'products_found',coalesce(v_products,0)
  );
end;
$$;

create or replace function public.finish_pharmacy_task_service(
  p_task_id bigint,
  p_products_found integer default 0,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_task public.catalog_crawl_tasks%rowtype;
  v_remaining integer;
  v_status text;
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
    set status='completed',finished_at=now(),products_found=greatest(coalesce(p_products_found,0),0),error=null
    where id=p_task_id;
    update public.pharmacy_sources
    set last_success_at=case when p_products_found>0 then now() else last_success_at end,
        last_discovered_at=case when v_task.kind in ('pharmacy_sitemap','pharmacy_listing_page') then now() else last_discovered_at end,
        access_status=case when p_products_found>0 or v_task.kind in ('pharmacy_sitemap','pharmacy_listing_page') then 'available' else access_status end,
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
    'task_id',p_task_id,'run_id',v_task.run_id,'status',v_status,'remaining_tasks',v_remaining
  );
end;
$$;

create or replace function public.complete_pharmacy_task_service(
  p_task_id bigint,
  p_products jsonb default '[]'::jsonb,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_run bigint;
  v_count integer:=0;
begin
  select run_id into v_run
  from public.catalog_crawl_tasks
  where id=p_task_id and vertical='pharmacy';
  if v_run is null then
    raise exception 'Unknown pharmacy task %',p_task_id using errcode='P0002';
  end if;
  if p_error is null and jsonb_array_length(coalesce(p_products,'[]'::jsonb))>0 then
    v_count:=public.ingest_pharmacy_products_service(v_run,p_products);
  end if;
  return public.finish_pharmacy_task_service(p_task_id,v_count,p_error);
end;
$$;

create or replace function public.pharmacy_crawl_status_service(p_run_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_run public.catalog_crawl_runs%rowtype;
begin
  if p_run_id is null then
    select * into v_run from public.catalog_crawl_runs
    where vertical='pharmacy' order by started_at desc limit 1;
  else
    select * into v_run from public.catalog_crawl_runs
    where id=p_run_id and vertical='pharmacy';
  end if;

  if not found then
    return jsonb_build_object(
      'status','not_started','vertical','pharmacy',
      'sources',(
        select coalesce(jsonb_agg(to_jsonb(source) order by source.retailer),'[]'::jsonb)
        from public.pharmacy_sources source
      )
    );
  end if;

  return to_jsonb(v_run)||jsonb_build_object(
    'queued_tasks',(select count(*) from public.catalog_crawl_tasks where run_id=v_run.id and status='queued'),
    'running_tasks',(select count(*) from public.catalog_crawl_tasks where run_id=v_run.id and status='running'),
    'sources',(
      select coalesce(jsonb_agg(to_jsonb(source) order by source.retailer),'[]'::jsonb)
      from public.pharmacy_sources source
    )
  );
end;
$$;

revoke all on public.pharmacy_sources from anon;
grant select on public.pharmacy_sources to authenticated,service_role;
grant execute on function public.start_pharmacy_crawl_service(text,text[]) to service_role;
grant execute on function public.enqueue_pharmacy_tasks_service(bigint,jsonb) to service_role;
grant execute on function public.claim_pharmacy_tasks_service(integer) to service_role;
grant execute on function public.ingest_pharmacy_products_service(bigint,jsonb) to service_role;
grant execute on function public.refresh_pharmacy_run_status_service(bigint) to service_role;
grant execute on function public.finish_pharmacy_task_service(bigint,integer,text) to service_role;
grant execute on function public.complete_pharmacy_task_service(bigint,jsonb,text) to service_role;
grant execute on function public.pharmacy_crawl_status_service(bigint) to authenticated,service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='daily-pharmacy-crawl';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'daily-pharmacy-crawl','30 9 * * *',
    $cron$select public.start_pharmacy_crawl_service('full',null);$cron$
  );
end;
$$;