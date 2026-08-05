create table if not exists public.daily_pricing_live (
  product_id uuid not null references public.products(id) on delete cascade,
  price_date date not null,
  observed_at timestamptz not null,
  observation_id bigint not null,
  supermarket text not null,
  brand text,
  category text,
  category_group text not null check (category_group in ('non_alcoholic','grocery','alcoholic')),
  effective_price numeric not null check (effective_price > 0),
  primary key (product_id, price_date)
);

create index if not exists daily_pricing_live_day_group_idx
  on public.daily_pricing_live(price_date, category_group);
create index if not exists daily_pricing_live_scope_idx
  on public.daily_pricing_live(supermarket, brand, category, price_date);
create index if not exists daily_pricing_live_observed_idx
  on public.daily_pricing_live(observed_at desc);

alter table public.daily_pricing_live enable row level security;
revoke all on public.daily_pricing_live from public, anon, authenticated;
grant select, insert, update, delete on public.daily_pricing_live to service_role;

insert into public.daily_pricing_live as target (
  product_id,
  price_date,
  observed_at,
  observation_id,
  supermarket,
  brand,
  category,
  category_group,
  effective_price
)
select distinct on (o.product_id, (o.observed_at at time zone 'America/Santiago')::date)
  o.product_id,
  (o.observed_at at time zone 'America/Santiago')::date,
  o.observed_at,
  o.id,
  p.supermarket,
  p.brand,
  p.category,
  public.pricing_category_group(p.category, p.name),
  coalesce(nullif(o.offer_price,0), nullif(o.regular_price,0))::numeric
from public.price_observations o
join public.products p on p.id = o.product_id
where public.pricing_category_group(p.category, p.name) is not null
  and coalesce(nullif(o.offer_price,0), nullif(o.regular_price,0)) between 50 and 2000000
order by o.product_id,
         (o.observed_at at time zone 'America/Santiago')::date,
         o.observed_at desc,
         o.id desc
on conflict (product_id, price_date) do update
set observed_at = excluded.observed_at,
    observation_id = excluded.observation_id,
    supermarket = excluded.supermarket,
    brand = excluded.brand,
    category = excluded.category,
    category_group = excluded.category_group,
    effective_price = excluded.effective_price
where excluded.observed_at > target.observed_at
   or (excluded.observed_at = target.observed_at and excluded.observation_id > target.observation_id);

create or replace function public.sync_daily_pricing_live()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.daily_pricing_live as target (
    product_id,
    price_date,
    observed_at,
    observation_id,
    supermarket,
    brand,
    category,
    category_group,
    effective_price
  )
  select distinct on (o.product_id, (o.observed_at at time zone 'America/Santiago')::date)
    o.product_id,
    (o.observed_at at time zone 'America/Santiago')::date,
    o.observed_at,
    o.id,
    p.supermarket,
    p.brand,
    p.category,
    public.pricing_category_group(p.category, p.name),
    coalesce(nullif(o.offer_price,0), nullif(o.regular_price,0))::numeric
  from new_price_observations o
  join public.products p on p.id = o.product_id
  where public.pricing_category_group(p.category, p.name) is not null
    and coalesce(nullif(o.offer_price,0), nullif(o.regular_price,0)) between 50 and 2000000
  order by o.product_id,
           (o.observed_at at time zone 'America/Santiago')::date,
           o.observed_at desc,
           o.id desc
  on conflict (product_id, price_date) do update
  set observed_at = excluded.observed_at,
      observation_id = excluded.observation_id,
      supermarket = excluded.supermarket,
      brand = excluded.brand,
      category = excluded.category,
      category_group = excluded.category_group,
      effective_price = excluded.effective_price
  where excluded.observed_at > target.observed_at
     or (excluded.observed_at = target.observed_at and excluded.observation_id > target.observation_id);

  return null;
end;
$$;

revoke all on function public.sync_daily_pricing_live() from public, anon, authenticated;

 drop trigger if exists sync_daily_pricing_live_after_insert on public.price_observations;
create trigger sync_daily_pricing_live_after_insert
  after insert on public.price_observations
  referencing new table as new_price_observations
  for each statement
  execute function public.sync_daily_pricing_live();

 drop trigger if exists sync_daily_pricing_live_after_update on public.price_observations;
create trigger sync_daily_pricing_live_after_update
  after update on public.price_observations
  referencing new table as new_price_observations
  for each statement
  execute function public.sync_daily_pricing_live();

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
  v_days integer := greatest(7, least(coalesce(p_days,30),365));
  v_today date := (current_timestamp at time zone 'America/Santiago')::date;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');

  select retailers, brands, categories
    into v_retailers, v_brands, v_categories
  from public.organization_scopes
  where organization_id = p_organization_id;

  return (
    with scoped as (
      select d.*
      from public.daily_pricing_live d
      where d.price_date >= v_today - (v_days - 1)
        and (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(
          select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(d.brand,''))
        ))
        and (coalesce(cardinality(v_categories),0)=0 or exists(
          select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(d.category,''))
        ))
    ), period as (
      select count(distinct price_date)::integer as available_days,
             min(price_date) as first_date,
             max(price_date) as last_date,
             max(observed_at) as refreshed_at
      from scoped
    ), ranked as (
      select s.*,
             percent_rank() over (
               partition by s.price_date, s.category_group
               order by s.effective_price
             ) as price_rank
      from scoped s
    ), daily as (
      select price_date,
             category_group,
             round(coalesce(
               avg(effective_price) filter(where price_rank between 0.05 and 0.95),
               avg(effective_price)
             )::numeric,0) as average_price,
             coalesce(
               count(*) filter(where price_rank between 0.05 and 0.95),
               count(*)
             )::integer as sku_count
      from ranked
      group by price_date, category_group
    ), series as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', x.price_date,
        'nonAlcoholic', x.non_alcoholic,
        'grocery', x.grocery,
        'alcoholic', x.alcoholic,
        'nonAlcoholicSkus', x.non_alcoholic_skus,
        'grocerySkus', x.grocery_skus,
        'alcoholicSkus', x.alcoholic_skus
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
    ), day_counts as (
      select
        count(*) filter(where price_date=v_today)::integer as today_count,
        count(*) filter(where price_date=v_today-1)::integer as previous_count
      from scoped
    )
    select jsonb_build_object(
      'data',(select value from series),
      'daysRequested',v_days,
      'availableDays',coalesce((select available_days from period),0),
      'firstDate',(select first_date from period),
      'lastDate',(select last_date from period),
      'refreshedAt',(select refreshed_at from period),
      'latestObservationAt',(select refreshed_at from period),
      'partialDay',coalesce((select last_date=v_today from period),false),
      'live',true,
      'pollingSeconds',20,
      'historicalDaysFrozen',true,
      'currentDayObservations',coalesce((select today_count from day_counts),0),
      'previousDayObservations',coalesce((select previous_count from day_counts),0),
      'currentDayCoveragePct',case
        when coalesce((select previous_count from day_counts),0)=0 then null
        else least(100,round(
          (select today_count from day_counts)::numeric /
          greatest((select previous_count from day_counts),1) * 100,
          1
        ))
      end,
      'method','trimmed_mean_live_daily_basket',
      'trimLowerPct',5,
      'trimUpperPct',95,
      'minimumPresencePct',0,
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
