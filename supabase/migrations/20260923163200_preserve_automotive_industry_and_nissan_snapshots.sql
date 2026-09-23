-- Dealer ingestion explicitly marks vehicle products as automotive. Generic text
-- classification must not demote them to "other" when the category is Sedán/SUV.
create or replace function public.products_apply_industry()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if new.retailer_type = 'automotive' then
    new.industry_slug := 'automotive';
    new.industry_confidence := 1;
    new.industry_source := 'automotive_dealer_scraper';
  elsif coalesce(new.industry_source,'rule') <> 'manual' then
    new.industry_slug := public.canonical_product_industry(new.name,new.category,new.retailer_type);
    new.industry_confidence := case when new.industry_slug in ('grocery','other') then 0.550 else 0.900 end;
    new.industry_source := 'rule';
  end if;
  return new;
end;
$$;

-- Repair only the 13 observations in the focused Guillermo Morales validation run.
-- Historical price values and prior observation rows are left untouched.
update public.products p
set industry_slug='automotive', industry_confidence=1,
    industry_source='automotive_dealer_scraper'
where p.retailer_type='automotive'
  and p.supermarket='Guillermo Morales'
  and p.source_metadata->>'parser'='nissan_guillermo_morales'
  and exists (
    select 1 from public.price_observations o
    where o.product_id=p.id and o.crawl_run_id=1326
  );

update public.price_observations o
set automotive_snapshot=jsonb_build_object(
  'brand',p.brand,
  'model',coalesce(nullif(p.source_metadata->>'model',''),p.parent_external_id,p.name),
  'version',coalesce(nullif(p.variant,''),p.source_metadata->>'version'),
  'dealer',p.supermarket,
  'url',p.url,
  'metadata',p.source_metadata
)
from public.products p
where p.id=o.product_id
  and o.crawl_run_id=1326
  and o.automotive_snapshot is null
  and p.supermarket='Guillermo Morales'
  and p.source_metadata->>'parser'='nissan_guillermo_morales'
  and p.industry_slug='automotive';
