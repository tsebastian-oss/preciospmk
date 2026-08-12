-- Expand Automotive Intelligence coverage with dealer-first sources and one brand-operated dealer fallback.
-- Images are intentionally excluded from the automotive data contract.

update public.products
set image_url = null,
    source_metadata = coalesce(source_metadata, '{}'::jsonb) - 'images' - 'image' - 'image_url'
where retailer_type = 'automotive'
  and (image_url is not null or source_metadata ?| array['images','image','image_url']);

update public.automotive_sources
set enabled=true, parser_key='salfa_automotriz', catalog_url='https://www.salfaautomotriz.cl/web/guest/nuevos/-/busqueda/asc/6', updated_at=now()
where source_key='salfa_automotriz';

update public.automotive_sources
set enabled=true, parser_key='kaufmann', catalog_url='https://www.kaufmann.cl/automoviles/mercedes-benz', updated_at=now()
where source_key='kaufmann';

insert into public.automotive_sources(source_key,dealer,source_type,parser_key,base_url,catalog_url,enabled,priority,crawl_delay_ms,metadata)
values (
  'bmw_wbm',
  'Williamson Balfour Motors',
  'brand',
  'bmw_wbm',
  'https://www.bmw.cl',
  'https://www.bmw.cl/promociones',
  true,
  85,
  900,
  jsonb_build_object('source_policy','brand_operated_dealer_fallback','brands',jsonb_build_array('BMW'),'capture_scope','pricing_only')
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

-- Bruno Fritsch and Difor remain registered but disabled until their parsers pass validation.
