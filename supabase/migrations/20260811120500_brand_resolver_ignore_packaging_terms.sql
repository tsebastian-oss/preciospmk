create or replace function public.enterprise_brand_resolver_candidates(p_organization_id uuid, p_query text, p_retailer_type text default 'all'::text, p_supermarket text default null::text, p_category text default null::text, p_limit integer default 24)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
set statement_timeout to '15s'
as $function$
declare
  v_access jsonb;
  v_retailers text[] := '{}'::text[];
  v_brands text[] := '{}'::text[];
  v_categories text[] := '{}'::text[];
  v_industry text;
  v_type text := nullif(btrim(coalesce(p_retailer_type,'')), '');
  v_store text := nullif(btrim(coalesce(p_supermarket,'')), '');
  v_category text := nullif(btrim(coalesce(p_category,'')), '');
  v_q text := btrim(regexp_replace(translate(lower(coalesce(p_query,'')),'áéíóúüñ','aeiouun'),'[^[:alnum:]]+',' ','g'));
  v_limit integer := greatest(5, least(coalesce(p_limit,24), 40));
begin
  v_access := public.enterprise_access_context(p_organization_id,'pricing');
  select coalesce(array_agg(value),'{}'::text[]) into v_retailers from jsonb_array_elements_text(coalesce(v_access->'retailers','[]'::jsonb)) t(value);
  select coalesce(array_agg(value),'{}'::text[]) into v_brands from jsonb_array_elements_text(coalesce(v_access->'brands','[]'::jsonb)) t(value);
  select coalesce(array_agg(value),'{}'::text[]) into v_categories from jsonb_array_elements_text(coalesce(v_access->'categories','[]'::jsonb)) t(value);
  v_industry := nullif(v_access->>'industrySlug','');
  if v_type = 'all' then v_type := null; end if;
  if v_q = '' then return jsonb_build_object('query',p_query,'normalizedQuery',v_q,'candidates','[]'::jsonb); end if;

  return (
    with brand_scope as materialized (
      select f.brand, sum(f.products)::integer products,
        btrim(regexp_replace(translate(lower(f.brand),'áéíóúüñ','aeiouun'),'[^[:alnum:]]+',' ','g')) as norm
      from public.product_filter_facets f
      where nullif(btrim(f.brand),'') is not null
        and (coalesce(cardinality(v_retailers),0)=0 or f.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or f.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or f.category=any(v_categories))
        and (v_industry is null or v_industry='all' or public.product_industry_allowed(v_industry,f.industry_slug,f.retailer_type))
        and (v_type is null or f.retailer_type=v_type)
        and (v_store is null or f.supermarket=v_store)
        and (v_category is null or f.category=v_category)
      group by f.brand
    ),
    tokens as materialized (
      select token
      from regexp_split_to_table(v_q,' +') token
      where length(token)>=3
        and token not in (
          'como','esta','marca','precio','precios','quiero','saber','dime','analiza','analizar','compara','comparar','versus','frente','contra','productos','producto','cuanto','sale','vale','mapa','posicionada','posicionado',
          'lata','latas','botella','botellas','pack','packs','multipack','caja','cajas','bolsa','bolsas','frasco','frascos','pote','potes','sachet','sachets','unidad','unidades','individual','individuales','formato','formatos','tamano','tamanos','ml','litro','litros'
        )
    ),
    scored as (
      select b.brand,b.products,
        greatest(
          case when b.norm=v_q then 1.0 else 0 end,
          case when strpos(' '||v_q||' ',' '||b.norm||' ')>0 then 0.99 else 0 end,
          case when replace(b.norm,' ','')=replace(v_q,' ','') then 0.985 else 0 end,
          case when exists(select 1 from tokens) then extensions.word_similarity(b.norm,v_q) else 0 end,
          case when exists(select 1 from tokens) then extensions.similarity(b.norm,v_q) else 0 end,
          coalesce((select max(greatest(extensions.similarity(b.norm,t.token),extensions.word_similarity(b.norm,t.token))) from tokens t),0)
        )::numeric as score,
        case
          when b.norm=v_q then 'exact'
          when strpos(' '||v_q||' ',' '||b.norm||' ')>0 then 'phrase'
          when replace(b.norm,' ','')=replace(v_q,' ','') then 'normalized_exact'
          else 'fuzzy'
        end as match_type
      from brand_scope b
    ),
    ranked as (
      select * from scored where score >= 0.22 order by score desc, products desc, brand limit v_limit
    )
    select jsonb_build_object(
      'query',p_query,
      'normalizedQuery',v_q,
      'candidates',coalesce(jsonb_agg(jsonb_build_object('brand',brand,'products',products,'score',round(score,4),'matchType',match_type) order by score desc,products desc,brand),'[]'::jsonb)
    ) from ranked
  );
end;
$function$;
