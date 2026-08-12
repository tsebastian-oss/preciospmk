-- Quarantine the first Cartoni rows produced before the URL/model + version-table identity fix.
-- Keep them physically present to avoid heavy FK deletes, but exclude them from Automotive ClickHouse scope.

update public.products
set industry_slug='other',
    industry_source='automotive_identity_quarantine',
    source_metadata=coalesce(source_metadata,'{}'::jsonb) || jsonb_build_object(
      'capture_status','invalid_identity',
      'quarantine_reason','cartoni_model_version_parser_v1'
    ),
    updated_at=now()
where retailer_type='automotive'
  and supermarket='Cartoni'
  and industry_slug='automotive'
  and (
    source_metadata->>'model'='VERSIONES'
    or variant in ('4X2','4X4','Automática','Mecánica')
  );

-- Retry only Cartoni model pages that failed with the old identity collision.
update public.catalog_crawl_tasks
set status='queued',
    claimed_at=null,
    finished_at=null,
    available_at=now(),
    products_found=0,
    error=null
where vertical='automotive'
  and supermarket='Cartoni'
  and kind='automotive_model_page'
  and status='failed'
  and error like 'ingest_automotive_products_service_409_%'
  and run_id=(
    select id from public.catalog_crawl_runs
    where vertical='automotive' and status='running'
    order by started_at desc limit 1
  );

-- Kaufmann returned HTTP 403 to the identified crawler during controlled validation.
-- Keep it registered but disabled; do not bypass the restriction.
update public.automotive_sources
set enabled=false,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'adapter_status','blocked_http_403',
      'next_action','alternative_public_integration'
    ),
    updated_at=now()
where source_key='kaufmann';

select
  count(*) filter (where industry_slug='automotive' and source_metadata->>'model'='VERSIONES') as active_invalid_cartoni_rows,
  count(*) filter (where industry_source='automotive_identity_quarantine') as quarantined_cartoni_rows
from public.products
where supermarket='Cartoni' and retailer_type='automotive';
