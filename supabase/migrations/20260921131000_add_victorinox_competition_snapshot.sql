create materialized view if not exists private.victorinox_competition_snapshot as
select
  p.id::text as id,
  p.supermarket as retailer,
  coalesce(p.brand, '') as brand,
  p.name,
  coalesce(p.category, '') as category,
  coalesce(p.smart_category, '') as smart_category,
  coalesce(s.regular_price, 0) as regular_price,
  coalesce(s.offer_price, 0) as offer_price,
  s.in_stock,
  s.observed_at,
  p.url
from public.products p
join public.product_latest_price_state s on s.product_id = p.id
where p.brand = any (array[
  'Tissot', 'Seiko', 'Citizen',
  'Samsonite', 'American Tourister', 'Saxoline',
  'Leatherman',
  'Arcos', 'Global', 'Zwilling', 'Tramontina', 'Wusthof', 'Wüsthof'
])
  and s.observed_at >= now() - interval '180 days'
  and coalesce(nullif(s.offer_price, 0), s.regular_price, 0) > 0;

create unique index if not exists victorinox_competition_snapshot_id_idx
  on private.victorinox_competition_snapshot (id);

create index if not exists victorinox_competition_snapshot_brand_observed_idx
  on private.victorinox_competition_snapshot (brand, observed_at desc);

create or replace function public.victorinox_competition_market_payload(
  p_limit_per_brand integer default 250
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $function$
with ranked as (
  select *,
    row_number() over (partition by brand order by observed_at desc, id) as rn
  from private.victorinox_competition_snapshot
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'retailer', retailer,
      'brand', brand,
      'name', name,
      'category', category,
      'smart_category', smart_category,
      'regular_price', regular_price,
      'offer_price', offer_price,
      'in_stock', in_stock,
      'observed_at', observed_at::text,
      'url', url
    )
    order by brand, observed_at desc
  ),
  '[]'::jsonb
)
from ranked
where rn <= greatest(25, least(coalesce(p_limit_per_brand, 250), 500));
$function$;

revoke all on function public.victorinox_competition_market_payload(integer) from public;
revoke all on function public.victorinox_competition_market_payload(integer) from anon;
grant execute on function public.victorinox_competition_market_payload(integer) to authenticated;
grant execute on function public.victorinox_competition_market_payload(integer) to service_role;

create or replace function private.refresh_victorinox_competition_snapshot()
returns void
language plpgsql
security definer
set search_path = private, public
as $function$
begin
  refresh materialized view private.victorinox_competition_snapshot;
end;
$function$;

revoke all on function private.refresh_victorinox_competition_snapshot() from public;
revoke all on function private.refresh_victorinox_competition_snapshot() from anon;
revoke all on function private.refresh_victorinox_competition_snapshot() from authenticated;
grant execute on function private.refresh_victorinox_competition_snapshot() to service_role;

do $block$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'refresh-victorinox-competition-snapshot'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'refresh-victorinox-competition-snapshot',
    '15 */6 * * *',
    'select private.refresh_victorinox_competition_snapshot();'
  );
end;
$block$;
