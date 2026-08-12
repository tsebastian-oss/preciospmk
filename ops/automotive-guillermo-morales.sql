-- Activate Guillermo Morales after validating its public new-vehicle catalog structure.

insert into public.automotive_sources(
  source_key,dealer,source_type,parser_key,base_url,catalog_url,enabled,priority,crawl_delay_ms,metadata
)
values(
  'guillermo_morales','Guillermo Morales','dealer','guillermo_morales',
  'https://guillermomorales.cl','https://guillermomorales.cl/autos-nuevos',true,70,1000,
  jsonb_build_object(
    'adapter_status','active',
    'source_policy','dealer_primary',
    'coverage','multi_brand',
    'price_granularity','model_and_version',
    'pricing_fields','list/bonus/final'
  )
)
on conflict(source_key) do update set
  dealer=excluded.dealer,
  source_type=excluded.source_type,
  parser_key=excluded.parser_key,
  base_url=excluded.base_url,
  catalog_url=excluded.catalog_url,
  enabled=true,
  priority=excluded.priority,
  crawl_delay_ms=excluded.crawl_delay_ms,
  metadata=excluded.metadata,
  updated_at=now();

with active_run as (
  select id
  from public.catalog_crawl_runs
  where vertical='automotive' and status='running'
  order by started_at desc
  limit 1
)
insert into public.catalog_crawl_tasks(run_id,task_key,supermarket,vertical,kind,payload,status,available_at)
select
  r.id,
  'automotive-source:guillermo_morales',
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
  'queued',now()
from active_run r
join public.automotive_sources s on s.source_key='guillermo_morales'
on conflict(run_id,task_key) do nothing;

update public.catalog_crawl_runs r
set tasks_total=(select count(*) from public.catalog_crawl_tasks t where t.run_id=r.id)
where r.vertical='automotive' and r.status='running';
