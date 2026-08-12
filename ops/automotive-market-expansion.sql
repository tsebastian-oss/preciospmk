-- Expand automotive coverage with dealership-first price sources.
-- Active sources below have a parser in automotive-crawl-worker.
-- Dynamic/JS-heavy groups remain registered but disabled until their adapter is validated.

update public.products
set image_url = null,
    source_metadata = coalesce(source_metadata, '{}'::jsonb) - 'images' - 'image_url'
where retailer_type = 'automotive'
  and (image_url is not null or coalesce(source_metadata, '{}'::jsonb) ? 'images' or coalesce(source_metadata, '{}'::jsonb) ? 'image_url');

insert into public.automotive_sources(
  source_key,dealer,source_type,parser_key,base_url,catalog_url,enabled,priority,crawl_delay_ms,metadata
)
values
  ('dercocenter','Dercocenter','dealer','dercocenter','https://www.dercocenter.cl','https://www.dercocenter.cl/busqueda',true,30,900,
    jsonb_build_object('adapter_status','active','source_policy','dealer_primary','coverage','multi_brand','price_granularity','version','pricing_fields','list/campaign/finance/final')),
  ('salfa_automotriz','Salfa Automotriz','dealer','salfa_automotriz','https://www.salfaautomotriz.cl','https://www.salfaautomotriz.cl/nuevos',true,40,900,
    jsonb_build_object('adapter_status','active','source_policy','dealer_primary','coverage','multi_brand','price_granularity','model','pricing_fields','cash/finance/final')),
  ('portillo','Portillo','dealer','portillo','https://www.portillo.cl','https://www.portillo.cl/vehiculos/nuevo',true,50,900,
    jsonb_build_object('adapter_status','active','source_policy','dealer_primary','coverage','multi_brand','price_granularity','model','pricing_fields','from/bonus')),
  ('pompeyo','Pompeyo Carrasco','dealer','pompeyo','https://www.pompeyo.cl','https://www.pompeyo.cl/categoria-producto/autos/nuevos/',true,60,1000,
    jsonb_build_object('adapter_status','active','source_policy','dealer_primary','coverage','multi_brand','price_granularity','model','pricing_fields','advertised_from')),
  ('bruno_fritsch','Bruno Fritsch','dealer','pending','https://www.bf.cl','https://www.bf.cl',false,100,1000,
    jsonb_build_object('adapter_status','pending_dynamic_adapter','source_policy','dealer_primary','coverage','multi_brand')),
  ('difor','Difor','dealer','pending','https://www.difor.cl','https://www.difor.cl',false,110,1000,
    jsonb_build_object('adapter_status','pending_dynamic_adapter','source_policy','dealer_primary','coverage','multi_brand')),
  ('guillermo_morales','Guillermo Morales','dealer','pending','https://guillermomorales.cl','https://guillermomorales.cl/autos-nuevos/todos',false,120,1000,
    jsonb_build_object('adapter_status','pending_dynamic_adapter','source_policy','dealer_primary','coverage','multi_brand')),
  ('kaufmann','Kaufmann','dealer','pending','https://www.kaufmann.cl','https://www.kaufmann.cl',false,130,1000,
    jsonb_build_object('adapter_status','pending_price_adapter','source_policy','dealer_primary','coverage','premium/commercial'))
on conflict(source_key) do update set
  dealer=excluded.dealer,
  source_type=excluded.source_type,
  parser_key=excluded.parser_key,
  base_url=excluded.base_url,
  catalog_url=excluded.catalog_url,
  enabled=excluded.enabled,
  priority=excluded.priority,
  crawl_delay_ms=excluded.crawl_delay_ms,
  metadata=excluded.metadata,
  updated_at=now();

-- If an automotive run is already active, add the newly active roots to it instead of waiting
-- for the next Monday/Friday launcher. The unique run/task key makes this idempotent.
with active_run as (
  select id
  from public.catalog_crawl_runs
  where vertical='automotive' and status='running'
  order by started_at desc
  limit 1
), inserted as (
  insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload,status,available_at)
  select
    r.id,
    format('automotive-source:%s',s.source_key),
    s.dealer,
    'automotive',
    'automotive_dealer_catalog',
    jsonb_build_object(
      'source_id',s.id,
      'source_key',s.source_key,
      'parser_key',s.parser_key,
      'url',s.catalog_url,
      'stage','root',
      'crawl_delay_ms',s.crawl_delay_ms
    ),
    'queued',
    now()
  from active_run r
  cross join public.automotive_sources s
  where s.enabled
  on conflict(run_id,task_key) do nothing
  returning run_id
)
update public.catalog_crawl_runs r
set tasks_total=(select count(*) from public.catalog_crawl_tasks t where t.run_id=r.id)
where r.id in (select run_id from active_run);

select source_key,dealer,enabled,parser_key,priority
from public.automotive_sources
order by enabled desc,priority,source_key;
