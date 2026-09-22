create table if not exists public.victorinox_market_history_points (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  market_observed_at timestamptz not null,
  capture_reason text not null default 'market_read',
  category text not null check (category in ('Relojes','Equipo de viaje','Navajas y multiherramientas','Cuchillos')),
  own_median bigint not null,
  benchmark_median bigint not null,
  price_index numeric(12,1) not null,
  premium_pct numeric(12,1) not null,
  own_products integer not null default 0,
  competitor_products integer not null default 0,
  competitor_brands integer not null default 0,
  official_observed_at timestamptz,
  competition_observed_at timestamptz,
  constraint victorinox_market_history_category_observed_key unique (category, market_observed_at)
);

alter table public.victorinox_market_history_points enable row level security;
revoke all on table public.victorinox_market_history_points from anon, authenticated;
grant select, insert, update on table public.victorinox_market_history_points to service_role;
grant usage, select on sequence public.victorinox_market_history_points_id_seq to service_role;

create index if not exists victorinox_market_history_observed_idx
  on public.victorinox_market_history_points (market_observed_at desc, category);

create or replace function private.victorinox_current_market_points()
returns table (
  category text,
  own_median bigint,
  benchmark_median bigint,
  price_index numeric,
  premium_pct numeric,
  own_products integer,
  competitor_products integer,
  competitor_brands integer,
  official_observed_at timestamptz,
  competition_observed_at timestamptz,
  market_observed_at timestamptz
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $function$
with official_raw as (
  select distinct on (
    coalesce(l.category,''),
    lower(regexp_replace(translate(coalesce(l.title,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g'))
  )
    l.title,
    l.category,
    l.current_price::numeric as price,
    l.observed_at,
    lower(regexp_replace(translate(coalesce(l.title,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g')) as nt
  from public.brands_vertical_listings l
  join public.brands_vertical_brands b
    on b.id=l.brand_id and b.slug='victorinox' and b.status='active'
  join public.brands_vertical_sources s on s.id=l.source_id
  where s.domain='victorinoxstore.cl'
    and l.current_price>0
    and coalesce(l.in_stock,true)
    and l.observed_at>=now()-interval '14 days'
  order by
    coalesce(l.category,''),
    lower(regexp_replace(translate(coalesce(l.title,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g')),
    l.observed_at desc
),
official as (
  select
    case
      when category='Relojes' and nt like 'reloj %' then 'Relojes'
      when category in('Equipo de viaje','Mochilas y bolsos')
        and nt~'(maleta|equipaje|trolley|carry-on|carry on|spinner|luggage|suitcase)'
        and nt!~'(repuesto|rueda|candado|cobertor|funda|etiqueta|identificador|adaptador)'
        then 'Equipo de viaje'
      when category in('Navajas y multiherramientas','Swiss Army Knife & Tools')
        and nt~'(navaj|cortapluma|swisstool|swiss tool|spartan|climber|huntsman|cadet|classic sd|explorer|rambler|fieldmaster|swiss champ|swisschamp|ranger.?grip|cybertool|work champ|outrider|super tinker|hiker|camper|sportsman|recruit|sentinel|evoke|hunter pro|wine master|mountaineer|handyman|minichamp|swiss lite)'
        and nt!~'(multiherramientas para navajas|navaja.*juguete|^(funda|estuche|repuesto|aceite|cordon|lanyard|cadena|multiclip|alfiler|palillo|pinza) )'
        then 'Navajas y multiherramientas'
      when category='Cuchillos'
        and nt~'(cuchillo|cuchiller| knife|santoku|mondador|paring|chef|trinchar|filetear|fibrox|bistec|pan y pasteleria|tomate y de mesa)'
        and nt!~'(pelador|rallador|tabla de corte|tijera|cuchara|tenedor|afilador|soporte|olla|sarten|cubierto|vajilla)'
        then 'Cuchillos'
    end as category,
    price,
    observed_at
  from official_raw
),
own as (
  select
    category,
    round(percentile_cont(.5) within group(order by price))::bigint as own_median,
    count(*)::integer as own_products,
    max(observed_at) as official_observed_at
  from official
  where category is not null
  group by category
),
competition_raw as (
  select
    id,
    brand,
    observed_at,
    coalesce(nullif(offer_price,0),nullif(regular_price,0))::numeric as price,
    lower(translate(coalesce(brand,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')) as b,
    lower(regexp_replace(
      translate(concat_ws(' ',name,category,smart_category),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),
      '\s+',' ','g'
    )) as txt
  from private.victorinox_competition_snapshot
  where observed_at>=now()-interval '30 days'
    and coalesce(in_stock,true)
    and coalesce(nullif(offer_price,0),nullif(regular_price,0),0)>0
),
competition as (
  select
    case
      when b in ('tissot','seiko','citizen')
        and txt~'(reloj|watch|chrono|cronograf|quartz|cuarzo|automatic)'
        and txt!~'^(correa|pulsera|brazalete|strap|bateria|battery|repuesto|protector|estuche )'
        then 'Relojes'
      when b in ('samsonite','american tourister','saxoline')
        and txt~'(maleta|equipaje|trolley|carry[- ]?on|spinner|luggage|suitcase)'
        and txt!~'(repuesto|rueda|candado|cobertor|funda|etiqueta|identificador|adaptador)'
        then 'Equipo de viaje'
      when b='leatherman'
        and txt~'(navaj|cortapluma|swiss army knife|multiherr|herramient|wave|skeletool|signal|rebar|surge|wingman|charge|free p|(^| )arc( |$)|(^| )bond( |$)|(^| )curl( |$)|(^| )micra( |$)|(^| )rev( |$))'
        and txt!~'(aceite.*multiherr|cadena.*navaj|cordon.*navaj|lanyard.*navaj|multiclip.*navaj|alfiler.*repuesto|repuesto.*navaj|funda.*navaj|estuche.*navaj|multiherramientas para navajas|navaja.*juguete)'
        then 'Navajas y multiherramientas'
      when b in ('arcos','global','zwilling','tramontina','wusthof')
        and txt~'(cuchill| knife|santoku|mondador|fibrox|chef|trinchar|filetear|bistec)'
        and txt!~'(pelador|rallador|tabla de corte|tijera|cuchara|tenedor|afilador|soporte|olla|sarten|bateria de cocina|cubierto|vajilla)'
        then 'Cuchillos'
    end as category,
    brand,
    id,
    price,
    observed_at
  from competition_raw
),
brand_medians as (
  select
    category,
    brand,
    round(percentile_cont(.5) within group(order by price))::bigint as brand_median,
    count(distinct id)::integer as sku_count,
    max(observed_at) as observed_at
  from competition
  where category is not null
  group by category,brand
  having count(distinct id)>=5
),
benchmarks as (
  select
    category,
    round(percentile_cont(.5) within group(order by brand_median))::bigint as benchmark_median,
    sum(sku_count)::integer as competitor_products,
    count(*)::integer as competitor_brands,
    max(observed_at) as competition_observed_at
  from brand_medians
  group by category
)
select
  o.category,
  o.own_median,
  b.benchmark_median,
  round((o.own_median::numeric/nullif(b.benchmark_median,0))*100,1) as price_index,
  round(((o.own_median::numeric/nullif(b.benchmark_median,0))*100)-100,1) as premium_pct,
  o.own_products,
  b.competitor_products,
  b.competitor_brands,
  o.official_observed_at,
  b.competition_observed_at,
  greatest(o.official_observed_at,b.competition_observed_at) as market_observed_at
from own o
join benchmarks b using(category)
where o.own_median>0 and b.benchmark_median>0;
$function$;

create or replace function private.capture_victorinox_market_snapshot(p_reason text default 'market_read')
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  affected integer := 0;
begin
  insert into public.victorinox_market_history_points (
    captured_at,
    market_observed_at,
    capture_reason,
    category,
    own_median,
    benchmark_median,
    price_index,
    premium_pct,
    own_products,
    competitor_products,
    competitor_brands,
    official_observed_at,
    competition_observed_at
  )
  select
    now(),
    p.market_observed_at,
    left(coalesce(nullif(p_reason,''),'market_read'),80),
    p.category,
    p.own_median,
    p.benchmark_median,
    p.price_index,
    p.premium_pct,
    p.own_products,
    p.competitor_products,
    p.competitor_brands,
    p.official_observed_at,
    p.competition_observed_at
  from private.victorinox_current_market_points() p
  on conflict (category,market_observed_at) do update set
    captured_at=excluded.captured_at,
    capture_reason=excluded.capture_reason,
    own_median=excluded.own_median,
    benchmark_median=excluded.benchmark_median,
    price_index=excluded.price_index,
    premium_pct=excluded.premium_pct,
    own_products=excluded.own_products,
    competitor_products=excluded.competitor_products,
    competitor_brands=excluded.competitor_brands,
    official_observed_at=excluded.official_observed_at,
    competition_observed_at=excluded.competition_observed_at;

  get diagnostics affected = row_count;
  return affected;
end;
$function$;

create or replace function public.capture_victorinox_market_history(p_reason text default 'market_read')
returns integer
language sql
volatile
security definer
set search_path = public, private, pg_temp
as $function$
  select private.capture_victorinox_market_snapshot(p_reason);
$function$;

revoke all on function public.capture_victorinox_market_history(text) from public, anon, authenticated;
grant execute on function public.capture_victorinox_market_history(text) to service_role;

create or replace function public.victorinox_market_history_payload(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $function$
declare
  result jsonb;
begin
  if not private.enterprise_brand_slug_allowed('victorinox') then
    raise exception 'forbidden' using errcode='42501';
  end if;

  with filtered as (
    select *
    from public.victorinox_market_history_points
    where market_observed_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,90),365)))
  ),
  categories(category,ord) as (
    values
      ('Relojes'::text,1),
      ('Equipo de viaje'::text,2),
      ('Navajas y multiherramientas'::text,3),
      ('Cuchillos'::text,4)
  )
  select jsonb_build_object(
    'source','supabase-current-market-captures',
    'brand','Victorinox',
    'days',greatest(1,least(coalesce(p_days,90),365)),
    'method','current_market_snapshot_series_no_backfill',
    'categories',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category',c.category,
            'points',coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'date',h.market_observed_at::text,
                  'capturedAt',h.captured_at::text,
                  'ownMedian',h.own_median,
                  'benchmarkMedian',h.benchmark_median,
                  'priceIndex',h.price_index,
                  'premiumPct',h.premium_pct,
                  'ownProducts',h.own_products,
                  'competitorProducts',h.competitor_products,
                  'competitorBrands',h.competitor_brands,
                  'officialObservedAt',h.official_observed_at::text,
                  'competitionObservedAt',h.competition_observed_at::text,
                  'benchmarkMode','current_market'
                )
                order by h.market_observed_at
              )
              from filtered h
              where h.category=c.category
            ),'[]'::jsonb)
          )
          order by c.ord
        ),
        '[]'::jsonb
      )
  )
  into result
  from categories c;

  return result;
end;
$function$;

revoke all on function public.victorinox_market_history_payload(integer) from public, anon;
grant execute on function public.victorinox_market_history_payload(integer) to authenticated, service_role;

create or replace function private.refresh_victorinox_competition_snapshot()
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $function$
begin
  refresh materialized view private.victorinox_competition_snapshot;
  perform private.capture_victorinox_market_snapshot('competition_refresh');
end;
$function$;

select private.capture_victorinox_market_snapshot('baseline_current_market');
