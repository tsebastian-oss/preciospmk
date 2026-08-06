create table if not exists public.enterprise_export_category_stats (
  organization_id uuid not null,
  smart_category text not null,
  supermarket text not null,
  products integer not null,
  refreshed_at timestamptz not null default now(),
  primary key(organization_id,smart_category,supermarket)
);

revoke all on table public.enterprise_export_category_stats from public,anon,authenticated;

create index if not exists products_export_category_store_name_idx
on public.products(smart_category,supermarket,name,id)
where smart_category is not null;

create or replace function public.refresh_enterprise_export_category_stats(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
set statement_timeout='120s'
as $$
declare v_retailers text[]; v_brands text[]; v_categories text[]; v_industry text;
begin
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  delete from public.enterprise_export_category_stats where organization_id=p_organization_id;
  insert into public.enterprise_export_category_stats(organization_id,smart_category,supermarket,products,refreshed_at)
  select p_organization_id,p.smart_category,p.supermarket,count(*)::integer,clock_timestamp()
  from public.products p
  where nullif(btrim(p.smart_category),'') is not null
    and exists(select 1 from public.price_observations po where po.product_id=p.id and po.crawl_run_id is not null)
    and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
    and (coalesce(cardinality(v_brands),0)=0 or p.brand=any(v_brands))
    and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,p.category)=any(v_categories))
    and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
  group by p.smart_category,p.supermarket;
end;
$$;

create or replace function public.refresh_all_enterprise_ui_metadata_cache()
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
set statement_timeout='240s'
as $$
declare r record;
begin
  for r in select organization_id from public.organization_scopes loop
    perform public.refresh_enterprise_ui_metadata_cache(r.organization_id);
    perform public.refresh_enterprise_export_category_stats(r.organization_id);
  end loop;
end;
$$;

create or replace function public.enterprise_export_filter_options(
  p_organization_id uuid,
  p_retailer text default null,
  p_category text default null,
  p_search text default null,
  p_limit integer default 800
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
set statement_timeout='15s'
as $$
declare
  v_retailers text[]; v_brands text[]; v_categories text[]; v_industry text;
  v_limit integer:=greatest(50,least(coalesce(p_limit,800),2500));
  v_cached_categories jsonb:='[]'::jsonb;
  v_retailer_count integer:=1;
  v_per_retailer integer:=v_limit;
  v_has_search boolean:=nullif(btrim(coalesce(p_search,'')),'') is not null;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  if p_retailer is not null and coalesce(cardinality(v_retailers),0)>0 and not p_retailer=any(v_retailers) then
    raise exception 'retailer_not_allowed' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'value',x->>'label','label',x->>'label','products',coalesce((x->>'products')::integer,0),'retailers',coalesce((x->>'retailers')::integer,0)
  ) order by coalesce((x->>'products')::integer,0) desc,x->>'label'),'[]'::jsonb)
  into v_cached_categories
  from public.enterprise_ui_metadata_cache c
  cross join lateral jsonb_array_elements(coalesce(c.filter_options->'categories','[]'::jsonb)) x
  where c.organization_id=p_organization_id and x->>'kind'='smart';

  if p_category is not null then
    select greatest(1,count(*))::integer into v_retailer_count
    from public.enterprise_export_category_stats s
    where s.organization_id=p_organization_id and s.smart_category=p_category
      and (p_retailer is null or s.supermarket=p_retailer);
    v_per_retailer:=greatest(10,ceil(v_limit::numeric/v_retailer_count)::integer);
  end if;

  return (
    with cached_stats as materialized (
      select s.supermarket,s.products
      from public.enterprise_export_category_stats s
      where s.organization_id=p_organization_id and p_category is not null and s.smart_category=p_category
        and (p_retailer is null or s.supermarket=p_retailer)
    ), search_counts as materialized (
      select p.supermarket,count(*)::integer products
      from public.products p
      where p_category is not null and v_has_search
        and p.smart_category=p_category
        and (p_retailer is null or p.supermarket=p_retailer)
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or p.brand=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,p.category)=any(v_categories))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and exists(select 1 from public.price_observations po where po.product_id=p.id and po.crawl_run_id is not null)
        and (p.name ilike '%'||btrim(p_search)||'%' or coalesce(p.brand,'') ilike '%'||btrim(p_search)||'%' or p.external_id ilike '%'||btrim(p_search)||'%')
      group by p.supermarket
    ), effective_counts as materialized (
      select * from search_counts where v_has_search
      union all
      select * from cached_stats where not v_has_search
    ), product_rows as materialized (
      select sample.*
      from effective_counts stores
      cross join lateral (
        select p.id,p.supermarket,p.external_id,p.name,p.brand,p.category,p.smart_category,p.industry_slug
        from public.products p
        where p.smart_category=p_category and p.supermarket=stores.supermarket
          and (coalesce(cardinality(v_brands),0)=0 or p.brand=any(v_brands))
          and (coalesce(cardinality(v_categories),0)=0 or coalesce(p.smart_category,p.category)=any(v_categories))
          and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
          and exists(select 1 from public.price_observations po where po.product_id=p.id and po.crawl_run_id is not null)
          and (not v_has_search or p.name ilike '%'||btrim(p_search)||'%' or coalesce(p.brand,'') ilike '%'||btrim(p_search)||'%' or p.external_id ilike '%'||btrim(p_search)||'%')
        order by p.name,p.brand nulls last,p.external_id,p.id
        limit v_per_retailer
      ) sample
      order by sample.supermarket,sample.name,sample.brand nulls last,sample.external_id
      limit v_limit
    )
    select jsonb_build_object(
      'industrySlug',v_industry,'aiFiltered',true,'balancedByRetailer',true,
      'retailer',p_retailer,'category',p_category,'categories',v_cached_categories,
      'retailerCounts',coalesce((select jsonb_agg(jsonb_build_object('supermarket',supermarket,'products',products) order by products desc,supermarket) from effective_counts),'[]'::jsonb),
      'products',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'externalId',external_id,'name',name,'brand',brand,'supermarket',supermarket,
        'category',smart_category,'rawCategory',category,'industrySlug',industry_slug
      ) order by supermarket,name,brand nulls last,external_id) from product_rows),'[]'::jsonb),
      'productCount',coalesce((select sum(products)::integer from effective_counts),0),
      'truncated',coalesce((select sum(products)>v_limit from effective_counts),false),'limit',v_limit
    )
  );
end;
$$;

revoke all on function public.refresh_enterprise_export_category_stats(uuid) from public,anon,authenticated;
grant execute on function public.enterprise_export_filter_options(uuid,text,text,text,integer) to authenticated;

select public.refresh_all_enterprise_ui_metadata_cache();