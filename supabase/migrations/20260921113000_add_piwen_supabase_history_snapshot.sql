create or replace function public.brands_piwen_history_snapshot_internal(p_slug text default 'piwen')
returns jsonb
language sql
stable
security definer
set search_path to public, pg_temp
as $$
with market_base as (
  select
    d.price_date as price_date,
    case when d.brand='Alto La Cruz' then 'Alto La Cruz' else 'Millantú' end::text as brand,
    case
      when p.name ilike '%casta%caju%' or p.name ilike '%cajú%' or p.name ilike '%caju%' or p.name ilike '%cashew%' then 'Castañas de cajú'
      when p.name ilike '%pistach%' then 'Pistachos'
      when p.name ilike '%almendr%' then 'Almendras'
      else null
    end::text as family,
    d.product_id::text as product_id,
    d.supermarket::text as retailer,
    d.effective_price,
    case
      when regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
        then ((regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000
      when regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
        then (regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric
      else null
    end as grams
  from public.daily_pricing_live d
  join public.products p on p.id=d.product_id
  where d.price_date >= current_date - 180
    and d.brand in ('Alto La Cruz','Millantú')
    and d.effective_price > 0
    and (
      p.name ilike '%almendr%' or p.name ilike '%pistach%' or p.name ilike '%cajú%'
      or p.name ilike '%caju%' or p.name ilike '%cashew%'
    )
    and not (p.name ~* '(mantequilla|pasta|crema|leche|bebida|yogur|helado|chocolate|galleta|barrita|barra[[:space:]]|pan[[:space:]]|muffin|donut|tarta|torta|cereal|granola|prote[ií]na|shampoo|acondicionador|mascarilla|aceite de)')
),
market_points as (
  select
    price_date,
    brand,
    family,
    round(percentile_cont(0.5) within group (order by effective_price*1000/grams))::int as price_per_kg,
    count(distinct product_id)::int as sku_count,
    count(distinct retailer)::int as retailers,
    'market_census'::text as source
  from market_base
  where family is not null and grams between 20 and 5000
  group by price_date,brand,family
),
official_base as (
  select
    (l.observed_at at time zone 'America/Santiago')::date as price_date,
    'Piwén'::text as brand,
    coalesce(
      nullif(l.attributes->>'family',''),
      case
        when l.title ilike '%casta%caju%' or l.title ilike '%cajú%' or l.title ilike '%caju%' or l.title ilike '%cashew%' then 'Castañas de cajú'
        when l.title ilike '%pistach%' then 'Pistachos'
        when l.title ilike '%almendr%' then 'Almendras'
        else null
      end
    )::text as family,
    l.source_product_key::text as product_id,
    l.current_price,
    coalesce(
      nullif(l.attributes->>'grams','')::numeric,
      case
        when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
          then ((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000
        when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
          then (regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric
        else null
      end
    ) as grams
  from public.brands_vertical_listings l
  join public.brands_vertical_sources s on s.id=l.source_id
  join public.brands_vertical_brands b on b.id=l.brand_id
  where b.slug=p_slug
    and s.domain='piwen.cl'
    and l.observed_at >= now() - interval '180 days'
    and l.current_price > 0
    and not (l.title ~* '(mantequilla|pasta|crema|leche|bebida|yogur|helado|chocolate|galleta|barrita|barra[[:space:]]|pan[[:space:]]|muffin|donut|tarta|torta|cereal|granola|prote[ií]na|shampoo|acondicionador|mascarilla|aceite de)')
),
official_points as (
  select
    price_date,
    brand,
    family,
    round(percentile_cont(0.5) within group (order by current_price*1000/grams))::int as price_per_kg,
    count(distinct product_id)::int as sku_count,
    1::int as retailers,
    'official_d2c'::text as source
  from official_base
  where family in ('Almendras','Castañas de cajú','Pistachos')
    and grams between 20 and 5000
  group by price_date,brand,family
),
points as (
  select * from market_points
  union all
  select * from official_points
),
bounds as (
  select min(price_date) as from_date,max(price_date) as to_date from points
)
select jsonb_build_object(
  'from',b.from_date,
  'to',b.to_date,
  'brands',jsonb_build_array('Piwén','Alto La Cruz','Millantú'),
  'families',jsonb_build_array('Almendras','Castañas de cajú','Pistachos'),
  'points',coalesce((
    select jsonb_agg(jsonb_build_object(
      'date',x.price_date,
      'brand',x.brand,
      'family',x.family,
      'pricePerKg',x.price_per_kg,
      'skuCount',x.sku_count,
      'retailers',x.retailers,
      'source',x.source
    ) order by x.price_date,x.family,x.brand)
    from points x
  ),'[]'::jsonb),
  'methodology','Supabase: Piwén usa la mediana diaria de SKU comparables capturados desde Piwén.cl. Alto La Cruz y Millantú usan la mediana diaria de SKU comparables del censo de supermercados. Todos los valores se normalizan a precio por kilo.',
  'piwenBasis',jsonb_build_object(
    'Almendras','Mediana diaria de SKU comparables en Piwén.cl',
    'Castañas de cajú','Mediana diaria de SKU comparables en Piwén.cl',
    'Pistachos','Mediana diaria de SKU comparables en Piwén.cl'
  )
)
from bounds b;
$$;

revoke all on function public.brands_piwen_history_snapshot_internal(text) from public,anon,authenticated;
grant execute on function public.brands_piwen_history_snapshot_internal(text) to service_role;

create or replace function public.brands_piwen_history_snapshot(p_slug text default 'piwen')
returns jsonb
language sql
stable
security definer
set search_path to public, private, pg_temp
as $$
  select case when private.enterprise_brand_slug_allowed(p_slug)
    then public.brands_piwen_history_snapshot_internal(p_slug) else null end;
$$;

revoke all on function public.brands_piwen_history_snapshot(text) from public,anon;
grant execute on function public.brands_piwen_history_snapshot(text) to authenticated,service_role;
