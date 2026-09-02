create or replace function public.brands_piwen_granular_history_page_internal(
  p_slug text default 'piwen',
  p_offset integer default 0,
  p_limit integer default 4000,
  p_family text default null
)
returns jsonb
language sql
stable
security definer
set search_path to public, pg_temp
as $$
with params as (
  select greatest(coalesce(p_offset,0),0) as off,
         least(greatest(coalesce(p_limit,4000),100),5000) as lim,
         nullif(trim(coalesce(p_family,'')),'') as family_filter
),
super_base as (
  select
    'supermarket'::text as source_key,
    'Censo supermercados'::text as source_type,
    'Supermercados'::text as channel,
    po.id::text as observation_id,
    po.crawl_run_id::text as run_id,
    cr.started_at as run_started_at,
    cr.finished_at as run_finished_at,
    cr.status::text as run_status,
    cr.trigger_type::text as trigger_type,
    po.observed_at,
    p.id::text as product_id,
    coalesce(nullif(p.external_id,''), p.id::text) as source_product_key,
    p.supermarket::text as retailer,
    coalesce(nullif(trim(p.brand),''),'Sin marca')::text as brand,
    nullif(trim(p.seller),'')::text as seller,
    p.name::text as product,
    p.url::text as url,
    po.regular_price,
    po.offer_price,
    coalesce(nullif(po.offer_price,0),nullif(po.regular_price,0)) as current_price,
    po.unit::text as captured_unit,
    po.unit_price,
    po.in_stock,
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
      else 'Otros'
    end::text as family,
    case
      when regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
        then round(((regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000)
      when regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
        then round((regexp_match(lower(replace(p.name,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric)
      else null
    end as grams,
    not (p.name ~* '(mantequilla|pasta|crema|leche|bebida|yogur|helado|chocolate|galleta|barrita|barra[[:space:]]|pan[[:space:]]|muffin|donut|tarta|torta|cereal|granola|prote[ií]na|shampoo|acondicionador|mascarilla|aceite de)') as name_is_direct
  from public.price_observations po
  join public.products p on p.id=po.product_id
  left join public.catalog_crawl_runs cr on cr.id=po.crawl_run_id
  where p.retailer_type='supermarket'
    and (
      p.name ilike '%almendr%' or p.name ilike '%pistach%' or p.name ilike '%cajú%' or p.name ilike '%caju%' or p.name ilike '%cashew%'
      or p.name ilike '%nuez%' or p.name ilike '%maní%' or p.name ilike '%mani%' or p.name ilike '%avellan%'
      or p.name ilike '%frutos secos%' or p.name ilike '%mix%' or p.name ilike '%semilla%' or p.name ilike '%pepita%'
      or p.name ilike '%pasa%' or p.name ilike '%cranber%' or p.name ilike '%arándano%' or p.name ilike '%arandano%'
      or p.name ilike '%ciruela%deshidrat%' or p.name ilike '%damasco%deshidrat%' or p.name ilike '%fruta%deshidrat%'
    )
),
super_rows as (
  select
    source_key, source_type, channel, observation_id, run_id, run_started_at, run_finished_at,
    run_status, trigger_type, observed_at, product_id, source_product_key, retailer, brand, seller,
    product, url, family, grams, regular_price, offer_price, current_price, captured_unit, unit_price,
    in_stock,
    (name_is_direct and grams between 20 and 5000 and current_price > 0) as direct_comparable,
    case when name_is_direct and grams between 20 and 5000 and current_price > 0
      then round(current_price*1000/grams,0) else null end as price_per_kg,
    case when regular_price>current_price and current_price>0
      then round((1-current_price/regular_price)*100,1) else null end as promotion_pct
  from super_base
),
brand_rows as (
  select
    case when s.domain='piwen.cl' then 'piwen_official' else 'mercadolibre' end::text as source_key,
    case when s.domain='piwen.cl' then 'Piwén.cl oficial' else 'MercadoLibre Chile' end::text as source_type,
    case when s.domain='piwen.cl' then 'D2C oficial' else 'Marketplace' end::text as channel,
    l.id::text as observation_id,
    coalesce(dr.id::text, s.domain||':'||to_char(date_trunc('second',l.observed_at),'YYYYMMDDHH24MISS')) as run_id,
    dr.started_at as run_started_at,
    dr.finished_at as run_finished_at,
    dr.status::text as run_status,
    case when dr.id is null then 'captura' else 'brand_worker' end::text as trigger_type,
    l.observed_at,
    l.product_id::text as product_id,
    l.source_product_key::text as source_product_key,
    s.retailer_name::text as retailer,
    coalesce(nullif(l.attributes->>'actualBrand',''),nullif(l.brand_name,''),'Sin marca')::text as brand,
    nullif(l.seller_name,'')::text as seller,
    l.title::text as product,
    l.product_url::text as url,
    coalesce(nullif(l.attributes->>'family',''),nullif(l.category,''),'Otros')::text as family,
    coalesce(
      nullif(l.attributes->>'grams','')::numeric,
      case
        when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
          then round(((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000)
        when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
          then round((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric)
        else null
      end
    ) as grams,
    l.regular_price,
    null::numeric as offer_price,
    l.current_price,
    null::text as captured_unit,
    null::numeric as unit_price,
    l.in_stock,
    (
      not (l.title ~* '(mantequilla|pasta|crema|leche|bebida|yogur|helado|chocolate|galleta|barrita|barra[[:space:]]|pan[[:space:]]|muffin|donut|tarta|torta|cereal|granola|prote[ií]na|shampoo|acondicionador|mascarilla|aceite de)')
      and coalesce(nullif(l.attributes->>'grams','')::numeric,
        case
          when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
            then round(((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000)
          when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
            then round((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric)
          else null
        end
      ) between 20 and 5000
      and l.current_price>0
    ) as direct_comparable,
    coalesce(
      nullif(l.attributes->>'pricePerKg','')::numeric,
      case when coalesce(nullif(l.attributes->>'grams','')::numeric,
        case
          when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
            then round(((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000)
          when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
            then round((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric)
          else null
        end
      ) between 20 and 5000 and l.current_price>0
      then round(l.current_price*1000/coalesce(nullif(l.attributes->>'grams','')::numeric,
        case
          when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg') is not null
            then round(((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*kg'))[1]::numeric)*1000)
          when regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)') is not null
            then round((regexp_match(lower(replace(l.title,',','.')), '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|gr|gramos)'))[1]::numeric)
          else null
        end
      ),0) end
    ) as price_per_kg,
    coalesce(
      nullif(l.attributes->>'discountPct','')::numeric,
      case when l.regular_price>l.current_price and l.current_price>0
        then round((1-l.current_price/l.regular_price)*100,1) else null end
    ) as promotion_pct
  from public.brands_vertical_listings l
  join public.brands_vertical_sources s on s.id=l.source_id
  join public.brands_vertical_brands b on b.id=l.brand_id
  left join lateral (
    select d.id,d.started_at,d.finished_at,d.status
    from public.brands_vertical_discovery_runs d
    where d.brand_id=l.brand_id
      and d.started_at <= l.observed_at + interval '10 minutes'
      and coalesce(d.finished_at,d.started_at+interval '2 hours') >= l.observed_at - interval '10 minutes'
    order by abs(extract(epoch from (l.observed_at-d.started_at)))
    limit 1
  ) dr on true
  where b.slug=p_slug
    and s.domain in ('piwen.cl','mercadolibre.cl')
),
unified as (
  select * from super_rows
  union all
  select * from brand_rows
),
filtered as (
  select *
  from unified, params
  where params.family_filter is null or unified.family=params.family_filter
),
paged as (
  select *
  from filtered
  order by observed_at asc, source_key asc, observation_id asc
  offset (select off from params)
  limit (select lim from params)
)
select jsonb_build_object(
  'rows',
  coalesce(jsonb_agg(jsonb_build_object(
    'sourceKey',source_key,
    'sourceType',source_type,
    'channel',channel,
    'observationId',observation_id,
    'runId',run_id,
    'runStartedAt',run_started_at,
    'runFinishedAt',run_finished_at,
    'runStatus',run_status,
    'triggerType',trigger_type,
    'observedAt',observed_at,
    'productId',product_id,
    'sourceProductKey',source_product_key,
    'retailer',retailer,
    'brand',brand,
    'seller',seller,
    'product',product,
    'family',family,
    'grams',grams,
    'regularPrice',regular_price,
    'offerPrice',offer_price,
    'currentPrice',current_price,
    'capturedUnit',captured_unit,
    'capturedUnitPrice',unit_price,
    'pricePerKg',price_per_kg,
    'promotionPct',promotion_pct,
    'inStock',in_stock,
    'directComparable',direct_comparable,
    'url',url
  ) order by observed_at asc, source_key asc, observation_id asc),'[]'::jsonb)
)
from paged;
$$;

revoke all on function public.brands_piwen_granular_history_page_internal(text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.brands_piwen_granular_history_page_internal(text,integer,integer,text) to service_role;

create or replace function public.brands_piwen_granular_history_page(
  p_slug text default 'piwen',
  p_offset integer default 0,
  p_limit integer default 4000,
  p_family text default null
)
returns jsonb
language sql
stable
security definer
set search_path to public, private, pg_temp
as $$
  select case when private.enterprise_brand_slug_allowed(p_slug)
    then public.brands_piwen_granular_history_page_internal(p_slug,p_offset,p_limit,p_family)
    else null end;
$$;

revoke all on function public.brands_piwen_granular_history_page(text,integer,integer,text) from public,anon;
grant execute on function public.brands_piwen_granular_history_page(text,integer,integer,text) to authenticated,service_role;
