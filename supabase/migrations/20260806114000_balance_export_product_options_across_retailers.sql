create or replace function public.enterprise_export_filter_options(
  p_organization_id uuid,
  p_retailer text default null,
  p_category text default null,
  p_search text default null,
  p_limit integer default 800
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
  v_limit integer := greatest(50,least(coalesce(p_limit,800),2500));
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select s.retailers,s.brands,s.categories,os.industry_slug
  into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  if p_retailer is not null
     and coalesce(cardinality(v_retailers),0)>0
     and not exists(select 1 from unnest(v_retailers) r where lower(r)=lower(p_retailer)) then
    raise exception 'retailer_not_allowed' using errcode='42501';
  end if;

  return (
    with filtered as materialized (
      select p.id,p.supermarket,p.external_id,p.name,p.brand,p.category,
        coalesce(p.smart_category,public.smart_product_category(p.name,p.category,p.industry_slug)) smart_category,
        p.retailer_type,p.industry_slug
      from public.products p
      where exists(
        select 1 from public.price_observations po
        where po.product_id=p.id and po.crawl_run_id is not null
      )
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(
          select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(p.brand,''))
        ))
        and (coalesce(cardinality(v_categories),0)=0 or exists(
          select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(p.category,''))
        ))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (p_retailer is null or lower(p.supermarket)=lower(p_retailer))
    ), category_rows as (
      select smart_category,count(*)::integer products,count(distinct supermarket)::integer retailers
      from filtered
      where nullif(btrim(smart_category),'') is not null
      group by smart_category
    ), matching_products as materialized (
      select id,supermarket,external_id,name,brand,category,smart_category,industry_slug
      from filtered
      where p_category is not null
        and lower(coalesce(smart_category,''))=lower(p_category)
        and (
          nullif(btrim(coalesce(p_search,'')),'') is null
          or lower(name) like '%'||lower(btrim(p_search))||'%'
          or lower(coalesce(brand,'')) like '%'||lower(btrim(p_search))||'%'
          or lower(external_id) like '%'||lower(btrim(p_search))||'%'
        )
    ), retailer_rows as (
      select supermarket,count(*)::integer products
      from matching_products
      group by supermarket
    ), ranked_products as (
      select matching_products.*,
        row_number() over(
          partition by supermarket
          order by name,brand nulls last,external_id,id
        ) as retailer_rank
      from matching_products
    ), product_rows as (
      select *
      from ranked_products
      order by retailer_rank,supermarket,name,brand nulls last,external_id
      limit v_limit
    )
    select jsonb_build_object(
      'industrySlug',v_industry,
      'aiFiltered',true,
      'balancedByRetailer',true,
      'retailer',p_retailer,
      'category',p_category,
      'categories',coalesce((
        select jsonb_agg(jsonb_build_object(
          'value',smart_category,
          'label',smart_category,
          'products',products,
          'retailers',retailers
        ) order by products desc,smart_category)
        from category_rows
      ),'[]'::jsonb),
      'retailerCounts',coalesce((
        select jsonb_agg(jsonb_build_object(
          'supermarket',supermarket,
          'products',products
        ) order by products desc,supermarket)
        from retailer_rows
      ),'[]'::jsonb),
      'products',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',id,
          'externalId',external_id,
          'name',name,
          'brand',brand,
          'supermarket',supermarket,
          'category',smart_category,
          'rawCategory',category,
          'industrySlug',industry_slug
        ) order by retailer_rank,supermarket,name,brand nulls last,external_id)
        from product_rows
      ),'[]'::jsonb),
      'productCount',(select count(*)::integer from matching_products),
      'truncated',(select count(*)>v_limit from matching_products),
      'limit',v_limit
    )
  );
end;
$$;

grant execute on function public.enterprise_export_filter_options(uuid,text,text,text,integer) to authenticated;
