create or replace function public.normalize_match_brand(input_text text)
returns text
language sql
immutable parallel safe
as $$
  select trim(regexp_replace(
    lower(translate(coalesce(input_text,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),
    '[^a-z0-9]+',' ','g'
  ));
$$;

create or replace function public.product_measure_signature(input_text text)
returns text
language sql
immutable parallel safe
as $$
  with raw as (
    select replace((m)[1],',','.')::numeric as amount, lower((m)[2]) as unit
    from regexp_matches(
      lower(translate(coalesce(input_text,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),
      '([0-9]+(?:[.,][0-9]+)?)\s*(kg|kilogramos?|g|gr|gramos?|l|lt|litros?|ml|cc)\y','g'
    ) m
  ), normalized as (
    select case
      when unit in ('kg','kilogramo','kilogramos') then 'g:'||to_char(amount*1000,'FM999999990.###')
      when unit in ('g','gr','gramo','gramos') then 'g:'||to_char(amount,'FM999999990.###')
      when unit in ('l','lt','litro','litros') then 'ml:'||to_char(amount*1000,'FM999999990.###')
      else 'ml:'||to_char(amount,'FM999999990.###')
    end as token
    from raw
  )
  select string_agg(distinct token,'|' order by token) from normalized;
$$;

create or replace function public.product_pack_signature(input_text text)
returns text
language sql
immutable parallel safe
as $$
  with normalized as (
    select lower(translate(coalesce(input_text,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')) as value
  ), counts as (
    select ((m)[1])::int as qty
    from normalized, lateral regexp_matches(value,'([0-9]{1,3})\s*(?:un|unidad|unidades)\y','g') m
    union
    select ((m)[1])::int
    from normalized, lateral regexp_matches(value,'(?:pack|paq(?:uete)?)\s*(?:de\s*)?([0-9]{1,3})\y','g') m
    union
    select ((m)[1])::int
    from normalized, lateral regexp_matches(value,'([0-9]{1,3})\s*x\s*[0-9]+(?:[.,][0-9]+)?\s*(?:kg|g|gr|l|lt|ml|cc)\y','g') m
  )
  select string_agg(distinct qty::text,'|' order by qty::text) from counts where qty>0;
$$;

create or replace function public.product_match_tokens(input_text text, brand_text text default null)
returns text[]
language sql
immutable parallel safe
as $$
  with brand_tokens as (
    select regexp_split_to_table(public.normalize_match_brand(brand_text),'\s+') as token
  ), name_tokens as (
    select token
    from regexp_split_to_table(public.normalize_product_match_key(input_text),'\s+') token
    where length(token)>=2
      and token !~ '^[0-9]+$'
      and token not in ('de','del','la','el','los','las','con','sin','para','por','en','y','un','una','tipo','sabor','envase','botella','bolsa','caja','pack','producto')
  )
  select coalesce(array_agg(distinct n.token order by n.token),'{}'::text[])
  from name_tokens n
  where not exists(select 1 from brand_tokens b where b.token=n.token);
$$;

create or replace function public.product_token_jaccard(a text[], b text[])
returns numeric
language sql
immutable parallel safe
as $$
  with aa as (select distinct unnest(coalesce(a,'{}'::text[])) token),
       bb as (select distinct unnest(coalesce(b,'{}'::text[])) token),
       inters as (select count(*)::numeric n from aa join bb using(token)),
       unions as (select count(*)::numeric n from (select token from aa union select token from bb) u)
  select case when (select n from unions)=0 then 0 else (select n from inters)/(select n from unions) end;
$$;

drop materialized view if exists public.product_match_features;

create materialized view public.product_match_features as
select
  d.id as product_id,
  d.supermarket,
  d.external_id,
  d.name,
  d.brand,
  d.category,
  p.smart_category,
  d.url,
  d.image_url,
  d.regular_price,
  d.offer_price,
  d.in_stock,
  d.observed_at,
  public.normalize_product_match_key(coalesce(d.brand,'')||' '||d.name) as exact_match_key,
  public.normalize_match_brand(d.brand) as brand_key,
  public.product_measure_signature(d.name) as measure_signature,
  public.product_pack_signature(d.name) as pack_signature,
  public.product_match_tokens(d.name,d.brand) as match_tokens,
  public.normalize_product_match_key(d.name) as normalized_name
from public.dashboard_products d
join public.products p on p.id=d.id
where d.supermarket in ('Lider','Jumbo','Santa Isabel')
  and d.offer_price>0
  and coalesce(d.brand,'')<>''
  and length(public.normalize_product_match_key(d.name))>=6;

create unique index product_match_features_product_idx on public.product_match_features(product_id);
create index product_match_features_chain_brand_category_idx on public.product_match_features(supermarket,brand_key,smart_category);
create index product_match_features_exact_key_idx on public.product_match_features(exact_match_key);
create index product_match_features_name_trgm_idx on public.product_match_features using gin(normalized_name gin_trgm_ops);

grant select on public.product_match_features to anon, authenticated, service_role;

drop materialized view if exists public.product_match_fuzzy_assignments;

create materialized view public.product_match_fuzzy_assignments as
with exact_full_keys as (
  select exact_match_key
  from public.product_match_features
  group by exact_match_key
  having count(distinct supermarket)=3
), paired_keys as (
  select exact_match_key
  from public.product_match_features
  where supermarket in ('Jumbo','Santa Isabel')
  group by exact_match_key
  having count(distinct supermarket)=2
     and exact_match_key not in (select exact_match_key from exact_full_keys)
), cencosud_groups as (
  select distinct on (f.exact_match_key)
    f.exact_match_key as target_match_key,
    f.normalized_name,
    f.brand_key,
    f.smart_category,
    f.measure_signature,
    f.pack_signature,
    f.match_tokens
  from public.product_match_features f
  join paired_keys p using(exact_match_key)
  where f.supermarket in ('Jumbo','Santa Isabel')
  order by f.exact_match_key,case f.supermarket when 'Jumbo' then 1 else 2 end,f.observed_at desc
), raw_candidates as (
  select
    g.target_match_key,
    l.product_id as lider_product_id,
    similarity(g.normalized_name,l.normalized_name) as trigram_similarity,
    public.product_token_jaccard(g.match_tokens,l.match_tokens) as token_jaccard,
    (
      0.56*similarity(g.normalized_name,l.normalized_name)
      +0.28*public.product_token_jaccard(g.match_tokens,l.match_tokens)
      +case
        when g.measure_signature=l.measure_signature and g.measure_signature is not null then 0.12
        when g.measure_signature is null and l.measure_signature is null then 0.03
        else 0
      end
      +case
        when g.pack_signature=l.pack_signature and g.pack_signature is not null then 0.04
        when g.pack_signature is null and l.pack_signature is null then 0.02
        else 0
      end
    )::numeric as confidence_score
  from cencosud_groups g
  join public.product_match_features l
    on l.supermarket='Lider'
   and l.brand_key=g.brand_key
  where g.brand_key<>''
    and l.exact_match_key not in (select exact_match_key from exact_full_keys)
    and (g.smart_category=l.smart_category or g.smart_category is null or l.smart_category is null)
    and not (g.measure_signature is not null and l.measure_signature is not null and g.measure_signature<>l.measure_signature)
    and not (g.pack_signature is not null and l.pack_signature is not null and g.pack_signature<>l.pack_signature)
), ranked as (
  select
    r.*,
    row_number() over(partition by target_match_key order by confidence_score desc,trigram_similarity desc,lider_product_id) as group_rank,
    row_number() over(partition by lider_product_id order by confidence_score desc,trigram_similarity desc,target_match_key) as lider_rank,
    lead(confidence_score) over(partition by target_match_key order by confidence_score desc,trigram_similarity desc,lider_product_id) as group_second_score,
    lead(confidence_score) over(partition by lider_product_id order by confidence_score desc,trigram_similarity desc,target_match_key) as lider_second_score
  from raw_candidates r
)
select
  target_match_key,
  lider_product_id,
  round(confidence_score,4) as confidence_score,
  round(trigram_similarity::numeric,4) as trigram_similarity,
  round(token_jaccard,4) as token_jaccard,
  'hybrid_ai'::text as match_method
from ranked
where group_rank=1
  and lider_rank=1
  and confidence_score>=0.68
  and trigram_similarity>=0.55
  and token_jaccard>=0.38
  and (group_second_score is null or confidence_score-group_second_score>=0.03)
  and (lider_second_score is null or confidence_score-lider_second_score>=0.03);

create unique index product_match_fuzzy_target_idx on public.product_match_fuzzy_assignments(target_match_key);
create unique index product_match_fuzzy_lider_idx on public.product_match_fuzzy_assignments(lider_product_id);
create index product_match_fuzzy_confidence_idx on public.product_match_fuzzy_assignments(confidence_score desc);

grant select on public.product_match_fuzzy_assignments to anon, authenticated, service_role;
