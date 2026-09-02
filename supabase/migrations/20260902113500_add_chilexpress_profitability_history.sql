create or replace function public.chilexpress_profitability_history(
  p_days integer default 365,
  p_weight numeric default 0.5
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days,365),730));
  v_weight numeric := case
    when abs(coalesce(p_weight,0.5)-3)<0.01 then 3
    when abs(coalesce(p_weight,0.5)-6)<0.01 then 6
    else 0.5 end;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  with base as (
    select
      case
        when r.provider_group='Chilexpress' then 'Chilexpress'
        when r.provider_group='Starken Tarifa Simple' then 'Starken'
        when r.provider_group='Blue Express B2C / Público' then 'Blue Express'
        else null
      end as provider,
      r.destination_label,
      r.shipment_price_clp::integer as price,
      r.observed_at,
      r.source_url,
      r.service_type,
      r.delivery_type,
      row_number() over (
        partition by
          case
            when r.provider_group='Chilexpress' then 'Chilexpress'
            when r.provider_group='Starken Tarifa Simple' then 'Starken'
            when r.provider_group='Blue Express B2C / Público' then 'Blue Express'
            else null
          end,
          r.destination_label,
          (r.observed_at at time zone 'America/Santiago')::date
        order by r.observed_at desc, r.id desc
      ) as rn
    from public.chilexpress_b2c_rates r
    join public.organizations o on o.id=r.organization_id and o.slug='chilexpress'
    where r.observed_at >= now()-make_interval(days=>v_days)
      and r.origin_label='Santiago Centro'
      and abs(coalesce(r.weight_kg,0)-v_weight)<0.01
      and r.shipment_price_clp>0
      and upper(coalesce(r.delivery_type,'')) like 'DOMICILIO%'
      and (
        (r.provider_group='Chilexpress' and translate(lower(coalesce(r.service_type,'')),'áéíóú','aeiou')='estandar')
        or r.provider_group='Starken Tarifa Simple'
        or r.provider_group='Blue Express B2C / Público'
      )
  )
  select jsonb_build_object(
    'weightKg',v_weight,
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'provider',provider,
      'destination',destination_label,
      'price',price,
      'observedAt',observed_at,
      'observedDate',(observed_at at time zone 'America/Santiago')::date,
      'sourceUrl',source_url,
      'serviceType',service_type,
      'deliveryType',delivery_type
    ) order by observed_at,provider,destination_label) filter(where rn=1 and provider is not null),'[]'::jsonb)
  )
  into v_result
  from base;

  return v_result;
end;
$$;

revoke all on function public.chilexpress_profitability_history(integer,numeric) from public,anon;
grant execute on function public.chilexpress_profitability_history(integer,numeric) to authenticated,service_role;
