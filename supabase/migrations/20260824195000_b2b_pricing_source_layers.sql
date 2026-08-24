create or replace function public.b2b_pricing_comparables_v2(
  p_category text default 'courier',
  p_days integer default 365,
  p_layer text default 'public'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_days integer := greatest(30, least(coalesce(p_days,365),1095));
  v_layer text := case lower(coalesce(p_layer,'public')) when 'b2b' then 'b2b' when 'best' then 'best' else 'public' end;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  with raw as (
    select r.*,
      case
        when r.source_kind in ('published_commercial_rate','public_quote','public_rate_card') then 'public'
        when r.source_kind in ('mercado_publico_b2b_rate','mercado_publico_offer_rate','mercado_publico_awarded_rate','mercado_publico_rate_card') then 'b2b'
        else 'other'
      end as source_layer
    from public.b2b_rate_comparables r
    where r.category=coalesce(nullif(p_category,''),'courier')
      and coalesce(r.process_date,r.ingested_at::date)>=current_date-v_days
      and r.shipment_price_clp>0
      and r.comparability_level<>'none'
  ), latest_public as (
    select x.* from (
      select raw.*, row_number() over(
        partition by source, provider_group, profile_key
        order by process_date desc nulls last, updated_at desc, id desc
      ) rn
      from raw where source_layer='public'
    ) x where rn=1
  ), b2b_rows as (
    select raw.*, 1::bigint rn from raw where source_layer='b2b'
  ), candidates as (
    select * from latest_public
    union all
    select * from b2b_rows
  ), layer_base as (
    select c.*
    from candidates c
    where (v_layer='public' and c.source_layer='public')
       or (v_layer='b2b' and c.source_layer='b2b')
       or v_layer='best'
  ), selected as (
    select y.* from (
      select lb.*,
        row_number() over(
          partition by profile_key, provider_group
          order by
            case when v_layer='best' then shipment_price_clp else 0 end asc,
            confidence desc,
            process_date desc nulls last,
            updated_at desc,
            id desc
        ) layer_rank
      from layer_base lb
    ) y
    where v_layer<>'best' or y.layer_rank=1
  ), profile_stats as (
    select profile_key,max(service_type) service_type,max(weight_band) weight_band,max(distance_band) distance_band,
      max(weight_kg) reference_weight_kg,max(distance_km) reference_distance_km,count(*) observations,count(distinct provider_group) providers,
      percentile_cont(0.5) within group(order by shipment_price_clp) market_median_shipment_price,
      percentile_cont(0.5) within group(order by price_per_kg_clp) filter(where price_per_kg_clp>0) market_median_price_per_kg,
      percentile_cont(0.5) within group(order by price_per_km_clp) filter(where price_per_km_clp>0) market_median_price_per_km,
      percentile_cont(0.5) within group(order by price_per_kg_km_clp) filter(where price_per_kg_km_clp>0) market_median_price_per_kg_km,
      max(process_date) latest_date
    from selected group by profile_key
  ), provider_profile as (
    select s.profile_key,max(s.service_type) service_type,max(s.weight_band) weight_band,max(s.distance_band) distance_band,
      max(s.weight_kg) reference_weight_kg,max(s.distance_km) reference_distance_km,s.provider_group,max(s.provider_name) provider_name,count(*) observations,
      percentile_cont(0.5) within group(order by s.shipment_price_clp) median_shipment_price,
      percentile_cont(0.5) within group(order by s.price_per_kg_clp) filter(where s.price_per_kg_clp>0) median_price_per_kg,
      percentile_cont(0.5) within group(order by s.price_per_km_clp) filter(where s.price_per_km_clp>0) median_price_per_km,
      percentile_cont(0.5) within group(order by s.price_per_kg_km_clp) filter(where s.price_per_kg_km_clp>0) median_price_per_kg_km,
      max(s.process_date) latest_date,round(avg(s.confidence),0) confidence,max(s.origin_label) origin_label,max(s.destination_label) destination_label,
      array_agg(distinct s.source_kind) source_kinds,array_agg(distinct s.source_layer) source_layers,array_agg(distinct s.normalization_method) normalization_methods
    from selected s group by s.profile_key,s.provider_group
  ), rows as (
    select jsonb_agg(jsonb_build_object(
      'profileKey',pp.profile_key,'serviceType',pp.service_type,'weightBand',pp.weight_band,'distanceBand',pp.distance_band,
      'referenceWeightKg',pp.reference_weight_kg,'referenceDistanceKm',pp.reference_distance_km,'providerGroup',pp.provider_group,'providerName',pp.provider_name,
      'observations',pp.observations,'medianShipmentPrice',pp.median_shipment_price,'medianPricePerKg',pp.median_price_per_kg,
      'medianPricePerKm',pp.median_price_per_km,'medianPricePerKgKm',pp.median_price_per_kg_km,
      'marketMedianShipmentPrice',ps.market_median_shipment_price,'marketMedianPricePerKg',ps.market_median_price_per_kg,
      'marketMedianPricePerKm',ps.market_median_price_per_km,'marketMedianPricePerKgKm',ps.market_median_price_per_kg_km,
      'providersInProfile',ps.providers,
      'indexVsMarket',case when ps.providers>=2 and ps.market_median_shipment_price>0 then round((pp.median_shipment_price/ps.market_median_shipment_price*100)::numeric,1) else null end,
      'latestDate',pp.latest_date,'confidence',pp.confidence,'originLabel',pp.origin_label,'destinationLabel',pp.destination_label,
      'sourceKinds',to_jsonb(pp.source_kinds),'sourceLayers',to_jsonb(pp.source_layers),'normalizationMethods',to_jsonb(pp.normalization_methods)
    ) order by ps.providers desc,pp.profile_key,pp.median_shipment_price) data
    from provider_profile pp join profile_stats ps using(profile_key)
  ), profiles as (
    select jsonb_agg(jsonb_build_object(
      'profileKey',profile_key,'serviceType',service_type,'weightBand',weight_band,'distanceBand',distance_band,
      'referenceWeightKg',reference_weight_kg,'referenceDistanceKm',reference_distance_km,'observations',observations,'providers',providers,
      'marketMedianShipmentPrice',market_median_shipment_price,'marketMedianPricePerKg',market_median_price_per_kg,
      'marketMedianPricePerKm',market_median_price_per_km,'marketMedianPricePerKgKm',market_median_price_per_kg_km,'latestDate',latest_date
    ) order by providers desc,observations desc) data from profile_stats
  ), summary as (
    select jsonb_build_object(
      'layer',v_layer,'comparableRows',count(*),'fullRows',count(*) filter(where comparability_level='full'),
      'providers',count(distinct provider_group),'profiles',count(distinct profile_key),
      'competitiveProfiles',(select count(*) from profile_stats where providers>=2),'latestDate',max(process_date),
      'publicRows',count(*) filter(where source_layer='public'),'b2bRows',count(*) filter(where source_layer='b2b')
    ) data from selected
  )
  select jsonb_build_object(
    'layer',v_layer,
    'summary',coalesce((select data from summary),'{}'::jsonb),
    'profiles',coalesce((select data from profiles),'[]'::jsonb),
    'rows',coalesce((select data from rows),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

grant execute on function public.b2b_pricing_comparables_v2(text,integer,text) to authenticated;
