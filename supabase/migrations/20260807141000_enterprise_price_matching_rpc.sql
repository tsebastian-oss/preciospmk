create or replace function public.enterprise_price_matching_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
set statement_timeout='5s'
as $$
begin
  perform public.enterprise_access_context(p_organization_id,'pricing');
  return (
    with scoped as materialized (
      select * from public.product_match_summary where supermarkets=3
    ), stats as (
      select count(*)::integer total,coalesce(max(savings_pct),0) max_savings_pct,
        coalesce(max(price_gap),0) max_price_gap,max(last_updated) last_updated
      from scoped
    ), top_rows as (
      select match_key,canonical_name,canonical_brand,category,smart_category,supermarkets,
        best_price,price_gap,savings_pct,best_supermarket,match_method,match_confidence,last_updated
      from scoped order by match_confidence desc,price_gap desc,canonical_name asc limit 5
    )
    select jsonb_build_object(
      'total',(select total from stats),'maxSavingsPct',(select max_savings_pct from stats),
      'maxPriceGap',(select max_price_gap from stats),'lastUpdated',(select last_updated from stats),
      'matches',coalesce((select jsonb_agg(to_jsonb(t) order by match_confidence desc,price_gap desc,canonical_name asc) from top_rows t),'[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.enterprise_price_matching_summary(uuid) to authenticated;
revoke all on function public.enterprise_price_matching_summary(uuid) from anon;

create or replace function public.enterprise_price_matches(
  p_organization_id uuid,
  p_page integer default 1,
  p_page_size integer default 30,
  p_query text default null,
  p_category text default null,
  p_brand text default null,
  p_min_savings numeric default 0,
  p_coverage text default 'full',
  p_quality text default 'expanded',
  p_sort text default 'gap_desc'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
set statement_timeout='5s'
as $$
declare
  v_page integer:=greatest(1,coalesce(p_page,1));
  v_page_size integer:=greatest(10,least(coalesce(p_page_size,30),50));
  v_offset integer;
  v_total integer;
  v_matches jsonb;
begin
  perform public.enterprise_access_context(p_organization_id,'pricing');
  v_offset:=(v_page-1)*v_page_size;

  with filtered as materialized (
    select * from public.product_match_summary m
    where (case when p_coverage='partial' then m.supermarkets>=2 else m.supermarkets=3 end)
      and (p_quality<>'exact' or m.match_method='exact')
      and (coalesce(p_min_savings,0)<=0 or m.savings_pct>=p_min_savings)
      and (nullif(btrim(coalesce(p_category,'')),'') is null or m.smart_category=p_category)
      and (nullif(btrim(coalesce(p_brand,'')),'') is null or m.canonical_brand=p_brand)
      and (
        nullif(btrim(coalesce(p_query,'')),'') is null
        or m.canonical_name ilike '%'||btrim(p_query)||'%'
        or coalesce(m.canonical_brand,'') ilike '%'||btrim(p_query)||'%'
        or coalesce(m.category,'') ilike '%'||btrim(p_query)||'%'
        or coalesce(m.smart_category,'') ilike '%'||btrim(p_query)||'%'
      )
  ), counted as (
    select count(*)::integer total from filtered
  ), ranked as (
    select f.* from filtered f
    order by
      case when p_sort='price_asc' then f.best_price end asc nulls last,
      case when p_sort='updated_desc' then extract(epoch from f.last_updated) end desc nulls last,
      case when p_sort='name_asc' then f.canonical_name end asc nulls last,
      case when p_sort='savings_desc' then f.savings_pct end desc nulls last,
      case when p_sort='gap_desc' or p_sort is null then f.price_gap end desc nulls last,
      f.match_confidence desc,f.canonical_name asc
    limit v_page_size offset v_offset
  )
  select (select total from counted),
    coalesce((select jsonb_agg(to_jsonb(r)) from ranked r),'[]'::jsonb)
  into v_total,v_matches;

  return jsonb_build_object(
    'matches',v_matches,'page',v_page,'pageSize',v_page_size,'total',coalesce(v_total,0),
    'totalPages',greatest(1,ceil(coalesce(v_total,0)::numeric/v_page_size)::integer),
    'coverage',case when p_coverage='partial' then 'partial' else 'full' end,
    'quality',case when p_quality='exact' then 'exact' else 'expanded' end,
    'matchingModel',case when p_quality='exact' then 'exact' else 'exact_plus_hybrid_ai' end,
    'requiredChains',case when p_coverage='partial' then '[]'::jsonb else '["Lider","Jumbo","Santa Isabel"]'::jsonb end,
    'organizationId',p_organization_id,
    'appliedFilters',jsonb_build_object('q',coalesce(p_query,''),'category',coalesce(p_category,''),'brand',coalesce(p_brand,''),'minSavings',coalesce(p_min_savings,0))
  );
end;
$$;

grant execute on function public.enterprise_price_matches(uuid,integer,integer,text,text,text,numeric,text,text,text) to authenticated;
revoke all on function public.enterprise_price_matches(uuid,integer,integer,text,text,text,numeric,text,text,text) from anon;
