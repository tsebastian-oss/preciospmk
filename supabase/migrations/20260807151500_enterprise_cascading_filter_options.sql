create or replace function public.enterprise_cascading_filter_options(
  p_organization_id uuid,
  p_retailer_type text default null,
  p_supermarket text default null,
  p_category text default null,
  p_brand text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
set statement_timeout = '5s'
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
  v_type text := nullif(btrim(coalesce(p_retailer_type, '')), '');
  v_supermarket text := nullif(btrim(coalesce(p_supermarket, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_brand text := nullif(btrim(coalesce(p_brand, '')), '');
begin
  perform public.enterprise_access_context(p_organization_id, 'overview');

  if v_type = 'all' then v_type := null; end if;
  if v_type is not null and v_type not in ('supermarket', 'department_store', 'pharmacy') then
    v_type := null;
  end if;

  select s.retailers, s.brands, s.categories, os.industry_slug
    into v_retailers, v_brands, v_categories, v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id = s.organization_id
  where s.organization_id = p_organization_id;

  return (
    with scoped_products as materialized (
      select
        p.id,
        p.supermarket,
        p.retailer_type,
        coalesce(nullif(btrim(p.smart_category), ''), nullif(btrim(p.category), '')) as category,
        nullif(btrim(p.brand), '') as brand
      from public.products p
      where p.retailer_type = any(array['supermarket'::text, 'department_store'::text, 'pharmacy'::text])
        and coalesce(p.source_metadata ->> 'capture_status', 'accepted') = 'accepted'
        and (v_type is null or p.retailer_type = v_type)
        and (coalesce(cardinality(v_retailers), 0) = 0 or p.supermarket = any(v_retailers))
        and (coalesce(cardinality(v_brands), 0) = 0 or p.brand = any(v_brands))
        and (
          coalesce(cardinality(v_categories), 0) = 0
          or coalesce(nullif(btrim(p.smart_category), ''), nullif(btrim(p.category), '')) = any(v_categories)
        )
        and (
          coalesce(v_industry, 'all') = 'all'
          or public.product_industry_allowed(v_industry, p.industry_slug, p.retailer_type)
        )
    ),
    chain_rows as (
      select supermarket as value, count(*)::integer as products
      from scoped_products
      group by supermarket
    ),
    category_scope as materialized (
      select * from scoped_products
      where v_supermarket is null or supermarket = v_supermarket
    ),
    category_rows as (
      select category as value, count(*)::integer as products
      from category_scope
      where category is not null
      group by category
    ),
    brand_scope as materialized (
      select * from category_scope
      where v_category is null or category = v_category
    ),
    brand_rows as (
      select brand as value, count(*)::integer as products
      from brand_scope
      where brand is not null
      group by brand
      order by count(*) desc, brand
      limit 500
    ),
    stock_scope as materialized (
      select b.id, b.retailer_type
      from brand_scope b
      where v_brand is null or b.brand = v_brand
    ),
    stock_rows as (
      select
        count(*) filter (
          where s.in_stock
            and (x.retailer_type <> 'pharmacy' or s.offer_price > 0)
        )::integer as in_stock,
        count(*) filter (
          where not s.in_stock
            and (x.retailer_type <> 'pharmacy' or s.offer_price > 0)
        )::integer as out_of_stock
      from stock_scope x
      join public.product_latest_price_state s on s.product_id = x.id
    )
    select jsonb_build_object(
      'retailerType', coalesce(v_type, 'all'),
      'supermarket', v_supermarket,
      'category', v_category,
      'brand', v_brand,
      'chains', coalesce((
        select jsonb_agg(jsonb_build_object('value', value, 'products', products) order by products desc, value)
        from chain_rows
      ), '[]'::jsonb),
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object('value', value, 'products', products) order by products desc, value)
        from category_rows
      ), '[]'::jsonb),
      'brands', coalesce((
        select jsonb_agg(jsonb_build_object('value', value, 'products', products) order by products desc, value)
        from brand_rows
      ), '[]'::jsonb),
      'stock', jsonb_build_object(
        'in', coalesce((select in_stock from stock_rows), 0),
        'out', coalesce((select out_of_stock from stock_rows), 0)
      )
    )
  );
end;
$$;

grant execute on function public.enterprise_cascading_filter_options(uuid, text, text, text, text) to authenticated;
revoke all on function public.enterprise_cascading_filter_options(uuid, text, text, text, text) from anon;
