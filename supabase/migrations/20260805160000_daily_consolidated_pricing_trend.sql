create or replace function public.pricing_category_group(p_category text, p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(concat_ws(' ', coalesce(p_category,''), coalesce(p_name,''))) ~
      '(vino|cervez|licor|destilad|whisky|whiskey|vodka|pisco|tequila|espumante|sidra|champagne|aperitivo|gin tonic|(^|[^a-z])ron([^a-z]|$))'
      then 'alcoholic'
    when lower(concat_ws(' ', coalesce(p_category,''), coalesce(p_name,''))) ~
      '(bebidas gaseosas|bebidas, aguas|jugos|néctar|nectar|agua mineral|agua purificada|agua saborizada|bebida energética|bebida energetica|bebida isotónica|bebida isotonica|gaseosa|refresco|soda|kombucha)'
      then 'non_alcoholic'
    when lower(concat_ws(' ', coalesce(p_category,''), coalesce(p_name,''))) ~
      '(despensa|abarrotes|aceites|aderezos|condimentos|salsas|pastas|fideos|arroz|legumbres|conservas|cereales|avena|harina|azúcar|azucar|mermelad|manjar|repostería|reposteria|alimentos instant|snacks|galletas|chocolate|dulces|panadería envasada|panaderia envasada)'
      then 'grocery'
    else null
  end;
$$;

revoke all on function public.pricing_category_group(text,text) from public, anon, authenticated;
grant execute on function public.pricing_category_group(text,text) to service_role;

create materialized view public.daily_pricing_observations as
select distinct on (o.product_id, (o.observed_at at time zone 'America/Santiago')::date)
  o.product_id,
  (o.observed_at at time zone 'America/Santiago')::date as price_date,
  o.observed_at,
  p.supermarket,
  p.brand,
  p.category,
  public.pricing_category_group(p.category,p.name) as category_group,
  coalesce(nullif(o.offer_price,0),nullif(o.regular_price,0))::numeric as effective_price
from public.price_observations o
join public.products p on p.id=o.product_id
where public.pricing_category_group(p.category,p.name) is not null
  and coalesce(nullif(o.offer_price,0),nullif(o.regular_price,0)) between 50 and 2000000
order by o.product_id,(o.observed_at at time zone 'America/Santiago')::date,o.observed_at desc,o.id desc;

create unique index daily_pricing_observations_product_day_idx
  on public.daily_pricing_observations(product_id,price_date);
create index daily_pricing_observations_day_group_idx
  on public.daily_pricing_observations(price_date,category_group);
create index daily_pricing_observations_scope_idx
  on public.daily_pricing_observations(supermarket,brand,category);

revoke all on public.daily_pricing_observations from public, anon, authenticated;
grant select on public.daily_pricing_observations to service_role;

create or replace function public.enterprise_daily_pricing_trend(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_days integer := greatest(7,least(coalesce(p_days,30),365));
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select retailers,brands,categories
    into v_retailers,v_brands,v_categories
  from public.organization_scopes
  where organization_id=p_organization_id;

  return (
    with scoped as (
      select d.*
      from public.daily_pricing_observations d
      where d.price_date >= (current_timestamp at time zone 'America/Santiago')::date - (v_days - 1)
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(d.brand,''))))
        and (coalesce(cardinality(v_categories),0)=0 or exists(select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(d.category,''))))
    ), period as (
      select count(distinct price_date)::integer as available_days,
             min(price_date) as first_date,
             max(price_date) as last_date,
             max(observed_at) as refreshed_at
      from scoped
    ), stable_products as (
      select s.product_id
      from scoped s cross join period p
      group by s.product_id,p.available_days
      having count(distinct s.price_date) >= case
        when p.available_days <= 2 then greatest(p.available_days,1)
        else greatest(2,ceil(p.available_days * 0.60)::integer)
      end
    ), ranked as (
      select s.*,
             percent_rank() over(partition by s.price_date,s.category_group order by s.effective_price) as price_rank
      from scoped s
      join stable_products sp using(product_id)
    ), daily as (
      select price_date,category_group,
             round(coalesce(avg(effective_price) filter(where price_rank between 0.05 and 0.95),avg(effective_price))::numeric,0) as average_price,
             count(*)::integer as sku_count
      from ranked
      group by price_date,category_group
    ), series as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date',x.price_date,
        'nonAlcoholic',x.non_alcoholic,
        'grocery',x.grocery,
        'alcoholic',x.alcoholic,
        'nonAlcoholicSkus',x.non_alcoholic_skus,
        'grocerySkus',x.grocery_skus,
        'alcoholicSkus',x.alcoholic_skus
      ) order by x.price_date),'[]'::jsonb) as value
      from (
        select price_date,
          max(average_price) filter(where category_group='non_alcoholic') as non_alcoholic,
          max(average_price) filter(where category_group='grocery') as grocery,
          max(average_price) filter(where category_group='alcoholic') as alcoholic,
          max(sku_count) filter(where category_group='non_alcoholic') as non_alcoholic_skus,
          max(sku_count) filter(where category_group='grocery') as grocery_skus,
          max(sku_count) filter(where category_group='alcoholic') as alcoholic_skus
        from daily
        group by price_date
      ) x
    )
    select jsonb_build_object(
      'data',(select value from series),
      'daysRequested',v_days,
      'availableDays',coalesce((select available_days from period),0),
      'firstDate',(select first_date from period),
      'lastDate',(select last_date from period),
      'refreshedAt',(select refreshed_at from period),
      'partialDay',exists(select 1 from public.catalog_crawl_runs r where r.status='running' and r.started_at::date <= (current_timestamp at time zone 'America/Santiago')::date),
      'method','trimmed_mean_stable_basket',
      'trimLowerPct',5,
      'trimUpperPct',95,
      'minimumPresencePct',60,
      'currency','CLP'
    )
  );
end;
$$;

revoke all on function public.enterprise_daily_pricing_trend(uuid,integer) from public, anon;
grant execute on function public.enterprise_daily_pricing_trend(uuid,integer) to authenticated, service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='refresh-daily-pricing-observations';

select cron.schedule(
  'refresh-daily-pricing-observations',
  '17 * * * *',
  'refresh materialized view concurrently public.daily_pricing_observations'
);
