-- Version-level Nissan prices from Guillermo Morales' public catalog.
-- The historical all-brand GM source remains disabled until its own adapter is validated.
insert into public.automotive_sources
  (source_key, dealer, source_type, parser_key, base_url, catalog_url,
   enabled, priority, crawl_delay_ms, metadata)
values
  ('nissan_guillermo_morales', 'Guillermo Morales', 'dealer',
   'nissan_guillermo_morales', 'https://guillermomorales.cl',
   'https://guillermomorales.cl/autos-nuevos/nissan', true, 22, 1000,
   '{"coverage":"nissan","source_policy":"preferred_brand_source","adapter_status":"active","price_granularity":"version","pricing_fields":"list/direct_bonus/finance_bonus/dealer_bonus/final","validation_result":"public_version_price_table"}'::jsonb)
on conflict (source_key) do update
set dealer=excluded.dealer,
    source_type=excluded.source_type,
    parser_key=excluded.parser_key,
    base_url=excluded.base_url,
    catalog_url=excluded.catalog_url,
    enabled=excluded.enabled,
    priority=excluded.priority,
    crawl_delay_ms=excluded.crawl_delay_ms,
    metadata=excluded.metadata,
    updated_at=now();
