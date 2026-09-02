create or replace function public.b2b_pricing_timeseries(
  p_category text default 'courier'::text,
  p_days integer default 365,
  p_layer text default 'b2b'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_days integer := greatest(30, least(coalesce(p_days,365),1095));
  v_layer text := case lower(coalesce(p_layer,'b2b')) when 'b2c' then 'b2c' else 'b2b' end;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  with classified as (
    select
      r.*,
      case
        when r.source_kind in ('published_commercial_rate','public_quote','public_rate_card') then
          case
            when r.provider_group in ('Blue Express Ecommerce 1–500')
              or r.provider_group like 'Starken%'
              or r.provider_group like 'CorreosChile Aliados%'
              or r.provider_group='Chilexpress'
              or r.source in ('blue_ecommerce_1_500','starken_tarifa_simple','chilexpress_emprendedores','correos_aliados')
            then 'b2b'
            else 'b2c'
          end
        when r.source_kind in ('mercado_publico_b2b_rate','mercado_publico_offer_rate','mercado_publico_awarded_rate','mercado_publico_rate_card') then 'b2b'
        else 'other'
      end as layer,
      case
        when r.source_kind in ('mercado_publico_b2b_rate','mercado_publico_offer_rate','mercado_publico_awarded_rate','mercado_publico_rate_card')
          then 'Mercado Público'
        when r.source_kind in ('published_commercial_rate','public_quote','public_rate_card')
          and (
            r.provider_group in ('Blue Express Ecommerce 1–500')
            or r.provider_group like 'Starken%'
            or r.provider_group like 'CorreosChile Aliados%'
            or r.provider_group='Chilexpress'
            or r.source in ('blue_ecommerce_1_500','starken_tarifa_simple','chilexpress_emprendedores','correos_aliados')
          )
          then 'Pyme / Emprendedores'
        when r.source_kind in ('published_commercial_rate','public_quote','public_rate_card')
          then 'Tarifa pública'
        else 'Otro'
      end as channel,
      case
        when r.provider_group ilike 'Blue Express%' then 'Blue Express'
        when r.provider_group ilike 'Starken%' then 'Starken'
        when r.provider_group='Chilexpress' then 'Chilexpress'
        when r.provider_group ilike 'CorreosChile%' then 'CorreosChile'
        else r.provider_group
      end as company,
      case
        when r.provider_group='Blue Express Ecommerce 1–500' then true
        when r.provider_group='Chilexpress' then true
        when r.provider_group='Starken Tarifa Simple' then true
        when r.provider_group='CorreosChile Aliados Bronce 10%' then true
        when r.provider_group='Blue Express B2C / Público' then true
        when r.source_kind in ('mercado_publico_b2b_rate','mercado_publico_offer_rate','mercado_publico_awarded_rate','mercado_publico_rate_card') then true
        else false
      end as preferred_plan
    from public.b2b_rate_comparables r
    where r.category=coalesce(nullif(p_category,''),'courier')
      and coalesce(r.process_date,r.ingested_at::date)>=current_date-v_days
      and r.shipment_price_clp>0
      and r.comparability_level<>'none'
  ), scoped as (
    select *
    from classified
    where layer=v_layer
  ), daily as (
    select
      process_date as date,
      company,
      provider_group as plan,
      channel,
      preferred_plan,
      origin_label,
      destination_label,
      weight_band,
      weight_kg,
      service_type,
      percentile_cont(0.5) within group(order by shipment_price_clp) as price_clp,
      percentile_cont(0.5) within group(order by price_per_kg_clp) filter(where price_per_kg_clp>0) as price_per_kg_clp,
      count(*) as observations,
      round(avg(confidence),0) as confidence
    from scoped
    group by process_date,company,provider_group,channel,preferred_plan,origin_label,destination_label,weight_band,weight_kg,service_type
  ), points as (
    select jsonb_agg(jsonb_build_object(
      'date',date,
      'company',company,
      'plan',plan,
      'channel',channel,
      'preferredPlan',preferred_plan,
      'origin',origin_label,
      'destination',destination_label,
      'weightBand',weight_band,
      'weightKg',weight_kg,
      'serviceType',service_type,
      'priceClp',price_clp,
      'pricePerKgClp',price_per_kg_clp,
      'observations',observations,
      'confidence',confidence
    ) order by date,company,plan,destination_label,weight_kg,service_type) data
    from daily
  ), options as (
    select jsonb_build_object(
      'channels',coalesce((select jsonb_agg(x.channel order by x.channel) from (select distinct channel from scoped where channel<>'Otro') x),'[]'::jsonb),
      'companies',coalesce((select jsonb_agg(x.company order by x.company) from (select distinct company from scoped) x),'[]'::jsonb),
      'destinations',coalesce((select jsonb_agg(x.destination_label order by x.destination_label) from (select distinct destination_label from scoped where destination_label is not null and destination_label<>'') x),'[]'::jsonb),
      'weightBands',coalesce((select jsonb_agg(x.weight_band order by x.weight_band) from (select distinct weight_band from scoped where weight_band is not null and weight_band<>'') x),'[]'::jsonb),
      'services',coalesce((select jsonb_agg(x.service_type order by x.service_type) from (select distinct service_type from scoped where service_type is not null and service_type<>'') x),'[]'::jsonb),
      'plans',coalesce((select jsonb_agg(jsonb_build_object('company',company,'plan',provider_group,'preferred',preferred_plan) order by company,provider_group) from (select distinct company,provider_group,preferred_plan from scoped) x),'[]'::jsonb)
    ) data
  ), summary as (
    select jsonb_build_object(
      'layer',v_layer,
      'points',count(*),
      'companies',count(distinct company),
      'dates',count(distinct process_date),
      'firstDate',min(process_date),
      'lastDate',max(process_date)
    ) data
    from scoped
  )
  select jsonb_build_object(
    'layer',v_layer,
    'summary',coalesce((select data from summary),'{}'::jsonb),
    'options',coalesce((select data from options),'{}'::jsonb),
    'points',coalesce((select data from points),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
