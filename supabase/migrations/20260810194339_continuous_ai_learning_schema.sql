-- Continuous AI learning for time-varying retail facts.
-- This is a deterministic feature store used as grounded model context; it is
-- intentionally separate from model fine-tuning so daily prices never become stale weights.

create table if not exists private.ai_learning_runs (
  id bigint generated always as identity primary key,
  run_type text not null check (run_type in ('bootstrap','incremental','manual')),
  source_from date not null,
  source_to date not null,
  status text not null check (status in ('running','completed','skipped')),
  source_rows bigint not null default 0 check (source_rows >= 0),
  feature_rows bigint not null default 0 check (feature_rows >= 0),
  source_max_observation_id bigint,
  source_max_observed_at timestamptz,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (source_from <= source_to)
);

create index if not exists ai_learning_runs_started_idx
  on private.ai_learning_runs(started_at desc);

create table if not exists private.ai_daily_learning_features (
  fact_date date not null,
  retailer_type text not null,
  supermarket text not null,
  industry_slug text not null,
  brand_key text not null,
  brand text not null,
  category_key text not null,
  category text not null,
  product_count integer not null check (product_count > 0),
  price_sum numeric not null check (price_sum > 0),
  average_price numeric not null check (average_price > 0),
  median_price numeric not null check (median_price > 0),
  min_price numeric not null check (min_price > 0),
  max_price numeric not null check (max_price >= min_price),
  changed_product_count integer not null default 0 check (changed_product_count >= 0),
  change_sum_pct numeric not null default 0,
  average_change_pct numeric,
  median_change_pct numeric,
  source_max_observation_id bigint not null,
  source_max_observed_at timestamptz not null,
  learned_at timestamptz not null default clock_timestamp(),
  primary key (fact_date, retailer_type, supermarket, industry_slug, brand_key, category_key)
);

create index if not exists ai_daily_learning_brand_date_idx
  on private.ai_daily_learning_features(brand_key, fact_date desc, supermarket, category_key);

create index if not exists ai_daily_learning_category_date_idx
  on private.ai_daily_learning_features(category_key, fact_date desc, supermarket, brand_key);

create index if not exists ai_daily_learning_date_scope_idx
  on private.ai_daily_learning_features(fact_date desc, retailer_type, supermarket, industry_slug);

create table if not exists private.ai_learning_state (
  singleton boolean primary key default true check (singleton),
  last_trained_from date,
  last_trained_to date,
  source_max_observation_id bigint,
  source_max_observed_at timestamptz,
  feature_rows bigint not null default 0 check (feature_rows >= 0),
  last_run_id bigint references private.ai_learning_runs(id),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists ai_learning_state_last_run_idx
  on private.ai_learning_state(last_run_id);

insert into private.ai_learning_state(singleton)
values (true)
on conflict (singleton) do nothing;

revoke all on table private.ai_learning_runs from public, anon, authenticated;
revoke all on table private.ai_daily_learning_features from public, anon, authenticated;
revoke all on table private.ai_learning_state from public, anon, authenticated;

create or replace function private.refresh_ai_learning_service(
  p_from date,
  p_to date,
  p_run_type text default 'manual'
) returns jsonb
language plpgsql
security definer
set search_path to 'private','public','extensions','pg_temp'
set statement_timeout to '8min'
as $$
declare
  v_from date := greatest(coalesce(p_from,current_date-1),current_date-370);
  v_to date := least(coalesce(p_to,current_date),current_date);
  v_run_type text := case when p_run_type in ('bootstrap','incremental','manual') then p_run_type else 'manual' end;
  v_run_id bigint;
  v_source_rows bigint := 0;
  v_feature_rows bigint := 0;
  v_max_observation_id bigint;
  v_max_observed_at timestamptz;
begin
  if v_from > v_to then
    raise exception 'invalid learning date range';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('private.refresh_ai_learning_service')) then
    insert into private.ai_learning_runs(run_type,source_from,source_to,status,finished_at,metadata)
    values (v_run_type,v_from,v_to,'skipped',clock_timestamp(),jsonb_build_object('reason','another_learning_run_is_active'))
    returning id into v_run_id;
    return jsonb_build_object('status','skipped','runId',v_run_id,'reason','another_learning_run_is_active');
  end if;

  insert into private.ai_learning_runs(run_type,source_from,source_to,status)
  values (v_run_type,v_from,v_to,'running')
  returning id into v_run_id;

  select count(*),max(observation_id),max(observed_at)
  into v_source_rows,v_max_observation_id,v_max_observed_at
  from public.daily_pricing_live
  where price_date between v_from and v_to;

  delete from private.ai_daily_learning_features
  where fact_date between v_from and v_to;

  insert into private.ai_daily_learning_features(
    fact_date,retailer_type,supermarket,industry_slug,brand_key,brand,
    category_key,category,product_count,price_sum,average_price,median_price,
    min_price,max_price,changed_product_count,change_sum_pct,average_change_pct,
    median_change_pct,source_max_observation_id,source_max_observed_at,learned_at
  )
  with learning_rows as materialized (
    select
      d.price_date fact_date,
      p.retailer_type,
      d.supermarket,
      coalesce(nullif(btrim(p.industry_slug),''),'unclassified') industry_slug,
      coalesce(nullif(btrim(d.brand),''),nullif(btrim(p.brand),''),'Sin marca') brand,
      coalesce(nullif(btrim(cf.category),''),nullif(btrim(d.category_group),''),nullif(btrim(d.category),''),'Sin categoría') category,
      d.product_id,
      d.effective_price,
      d.observation_id,
      d.observed_at,
      case
        when previous.effective_price > 0
          and d.effective_price / previous.effective_price between 0.10 and 10.0
        then ((d.effective_price / previous.effective_price)-1)*100
      end change_pct
    from public.daily_pricing_live d
    join public.products p on p.id=d.product_id
    left join private.product_comparison_features cf on cf.product_id=d.product_id
    left join public.daily_pricing_live previous
      on previous.product_id=d.product_id
     and previous.price_date=d.price_date-1
    where d.price_date between v_from and v_to
      and d.effective_price > 0
      and coalesce(p.source_metadata->>'capture_status','accepted')='accepted'
      and p.retailer_type=any(array['supermarket','department_store','pharmacy','home_improvement'])
  ), normalized as materialized (
    select *,
      coalesce(nullif(regexp_replace(lower(brand),'[^[:alnum:]áéíóúüñ]+','','g'),''),'__unknown__') brand_key,
      coalesce(nullif(regexp_replace(lower(category),'[^[:alnum:]áéíóúüñ]+','','g'),''),'__unknown__') category_key
    from learning_rows
  )
  select
    fact_date,retailer_type,supermarket,industry_slug,brand_key,min(brand),
    category_key,min(category),count(*)::integer,sum(effective_price),
    round(avg(effective_price),2),
    round((percentile_cont(.5) within group(order by effective_price))::numeric,2),
    min(effective_price),max(effective_price),
    count(change_pct)::integer,coalesce(sum(change_pct),0),
    round(avg(change_pct),4),
    round((percentile_cont(.5) within group(order by change_pct))::numeric,4),
    max(observation_id),max(observed_at),clock_timestamp()
  from normalized
  group by fact_date,retailer_type,supermarket,industry_slug,brand_key,category_key;

  get diagnostics v_feature_rows = row_count;

  update private.ai_learning_runs
  set status='completed',source_rows=v_source_rows,feature_rows=v_feature_rows,
      source_max_observation_id=v_max_observation_id,source_max_observed_at=v_max_observed_at,
      finished_at=clock_timestamp(),
      metadata=jsonb_build_object(
        'source','public.daily_pricing_live',
        'grain','date_retailer_brand_category',
        'sameSkuChangeGuardrail','0.10x_to_10x'
      )
  where id=v_run_id;

  update private.ai_learning_state
  set last_trained_from=v_from,last_trained_to=v_to,
      source_max_observation_id=v_max_observation_id,
      source_max_observed_at=v_max_observed_at,
      feature_rows=(select count(*) from private.ai_daily_learning_features),
      last_run_id=v_run_id,updated_at=clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'status','completed','runId',v_run_id,'runType',v_run_type,
    'sourceFrom',v_from,'sourceTo',v_to,'sourceRows',v_source_rows,
    'featureRowsWritten',v_feature_rows,'sourceMaxObservationId',v_max_observation_id,
    'sourceMaxObservedAt',v_max_observed_at
  );
end;
$$;

create or replace function private.refresh_ai_learning_incremental_service()
returns jsonb
language sql
security definer
set search_path to 'private','public','pg_temp'
as $$
  select private.refresh_ai_learning_service(current_date-1,current_date,'incremental');
$$;

revoke all on function private.refresh_ai_learning_service(date,date,text) from public, anon, authenticated;
revoke all on function private.refresh_ai_learning_incremental_service() from public, anon, authenticated;
grant execute on function private.refresh_ai_learning_service(date,date,text) to service_role;
grant execute on function private.refresh_ai_learning_incremental_service() to service_role;

create or replace function public.enterprise_ai_learning_context(
  p_organization_id uuid,
  p_brand text default null,
  p_category text default null,
  p_retailer_type text default 'all',
  p_supermarket text default null,
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '20s'
as $$
declare
  v_access jsonb;
  v_retailers text[] := '{}';
  v_brands text[] := '{}';
  v_categories text[] := '{}';
  v_industry text;
  v_days integer := greatest(7,least(coalesce(p_days,30),90));
  v_brand_key text := nullif(regexp_replace(lower(coalesce(p_brand,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
  v_category_key text := nullif(regexp_replace(lower(coalesce(p_category,'')),'[^[:alnum:]áéíóúüñ]+','','g'),'');
begin
  -- The caller's Edge Function enforces its own module (pricing or competitive).
  -- This shared context still enforces organization membership and data scopes.
  v_access:=public.enterprise_access_context(p_organization_id,null);
  select coalesce(array_agg(value),'{}') into v_retailers
    from jsonb_array_elements_text(coalesce(v_access->'retailers','[]')) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_brands
    from jsonb_array_elements_text(coalesce(v_access->'brands','[]')) t(value);
  select coalesce(array_agg(regexp_replace(lower(value),'[^[:alnum:]áéíóúüñ]+','','g')),'{}') into v_categories
    from jsonb_array_elements_text(coalesce(v_access->'categories','[]')) t(value);
  v_industry:=nullif(v_access->>'industrySlug','');

  return (
    with state as (
      select * from private.ai_learning_state where singleton
    ), scoped as materialized (
      select f.*
      from private.ai_daily_learning_features f
      where f.fact_date>=current_date-(v_days-1)
        and (coalesce(cardinality(v_retailers),0)=0 or f.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or f.brand_key=any(v_brands))
        and (coalesce(cardinality(v_categories),0)=0 or f.category_key=any(v_categories))
        and public.product_industry_allowed(v_industry,nullif(f.industry_slug,'unclassified'),f.retailer_type)
        and (coalesce(nullif(p_retailer_type,''),'all')='all' or f.retailer_type=p_retailer_type)
        and (nullif(btrim(coalesce(p_supermarket,'')),'') is null or f.supermarket=p_supermarket)
        and (v_brand_key is null or f.brand_key=v_brand_key)
        and (v_category_key is null or f.category_key=v_category_key)
    ), latest as (
      select max(fact_date) fact_date from scoped
    ), daily as (
      select fact_date,
        sum(product_count)::bigint products,
        count(distinct supermarket)::integer retailers,
        round(sum(price_sum)/nullif(sum(product_count),0),2) average_price,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct,
        max(source_max_observed_at) source_observed_at
      from scoped group by fact_date order by fact_date
    ), retailer_latest as (
      select supermarket,retailer_type,sum(product_count)::bigint products,
        round(sum(price_sum)/nullif(sum(product_count),0),2) average_price,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct,
        max(source_max_observed_at) source_observed_at
      from scoped where fact_date=(select fact_date from latest)
      group by supermarket,retailer_type order by products desc
    ), category_latest as (
      select category_key,min(category) category,sum(product_count)::bigint products,
        count(distinct supermarket)::integer retailers,
        round(sum(price_sum)/nullif(sum(product_count),0),2) average_price,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct
      from scoped where fact_date=(select fact_date from latest)
      group by category_key order by products desc limit 12
    ), movements as (
      select brand_key,min(brand) brand,category_key,min(category) category,
        sum(product_count)::bigint products,count(distinct supermarket)::integer retailers,
        sum(changed_product_count)::bigint changed_products,
        round(sum(change_sum_pct)/nullif(sum(changed_product_count),0),4) same_sku_change_pct
      from scoped where fact_date=(select fact_date from latest)
      group by brand_key,category_key
      having sum(changed_product_count)>=2
      order by abs(sum(change_sum_pct)/nullif(sum(changed_product_count),0)) desc,
               sum(changed_product_count) desc
      limit 12
    )
    select jsonb_build_object(
      'ready',exists(select 1 from scoped),
      'method','daily_grounded_feature_store',
      'scope',jsonb_build_object(
        'brand',p_brand,'category',p_category,'retailerType',coalesce(nullif(p_retailer_type,''),'all'),
        'supermarket',p_supermarket,'days',v_days,'latestDate',(select fact_date from latest)
      ),
      'training',jsonb_build_object(
        'lastRunId',s.last_run_id,'trainedFrom',s.last_trained_from,'trainedTo',s.last_trained_to,
        'sourceMaxObservationId',s.source_max_observation_id,'sourceObservedAt',s.source_max_observed_at,
        'featureRows',s.feature_rows,'updatedAt',s.updated_at
      ),
      'daily',coalesce((select jsonb_agg(jsonb_build_object(
        'date',fact_date,'products',products,'retailers',retailers,'averagePrice',average_price,
        'sameSkuChangePct',same_sku_change_pct,'changedProducts',changed_products,
        'sourceObservedAt',source_observed_at
      ) order by fact_date) from daily),'[]'::jsonb),
      'retailers',coalesce((select jsonb_agg(to_jsonb(r) order by products desc) from retailer_latest r),'[]'::jsonb),
      'categories',coalesce((select jsonb_agg(to_jsonb(c) order by products desc) from category_latest c),'[]'::jsonb),
      'movements',coalesce((select jsonb_agg(to_jsonb(m) order by abs(same_sku_change_pct) desc nulls last) from movements m),'[]'::jsonb),
      'guardrails',jsonb_build_object(
        'factsOnly',true,
        'source','daily_pricing_live',
        'deduplication','one_valid_observation_per_product_per_day',
        'trend','same SKU vs previous calendar day; ratios outside 0.10x-10x excluded',
        'broadAverageWarning','Average prices across a changing assortment are descriptive; use sameSkuChangePct for trend claims.'
      ),
      'generatedAt',clock_timestamp()
    ) from state s
  );
end;
$$;

revoke all on function public.enterprise_ai_learning_context(uuid,text,text,text,text,integer) from public, anon;
grant execute on function public.enterprise_ai_learning_context(uuid,text,text,text,text,integer) to authenticated, service_role;

comment on table private.ai_daily_learning_features is
  'Deterministic daily retail feature store used to ground AI responses in current and historical facts.';
comment on function public.enterprise_ai_learning_context(uuid,text,text,text,text,integer) is
  'Returns organization-scoped continuous-learning context for AI functions without exposing private feature tables.';

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='refresh-ai-learning-hourly';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'refresh-ai-learning-hourly',
    '37 * * * *',
    $cron$select private.refresh_ai_learning_incremental_service();$cron$
  );
end $$;
