create or replace function public.brands_piwen_supermarket_snapshot_internal(p_slug text default 'piwen')
returns jsonb
language sql
stable
security definer
set search_path to public, pg_temp
as $$
with base as (
  select
    p.id,
    p.supermarket as retailer,
    coalesce(nullif(trim(p.brand),''),'Sin marca') as brand,
    p.name,
    p.url,
    s.regular_price,
    s.offer_price,
    s.in_stock,
    s.observed_at,
    case
      when p.name ilike '%casta%caju%' or p.name ilike '%cajú%' or p.name ilike '%caju%' or p.name ilike '%cashew%' then 'Castañas de cajú'
      when p.name ilike '%pistach%' then 'Pistachos'
      when p.name ilike '%almendr%' then 'Almendras'
      when p.name ilike '%avellan%' then 'Avellanas'
      when p.name ilike '%nuez%' then 'Nueces'
      when p.name ilike '%maní%' or p.name ilike '%mani%' then 'Maní'
      when p.name ilike '%mix%' or p.name ilike '%frutos secos%' or p.name ilike '%trail mix%' then 'Mixes'
      when p.name ilike '%semilla%' or p.name ilike '%pepita%' then 'Semillas'
      when p.name ilike '%pasa%' or p.name ilike '%cranber%' or p.name ilike '%arándano%' or p.name ilike '%arandano%'
        or p.name ilike '%ciruela%deshidrat%' or p.name ilike '%damasco%deshidrat%' or p.name ilike '%fruta%deshidrat%' then 'Fruta deshidratada'
      else null
    end as family
  from public.products p
  join public.product_latest_price_state s on s.product_id=p.id
  where p.retailer_type='supermarket'
    and s.observed_at >= now() - interval '60 days'
    and coalesce(nullif(s.offer_price,0),nullif(s.regular_price,0)) > 0
    and (
      p.name ilike '%almendr%' or p.name ilike '%pistach%' or p.name ilike '%cajú%' or p.name ilike '%caju%' or p.name ilike '%cashew%'
      or p.name ilike '%nuez%' or p.name ilike '%maní%' or p.name ilike '%mani%' or p.name ilike '%avellan%'
      or p.name ilike '%frutos secos%' or p.name ilike '%mix%' or p.name ilike '%semilla%' or p.name ilike '%pepita%'
      or p.name ilike '%pasa%' or p.name ilike '%cranber%' or p.name ilike '%arándano%' or p.name ilike '%arandano%'
      or p.name ilike '%ciruela%deshidrat%' or p.name ilike '%damasco%deshidrat%' or p.name ilike '%fruta%deshidrat%'
    )
    and p.name !~* '(mantequilla|pasta|crema|leche|bebida|yogur|helado|chocolate|galleta|barrita|barra[[:space:]]|pan[[:space:]]|muffin|donut|tarta|torta|cereal|granola|prote[ií]na|shampoo|acondicionador|mascarilla|aceite de)'
),
parsed as (
  select *,
    case
      when regexp_match(lower(replace(name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
        then round(((regexp_match(lower(replace(name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000)
      when regexp_match(lower(replace(name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
        then round((regexp_match(lower(replace(name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric)
      else null
    end as grams,
    coalesce(nullif(offer_price,0),nullif(regular_price,0)) as current_price
  from base
  where family is not null
),
comparable as (
  select *,
    case when grams between 20 and 5000 then round(current_price*1000/grams) else null end as price_per_kg,
    case when regular_price>current_price and current_price>0
      then round((1-current_price/regular_price)*100,1) else null end as promotion_pct
  from parsed
  where grams between 20 and 5000
),
summary as (
  select
    count(*)::int products,
    count(distinct brand)::int brands,
    count(distinct retailer)::int retailers,
    max(observed_at) observed_at
  from comparable
)
select jsonb_build_object(
  'status',case when s.products>0 then 'available' else 'empty' end,
  'source','Supermercados monitoreados',
  'observedAt',s.observed_at,
  'products',s.products,
  'brands',s.brands,
  'retailers',s.retailers,
  'listings',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',x.id,
      'retailer',x.retailer,
      'brand',x.brand,
      'name',x.name,
      'family',x.family,
      'grams',x.grams,
      'format',case when x.grams>=1000 and mod(x.grams,1000)=0 then (x.grams/1000)::text||' kg' else x.grams::text||' g' end,
      'currentPrice',x.current_price,
      'regularPrice',case when x.regular_price>0 then x.regular_price else null end,
      'pricePerKg',x.price_per_kg,
      'promotionPct',x.promotion_pct,
      'inStock',x.in_stock,
      'observedAt',x.observed_at,
      'url',x.url
    ) order by x.retailer,x.family,x.brand,x.name)
    from comparable x
  ),'[]'::jsonb)
)
from summary s;
$$;

revoke all on function public.brands_piwen_supermarket_snapshot_internal(text) from public,anon,authenticated;
grant execute on function public.brands_piwen_supermarket_snapshot_internal(text) to service_role;

create or replace function public.brands_piwen_supermarket_snapshot(p_slug text default 'piwen')
returns jsonb
language sql
stable
security definer
set search_path to public, private, pg_temp
as $$
  select case when private.enterprise_brand_slug_allowed(p_slug)
    then public.brands_piwen_supermarket_snapshot_internal(p_slug) else null end;
$$;

revoke all on function public.brands_piwen_supermarket_snapshot(text) from public,anon;
grant execute on function public.brands_piwen_supermarket_snapshot(text) to authenticated,service_role;
