-- Remove Rosselot rows where descriptive copy was mistakenly captured as brand/model.
-- The v1.2 worker now falls back to the canonical /nuevos/<brand>/<model> URL identity
-- whenever the parsed brand does not match the URL brand slug.

with bad as (
  select id,url
  from public.products
  where retailer_type='automotive'
    and supermarket='Rosselot'
    and brand in (
      '4×2 y 4×4',
      'E1 y E2',
      'cuentan con pisaderas',
      'con un único motor 1.0 turbo de 3 cilindros que entrega 120 Cv y un torque de 200 NM',
      'del nuevo Compass llega con hermosas llantas'
    )
), bad_urls as (
  select distinct url from bad
), deleted as (
  delete from public.products p
  using bad b
  where p.id=b.id
  returning p.id
)
update public.catalog_crawl_tasks t
set status='queued',claimed_at=null,finished_at=null,available_at=now(),products_found=0,error=null
where t.vertical='automotive'
  and t.supermarket='Rosselot'
  and t.kind='automotive_model_page'
  and t.status in ('completed','failed')
  and t.payload->>'url' in (select url from bad_urls)
  and t.run_id=(
    select id from public.catalog_crawl_runs
    where vertical='automotive' and status='running'
    order by started_at desc limit 1
  );

select count(*) as remaining_invalid_rosselot_rows
from public.products
where retailer_type='automotive'
  and supermarket='Rosselot'
  and brand in (
    '4×2 y 4×4','E1 y E2','cuentan con pisaderas',
    'con un único motor 1.0 turbo de 3 cilindros que entrega 120 Cv y un torque de 200 NM',
    'del nuevo Compass llega con hermosas llantas'
  );
