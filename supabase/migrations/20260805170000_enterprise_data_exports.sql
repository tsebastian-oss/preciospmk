create or replace view public.enterprise_price_export_rows
with (security_invoker = true)
as
select
  d.product_id,
  d.price_date,
  d.observed_at,
  d.observation_id,
  d.supermarket,
  p.external_id,
  p.name,
  p.brand,
  p.category,
  p.url,
  p.image_url,
  o.regular_price,
  o.offer_price,
  d.effective_price,
  o.unit,
  o.unit_price,
  o.in_stock
from public.daily_pricing_live d
join public.products p on p.id = d.product_id
join public.price_observations o on o.id = d.observation_id;

revoke all on public.enterprise_price_export_rows from public, anon, authenticated;
grant select on public.enterprise_price_export_rows to service_role;

create or replace function public.enterprise_export_availability(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
begin
  perform public.enterprise_access_context(p_organization_id, 'overview');

  select retailers, brands, categories
    into v_retailers, v_brands, v_categories
  from public.organization_scopes
  where organization_id = p_organization_id;

  return (
    with scoped as (
      select d.*
      from public.daily_pricing_live d
      where (coalesce(cardinality(v_retailers), 0) = 0 or d.supermarket = any(v_retailers))
        and (coalesce(cardinality(v_brands), 0) = 0 or exists (
          select 1 from unnest(v_brands) b where lower(b) = lower(coalesce(d.brand, ''))
        ))
        and (coalesce(cardinality(v_categories), 0) = 0 or exists (
          select 1 from unnest(v_categories) c where lower(c) = lower(coalesce(d.category, ''))
        ))
    ), retailer_rows as (
      select supermarket, count(*)::bigint as observations
      from scoped
      group by supermarket
    )
    select jsonb_build_object(
      'firstDate', min(price_date),
      'lastDate', max(price_date),
      'observations', count(*),
      'products', count(distinct product_id),
      'retailers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'supermarket', supermarket,
          'observations', observations
        ) order by supermarket)
        from retailer_rows
      ), '[]'::jsonb)
    )
    from scoped
  );
end;
$$;

revoke all on function public.enterprise_export_availability(uuid) from public, anon;
grant execute on function public.enterprise_export_availability(uuid) to authenticated, service_role;
