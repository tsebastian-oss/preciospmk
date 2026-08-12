-- Add structured dealer sources that publish vehicle prices by model/version.
-- Guillermo Morales stays registered but disabled because its vehicle payload is client-rendered
-- and is not present in the raw HTML returned to the Edge worker.

update public.automotive_sources
set enabled=false,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'adapter_status','pending_dynamic_data_source',
      'validation_result','raw_html_has_no_vehicle_payload',
      'next_action','identify_public_dynamic_endpoint'
    ),
    updated_at=now()
where source_key='guillermo_morales';

insert into public.automotive_sources(
  source_key,dealer,source_type,parser_key,base_url,catalog_url,enabled,priority,crawl_delay_ms,metadata
)
values
  ('cartoni','Cartoni','dealer','cartoni','https://www.cartoni.cl','https://www.cartoni.cl/nuevos/geely',true,75,900,
    jsonb_build_object(
      'adapter_status','active','source_policy','dealer_primary','coverage','multi_brand',
      'price_granularity','version','pricing_fields','list/month_bonus/finance_bonus/final'
    )),
  ('kaufmann','Kaufmann','dealer','kaufmann','https://www.kaufmann.cl','https://www.kaufmann.cl/automoviles/mercedes-benz',true,80,1000,
    jsonb_build_object(
      'adapter_status','active','source_policy','dealer_primary','coverage','mercedes_benz',
      'price_granularity','version','pricing_fields','list/opportunity/final','currency_policy','clp_only'
    ))
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

with active_run as (
  select id from public.catalog_crawl_runs
  where vertical='automotive' and status='running'
  order by started_at desc limit 1
)
insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload,status,available_at)
select
  r.id,
  format('automotive-source:%s',s.source_key),
  s.dealer,
  'automotive',
  'automotive_dealer_catalog',
  jsonb_build_object(
    'source_id',s.id,'source_key',s.source_key,'parser_key',s.parser_key,'url',s.catalog_url,
    'stage','root','crawl_delay_ms',s.crawl_delay_ms
  ),
  'queued',now()
from active_run r
cross join public.automotive_sources s
where s.source_key in ('cartoni','kaufmann') and s.enabled
on conflict(run_id,task_key) do nothing;

update public.catalog_crawl_runs r
set tasks_total=(select count(*) from public.catalog_crawl_tasks t where t.run_id=r.id)
where r.vertical='automotive' and r.status='running';

select source_key,dealer,enabled,parser_key,priority
from public.automotive_sources
order by enabled desc,priority,source_key;
