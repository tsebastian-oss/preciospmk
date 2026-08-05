create or replace view public.dashboard_products
with (security_invoker=true)
as
select
  p.id,
  p.supermarket,
  p.external_id,
  btrim(replace(replace(replace(replace(p.name,'&nbsp;',' '),'&amp;','&'),'&quot;','"'),'&#39;','''')) as name,
  p.brand,
  case
    when p.category is null or length(btrim(p.category))<=1 then null
    when p.category='juguetera a' then 'Juguetería'
    when p.category='librera a' then 'Librería'
    when p.category='tecnologa a' then 'Tecnología'
    when p.category='muebles y decoracion' then 'Muebles y decoración'
    when p.category='menaje cocina' then 'Menaje de cocina'
    when p.category='menaje comedor' then 'Menaje de comedor'
    when p.category='rutina para el cabello' then 'Cuidado capilar'
    when p.category='vestuario' then 'Vestuario'
    when p.category='electrohogar' then 'Electrohogar'
    when p.category='dormitorio' then 'Dormitorio'
    when p.category='destilados' then 'Destilados'
    when p.category='supermercado' then 'Supermercado'
    else p.category
  end as category,
  p.url,
  p.image_url,
  o.regular_price,
  o.offer_price,
  o.unit,
  o.unit_price,
  o.in_stock,
  o.observed_at,
  greatest(coalesce(o.regular_price,o.offer_price)-o.offer_price,0) as savings,
  case
    when o.regular_price is not null and o.regular_price>o.offer_price and o.offer_price>0
      then round((o.regular_price-o.offer_price)/o.regular_price*100,1)
    else 0
  end as discount_pct,
  p.retailer_type,
  p.industry_slug,
  p.seller,
  p.variant
from public.products p
join lateral (
  select po.regular_price,po.offer_price,po.unit,po.unit_price,po.in_stock,po.observed_at
  from public.price_observations po
  where po.product_id=p.id and po.crawl_run_id is not null
  order by po.observed_at desc
  limit 1
) o on true
where p.retailer_type in ('supermarket','department_store');

grant select on public.dashboard_products to authenticated,anon;

create or replace view public.enterprise_price_export_rows
with (security_invoker=true)
as
select
  d.product_id,
  d.price_date,
  d.observed_at,
  d.observation_id,
  d.supermarket,
  p.external_id,
  p.name,
  p.brand,
  p.category,
  p.url,
  p.image_url,
  o.regular_price,
  o.offer_price,
  d.effective_price,
  o.unit,
  o.unit_price,
  o.in_stock,
  p.retailer_type,
  p.industry_slug
from public.daily_pricing_live d
join public.products p on p.id=d.product_id
join public.price_observations o on o.id=d.observation_id;

grant select on public.enterprise_price_export_rows to authenticated;

create or replace function public.enterprise_set_industry(
  p_organization_id uuid,
  p_industry_slug text
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_industry public.industries;
  v_current text;
begin
  if p_organization_id is null then raise exception 'organization required'; end if;
  if not public.enterprise_is_org_member(p_organization_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into v_industry
  from public.industries
  where slug=p_industry_slug and active=true;
  if v_industry.slug is null then raise exception 'invalid industry'; end if;

  select industry_slug into v_current
  from public.organization_settings
  where organization_id=p_organization_id;

  if v_current is not null
     and not public.is_saas_admin()
     and not public.enterprise_has_org_role(p_organization_id,array['owner','admin']::text[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  insert into public.organization_settings(organization_id,industry_slug,updated_by,updated_at)
  values(p_organization_id,v_industry.slug,auth.uid(),now())
  on conflict(organization_id) do update set
    industry_slug=excluded.industry_slug,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    p_organization_id,
    auth.uid(),
    'industry.selected',
    'organization',
    p_organization_id::text,
    jsonb_build_object('previousIndustry',v_current,'industrySlug',v_industry.slug,'industryName',v_industry.name)
  );

  return jsonb_build_object('industrySlug',v_industry.slug,'industryName',v_industry.name);
end;
$$;

grant execute on function public.enterprise_set_industry(uuid,text) to authenticated;

create or replace function public.enterprise_access_context(
  p_organization_id uuid,
  p_module text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,private
as $$
declare
  v_org public.organizations;
  v_scopes public.organization_scopes;
  v_settings public.organization_settings;
  v_industry_name text;
  v_role text;
  v_allowed boolean;
begin
  if p_organization_id is null then raise exception 'organization required'; end if;
  if not public.enterprise_is_org_member(p_organization_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into v_org from public.organizations where id=p_organization_id;
  if v_org.id is null then raise exception 'organization not found'; end if;
  if not public.is_saas_admin() and v_org.status not in ('trial','active') then
    raise exception 'organization suspended' using errcode='42501';
  end if;

  select * into v_scopes from public.organization_scopes where organization_id=p_organization_id;
  select * into v_settings from public.organization_settings where organization_id=p_organization_id;
  select name into v_industry_name from public.industries where slug=v_settings.industry_slug;

  v_role:=coalesce(
    private.enterprise_member_role(p_organization_id,auth.uid()),
    case when public.is_saas_admin() then 'saas_admin' end
  );
  v_allowed:=p_module is null
    or coalesce(cardinality(v_scopes.modules),0)=0
    or p_module=any(v_scopes.modules)
    or public.is_saas_admin();
  if not v_allowed then raise exception 'module not enabled' using errcode='42501'; end if;

  return jsonb_build_object(
    'organizationId',v_org.id,
    'organizationName',v_org.name,
    'organizationType',v_org.organization_type,
    'status',v_org.status,
    'plan',v_org.plan,
    'role',v_role,
    'module',p_module,
    'moduleAllowed',v_allowed,
    'retailers',coalesce(to_jsonb(v_scopes.retailers),'[]'::jsonb),
    'brands',coalesce(to_jsonb(v_scopes.brands),'[]'::jsonb),
    'competitors',coalesce(to_jsonb(v_scopes.competitors),'[]'::jsonb),
    'categories',coalesce(to_jsonb(v_scopes.categories),'[]'::jsonb),
    'modules',coalesce(to_jsonb(v_scopes.modules),'[]'::jsonb),
    'limits',coalesce(v_scopes.limits,'{}'::jsonb),
    'settings',to_jsonb(v_settings),
    'industrySlug',v_settings.industry_slug,
    'industryName',v_industry_name,
    'industryConfigured',v_settings.industry_slug is not null,
    'isSaasAdmin',public.is_saas_admin()
  );
end;
$$;

create or replace function public.enterprise_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select s.retailers,s.brands,s.categories,os.industry_slug
  into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with filtered as (
      select *
      from public.dashboard_products p
      where (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(
          select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(p.brand,''))
        ))
        and (coalesce(cardinality(v_categories),0)=0 or exists(
          select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(p.category,''))
        ))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), summary as (
      select jsonb_build_object(
        'total_products',count(*),
        'in_stock_products',count(*) filter(where in_stock),
        'offers',count(*) filter(where coalesce(discount_pct,0)>0),
        'supermarkets',count(distinct supermarket),
        'average_price',coalesce(round(avg(nullif(coalesce(offer_price,regular_price),0)),2),0),
        'total_savings',coalesce(round(sum(coalesce(savings,0)),2),0),
        'last_updated',max(observed_at)
      ) value
      from filtered
    ), stores as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'supermarket',supermarket,
        'products',products,
        'in_stock',in_stock,
        'offers',offers,
        'average_price',average_price,
        'average_discount',average_discount,
        'last_updated',last_updated
      ) order by products desc),'[]'::jsonb) value
      from (
        select supermarket,
          count(*) products,
          count(*) filter(where in_stock) in_stock,
          count(*) filter(where coalesce(discount_pct,0)>0) offers,
          coalesce(round(avg(nullif(coalesce(offer_price,regular_price),0)),2),0) average_price,
          coalesce(round(avg(coalesce(discount_pct,0)),2),0) average_discount,
          max(observed_at) last_updated
        from filtered
        group by supermarket
      ) s
    ), categories as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'supermarket',supermarket,
        'category',category,
        'products',products
      ) order by products desc),'[]'::jsonb) value
      from (
        select supermarket,coalesce(category,'Sin categoría') category,count(*) products
        from filtered
        group by supermarket,coalesce(category,'Sin categoría')
        order by products desc
        limit 1000
      ) c
    ), offers as (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.discount_pct desc,x.savings desc),'[]'::jsonb) value
      from (
        select id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,
          unit,unit_price,in_stock,observed_at,savings,discount_pct
        from filtered
        where coalesce(discount_pct,0)>0
        order by discount_pct desc,savings desc
        limit 8
      ) x
    ), latest_run as (
      select to_jsonb(r) value
      from (
        select id,status,vertical,started_at,finished_at,tasks_total,tasks_completed,tasks_failed,
          products_found,source_counts,errors
        from public.catalog_crawl_runs
        order by id desc
        limit 1
      ) r
    )
    select jsonb_build_object(
      'summary',(select value from summary),
      'supermarkets',(select value from stores),
      'categories',(select value from categories),
      'run',(select value from latest_run),
      'topOffers',(select value from offers),
      'organizationId',p_organization_id,
      'industrySlug',v_industry
    )
  );
end;
$$;

create or replace function public.enterprise_export_availability(p_organization_id uuid)
returns jsonb
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
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select s.retailers,s.brands,s.categories,os.industry_slug
  into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with scoped as (
      select d.*
      from public.daily_pricing_live d
      join public.products p on p.id=d.product_id
      where (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(
          select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(d.brand,''))
        ))
        and (coalesce(cardinality(v_categories),0)=0 or exists(
          select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(d.category,''))
        ))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), retailer_rows as (
      select supermarket,count(*)::bigint observations
      from scoped
      group by supermarket
    )
    select jsonb_build_object(
      'firstDate',min(price_date),
      'lastDate',max(price_date),
      'observations',count(*),
      'products',count(distinct product_id),
      'industrySlug',v_industry,
      'retailers',coalesce((
        select jsonb_agg(jsonb_build_object(
          'supermarket',supermarket,
          'observations',observations
        ) order by supermarket)
        from retailer_rows
      ),'[]'::jsonb)
    )
    from scoped
  );
end;
$$;

create or replace function public.classify_unscoped_products_service(p_limit integer default 3000)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_count integer;
begin
  with batch as (
    select id
    from public.products
    where industry_slug is null
    order by created_at,id
    limit greatest(1,least(coalesce(p_limit,3000),10000))
    for update skip locked
  )
  update public.products p
  set industry_slug=public.classify_product_industry(p.name,p.category,p.retailer_type),
      industry_confidence=case
        when public.classify_product_industry(p.name,p.category,p.retailer_type) in ('grocery','other') then 0.550
        else 0.900
      end,
      industry_source='rule'
  from batch
  where p.id=batch.id;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.classify_unscoped_products_service(integer) from public,anon,authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='industry-product-backfill';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'industry-product-backfill',
    '30 seconds',
    'select public.classify_unscoped_products_service(3000);'
  );
end $$;
