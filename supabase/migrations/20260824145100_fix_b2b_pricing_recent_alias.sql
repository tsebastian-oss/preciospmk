create or replace function public.b2b_pricing_dashboard(
  p_category text default 'courier'::text,
  p_days integer default 365
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_days integer := greatest(30, least(coalesce(p_days,365), 1095));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  with filtered as (
    select *
    from public.b2b_public_observations
    where category = coalesce(nullif(p_category,''), 'courier')
      and coalesce(process_date, observed_at::date, ingested_at::date) >= current_date - v_days
  ), provider_stats as (
    select
      provider_group,
      max(provider_name) as provider_name,
      count(*) as observations,
      count(distinct buyer_name) filter (where buyer_name is not null) as buyers,
      coalesce(sum(total_amount_clp) filter (where total_amount_clp > 0),0) as amount,
      percentile_cont(0.5) within group (order by unit_price_clp) filter (where unit_price_clp > 0) as median_unit_price,
      min(unit_price_clp) filter (where unit_price_clp > 0) as min_unit_price,
      max(unit_price_clp) filter (where unit_price_clp > 0) as max_unit_price,
      max(coalesce(process_date, observed_at::date)) as latest_date
    from filtered
    group by provider_group
  ), total_market as (
    select coalesce(sum(amount),0) as amount from provider_stats
  ), providers as (
    select jsonb_agg(jsonb_build_object(
      'providerGroup', p.provider_group,
      'providerName', p.provider_name,
      'observations', p.observations,
      'buyers', p.buyers,
      'amount', p.amount,
      'sharePct', case when t.amount > 0 then round((p.amount / t.amount * 100)::numeric,1) else 0 end,
      'medianUnitPrice', p.median_unit_price,
      'minUnitPrice', p.min_unit_price,
      'maxUnitPrice', p.max_unit_price,
      'latestDate', p.latest_date
    ) order by p.amount desc, p.observations desc) as data
    from provider_stats p cross join total_market t
  ), services as (
    select jsonb_agg(jsonb_build_object(
      'serviceType', service_type,
      'observations', observations,
      'amount', amount,
      'medianUnitPrice', median_unit_price
    ) order by amount desc, observations desc) as data
    from (
      select
        coalesce(nullif(service_type,''), 'Otros servicios') as service_type,
        count(*) observations,
        coalesce(sum(total_amount_clp) filter (where total_amount_clp > 0),0) amount,
        percentile_cont(0.5) within group (order by unit_price_clp) filter (where unit_price_clp > 0) median_unit_price
      from filtered
      group by 1
      order by amount desc
      limit 12
    ) s
  ), recent as (
    select jsonb_agg(to_jsonb(r) order by r."processDate" desc nulls last, r.id desc) as data
    from (
      select id, provider_group as "providerGroup", provider_name as "providerName",
        buyer_name as "buyerName", service_type as "serviceType",
        classification_code as "classificationCode", description,
        quantity, unit, unit_price_clp as "unitPriceClp",
        total_amount_clp as "totalAmountClp", price_basis as "priceBasis",
        process_date as "processDate", source_url as "sourceUrl", source_kind as "sourceKind"
      from filtered
      order by process_date desc nulls last, id desc
      limit 100
    ) r
  ), summary as (
    select jsonb_build_object(
      'observations', count(*),
      'providers', count(distinct provider_group),
      'buyers', count(distinct buyer_name) filter (where buyer_name is not null),
      'marketAmount', coalesce(sum(total_amount_clp) filter (where total_amount_clp > 0),0),
      'medianUnitPrice', percentile_cont(0.5) within group (order by unit_price_clp) filter (where unit_price_clp > 0),
      'latestDate', max(coalesce(process_date, observed_at::date)),
      'lastIngestedAt', max(ingested_at)
    ) as data
    from filtered
  )
  select jsonb_build_object(
    'category', coalesce(nullif(p_category,''), 'courier'),
    'days', v_days,
    'summary', coalesce((select data from summary), '{}'::jsonb),
    'providers', coalesce((select data from providers), '[]'::jsonb),
    'services', coalesce((select data from services), '[]'::jsonb),
    'recent', coalesce((select data from recent), '[]'::jsonb),
    'source', 'mercado_publico_ocds'
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.b2b_pricing_dashboard(text, integer) from public;
grant execute on function public.b2b_pricing_dashboard(text, integer) to authenticated;
