create or replace function public.brands_peru_liquor_trends(
  p_slug text default 'bodegas-don-luis',
  p_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
with authorized as (
  select (p_slug = 'bodegas-don-luis' and private.enterprise_brand_slug_allowed(p_slug)) ok
),
b as (
  select id
  from public.brands_vertical_brands
  where slug=p_slug and status='active' and (select ok from authorized)
  limit 1
),
raw as (
  select
    l.id,
    date_bin(interval '6 hours',l.observed_at,timestamptz '2000-01-01 00:00:00+00') bucket_at,
    s.retailer_name,
    l.category,
    coalesce(l.source_product_key,l.product_url,l.id::text) sku_key,
    l.current_price,
    l.observed_at
  from public.brands_vertical_listings l
  join b on b.id=l.brand_id
  join public.brands_vertical_sources s on s.id=l.source_id and s.active
  where l.category in ('Pisco','Ron','Vino')
    and l.current_price between 1 and 5000
    and l.observed_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365)))
    and coalesce(l.raw->>'collector','') in ('vtex-public-search','tottus-public-listing-api','cord-public-search')
),
latest_in_capture as (
  select distinct on (bucket_at,retailer_name,category,sku_key)
    bucket_at,retailer_name,category,sku_key,current_price,observed_at
  from raw
  order by bucket_at,retailer_name,category,sku_key,observed_at desc,id desc
),
agg as (
  select
    bucket_at,
    retailer_name,
    category,
    round(avg(current_price),2) avg_price,
    round(min(current_price),2) min_price,
    round(max(current_price),2) max_price,
    count(*)::int sku_count,
    max(observed_at) captured_at
  from latest_in_capture
  group by bucket_at,retailer_name,category
)
select case when not exists(select 1 from b) then null else jsonb_build_object(
  'days',greatest(1,least(coalesce(p_days,30),365)),
  'bucketHours',6,
  'categories',jsonb_build_array('Pisco','Ron','Vino'),
  'chains',coalesce((
    select jsonb_agg(retailer_name order by retailer_name)
    from (select distinct retailer_name from agg) x
  ),'[]'::jsonb),
  'points',coalesce((
    select jsonb_agg(jsonb_build_object(
      'at',bucket_at,
      'capturedAt',captured_at,
      'retailer',retailer_name,
      'category',category,
      'avgPrice',avg_price,
      'minPrice',min_price,
      'maxPrice',max_price,
      'skuCount',sku_count
    ) order by bucket_at,retailer_name,case category when 'Pisco' then 1 when 'Ron' then 2 else 3 end)
    from agg
  ),'[]'::jsonb),
  'lastCapturedAt',(select max(captured_at) from agg)
) end;
$$;

revoke all on function public.brands_peru_liquor_trends(text,integer) from public, anon;
grant execute on function public.brands_peru_liquor_trends(text,integer) to authenticated, service_role;

do $$
declare r record;
begin
  for r in
    select jobid from cron.job
    where jobname='peru-liquor-pricing-refresh-6h'
       or jobname like 'bdl-census-%'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule('bdl-census-metro-pisco','5 */6 * * *',$$select public.dispatch_peru_liquor_census('metro','pisco');$$);
select cron.schedule('bdl-census-metro-ron','7 */6 * * *',$$select public.dispatch_peru_liquor_census('metro','ron');$$);
select cron.schedule('bdl-census-metro-vino','9 */6 * * *',$$select public.dispatch_peru_liquor_census('metro','vino');$$);

select cron.schedule('bdl-census-tottus-pisco','11 */6 * * *',$$select public.dispatch_peru_liquor_census('tottus','pisco');$$);
select cron.schedule('bdl-census-tottus-ron','13 */6 * * *',$$select public.dispatch_peru_liquor_census('tottus','ron');$$);
select cron.schedule('bdl-census-tottus-vino','15 */6 * * *',$$select public.dispatch_peru_liquor_census('tottus','vino');$$);

select cron.schedule('bdl-census-vivanda-pisco','17 */6 * * *',$$select public.dispatch_peru_liquor_census('vivanda','pisco');$$);
select cron.schedule('bdl-census-vivanda-ron','19 */6 * * *',$$select public.dispatch_peru_liquor_census('vivanda','ron');$$);
select cron.schedule('bdl-census-vivanda-vino','21 */6 * * *',$$select public.dispatch_peru_liquor_census('vivanda','vino');$$);

select cron.schedule('bdl-census-plazavea-pisco','23 */6 * * *',$$select public.dispatch_peru_liquor_census('plazavea','pisco');$$);
select cron.schedule('bdl-census-plazavea-ron','25 */6 * * *',$$select public.dispatch_peru_liquor_census('plazavea','ron');$$);
select cron.schedule('bdl-census-plazavea-vino','27 */6 * * *',$$select public.dispatch_peru_liquor_census('plazavea','vino');$$);

select cron.schedule('bdl-census-wong-pisco','29 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','pisco');$$);
select cron.schedule('bdl-census-wong-ron','31 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','ron');$$);
select cron.schedule('bdl-census-wong-vino-01','33 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','vino',0,250);$$);
select cron.schedule('bdl-census-wong-vino-02','35 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','vino',250,500);$$);
select cron.schedule('bdl-census-wong-vino-03','37 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','vino',500,750);$$);
select cron.schedule('bdl-census-wong-vino-04','39 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','vino',750,1000);$$);
select cron.schedule('bdl-census-wong-vino-05','41 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','vino',1000,1250);$$);
select cron.schedule('bdl-census-wong-vino-06','43 */6 * * *',$$select public.dispatch_peru_liquor_census('wong','vino',1250,1500);$$);
