-- Verified from Mercado Público / SERVEL 5155-40-LE25
-- Anexo N°3 - Oferta Económica.pdf, published 2025-12-26.
-- Observed prices are explicit regional weight-band tariffs. The $/kg and $/km
-- fields below are analytical normalizations only: weight uses the band upper
-- bound; distance uses Santiago to a representative regional city (geodesic).

with destinations(dest_key, destination_label, reference_city, distance_km, p1, p2, p3, p4) as (
  values
    ('tarapaca','Región de Tarapacá','Iquique',1470.7::numeric,8078::numeric,10889::numeric,17294::numeric,31162::numeric),
    ('antofagasta','Región de Antofagasta','Antofagasta',1089.8,8078,9642,16007,27104),
    ('atacama','Región de Atacama','Copiapó',677.1,4395,6029,6029,9820),
    ('coquimbo','Región de Coquimbo','La Serena',398.2,4395,5890,7741,10147),
    ('valparaiso','Región de Valparaíso','Valparaíso',98.4,4395,5504,6652,9097),
    ('ohiggins','Región de O’Higgins','Rancagua',80.5,4395,5711,6920,9364),
    ('maule','Región del Maule','Talca',237.8,4395,5850,7028,9602),
    ('biobio','Región del Biobío','Concepción',432.6,4395,5850,7028,9602),
    ('araucania','Región de La Araucanía','Temuco',612.7,4395,5949,7840,10869),
    ('los_lagos','Región de Los Lagos','Puerto Montt',913.9,4395,7306,8662,11908),
    ('aysen','Región de Aysén','Coyhaique',1351,8078,10898,16165,29707),
    ('magallanes','Región de Magallanes','Punta Arenas',2189,8078,11879,17452,33825),
    ('metropolitana','Región Metropolitana','Santiago',0,3415,4088,4227,4692),
    ('los_rios','Región de Los Ríos','Valdivia',744.1,4395,5949,7840,10869),
    ('arica_parinacota','Región de Arica y Parinacota','Arica',1665,8078,10889,17294,31162),
    ('nuble','Región de Ñuble','Chillán',374.6,4395,5850,7028,9602),
    ('isla_pascua','Isla de Pascua','Hanga Roa',3766,8500,15610,23660,46780),
    ('juan_fernandez','Juan Fernández','San Juan Bautista',773,8500,15610,23660,46780)
), bands(band_key, weight_band, reference_weight_kg, ordinal) as (
  values
    ('0_1_4','0–1,4 kg',1.4::numeric,1),
    ('1_5_2_9','1,5–2,9 kg',2.9::numeric,2),
    ('3_5_9','3–5,9 kg',5.9::numeric,3),
    ('6_10','6–10 kg',10::numeric,4)
), expanded as (
  select d.*, b.band_key, b.weight_band, b.reference_weight_kg,
    case b.ordinal when 1 then d.p1 when 2 then d.p2 when 3 then d.p3 else d.p4 end as shipment_price_clp
  from destinations d cross join bands b
)
insert into public.b2b_rate_comparables (
  source_record_id, source, source_kind, source_url, category,
  provider_name, provider_group, buyer_name, service_type,
  origin_label, destination_label, weight_kg, distance_km,
  shipment_price_clp, price_per_kg_clp, price_per_km_clp, price_per_kg_km_clp,
  weight_band, distance_band, profile_key, comparability_level, confidence,
  normalization_method, process_date, metadata, updated_at
)
select
  'mp-servel-5155-40-le25-correos-' || dest_key || '-' || band_key,
  'mercado_publico_annex','mercado_publico_offer_rate',
  'https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs=GyIjPxWfp99UXtgDGR5gnQ%3D%3D',
  'courier','Empresa de Correos de Chile','CorreosChile','Servicio Electoral',
  'Courier Nacional · tarifa regional B2B','Santiago',destination_label,
  reference_weight_kg,nullif(distance_km,0),shipment_price_clp,
  shipment_price_clp/reference_weight_kg,
  case when distance_km>0 then shipment_price_clp/distance_km else null end,
  case when distance_km>0 then shipment_price_clp/(reference_weight_kg*distance_km) else null end,
  weight_band,public.b2b_distance_band(nullif(distance_km,0)),
  'Courier Nacional | Santiago → '||destination_label||' | '||weight_band,
  'normalized_weight_band_route',96,
  'mercado_publico_economic_annex_explicit_band + band_upper_bound_kg_normalization + geodesic_regional_reference',
  date '2025-12-26',
  jsonb_build_object(
    'sourceLayer','b2b','processId','5155-40-LE25','document','Anexo N°3 - Oferta Económica.pdf',
    'buyer','Servicio Electoral','observedOrigin','Santiago','observedDestinationScope',destination_label,
    'referenceCity',reference_city,'explicitWeightBand',weight_band,'referenceWeightKg',reference_weight_kg,
    'referenceWeightMethod','band_upper_bound_for_analytical_normalization','distanceMethod','geodesic_santiago_to_reference_city',
    'priceInterpretation','explicit CLP tariff observed in public economic offer annex',
    'methodologyNote','SERVEL annex states Santiago as origin; CorreosChile tariffs are VAT exempt; values are referential to the tariff structure and evaluation used the lower weight for each item. $/kg shown by Super Precios is a separate analytical normalization at the band upper bound.'
  ),now()
from expanded
on conflict (source_record_id) do update set
  source=excluded.source,source_kind=excluded.source_kind,source_url=excluded.source_url,
  provider_name=excluded.provider_name,provider_group=excluded.provider_group,buyer_name=excluded.buyer_name,
  service_type=excluded.service_type,origin_label=excluded.origin_label,destination_label=excluded.destination_label,
  weight_kg=excluded.weight_kg,distance_km=excluded.distance_km,shipment_price_clp=excluded.shipment_price_clp,
  price_per_kg_clp=excluded.price_per_kg_clp,price_per_km_clp=excluded.price_per_km_clp,
  price_per_kg_km_clp=excluded.price_per_kg_km_clp,weight_band=excluded.weight_band,distance_band=excluded.distance_band,
  profile_key=excluded.profile_key,comparability_level=excluded.comparability_level,confidence=excluded.confidence,
  normalization_method=excluded.normalization_method,process_date=excluded.process_date,metadata=excluded.metadata,updated_at=now();
