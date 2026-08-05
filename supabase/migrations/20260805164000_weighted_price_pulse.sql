create or replace function public.enterprise_weighted_price_pulse(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_today date := (current_timestamp at time zone 'America/Santiago')::date;
begin
  perform public.enterprise_access_context(p_organization_id, 'overview');

  select retailers, brands, categories
    into v_retailers, v_brands, v_categories
  from public.organization_scopes
  where organization_id = p_organization_id;

  return (
    with requested_retailers as (
      select unnest(
        case
          when coalesce(cardinality(v_retailers), 0) = 0
            then array['Lider', 'Jumbo', 'Santa Isabel']::text[]
          else v_retailers
        end
      ) as supermarket
    ), scoped as (
      select d.*
      from public.daily_pricing_live d
      where d.price_date in (v_today, v_today - 1)
        and d.supermarket = any(
          case
            when coalesce(cardinality(v_retailers), 0) = 0
              then array['Lider', 'Jumbo', 'Santa Isabel']::text[]
            else v_retailers
          end
        )
        and (
          coalesce(cardinality(v_brands), 0) = 0
          or exists (
            select 1
            from unnest(v_brands) as brand_scope
            where lower(brand_scope) = lower(coalesce(d.brand, ''))
          )
        )
        and (
          coalesce(cardinality(v_categories), 0) = 0
          or exists (
            select 1
            from unnest(v_categories) as category_scope
            where lower(category_scope) = lower(coalesce(d.category, ''))
          )
        )
    ), daily_counts as (
      select
        r.supermarket,
        count(s.*) filter (where s.price_date = v_today)::integer as current_skus,
        count(s.*) filter (where s.price_date = v_today - 1)::integer as previous_skus,
        max(s.observed_at) filter (where s.price_date = v_today) as latest_observation_at
      from requested_retailers r
      left join scoped s on s.supermarket = r.supermarket
      group by r.supermarket
    ), raw_pairs as (
      select
        current_day.supermarket,
        current_day.product_id,
        previous_day.effective_price as previous_price,
        current_day.effective_price as current_price,
        current_day.effective_price / nullif(previous_day.effective_price, 0) as price_relative
      from scoped current_day
      join scoped previous_day
        on previous_day.product_id = current_day.product_id
       and previous_day.supermarket = current_day.supermarket
       and previous_day.price_date = current_day.price_date - 1
      where current_day.price_date = v_today
        and previous_day.price_date = v_today - 1
        and current_day.effective_price > 0
        and previous_day.effective_price > 0
        and current_day.effective_price / nullif(previous_day.effective_price, 0) between 0.25 and 4
    ), bounds as (
      select
        supermarket,
        count(*)::integer as raw_matched_skus,
        percentile_cont(0.025) within group (order by price_relative)::numeric as lower_relative,
        percentile_cont(0.975) within group (order by price_relative)::numeric as upper_relative
      from raw_pairs
      group by supermarket
    ), comparable_pairs as (
      select p.*
      from raw_pairs p
      join bounds b on b.supermarket = p.supermarket
      where p.price_relative between greatest(0.5::numeric, b.lower_relative)
                                 and least(2::numeric, b.upper_relative)
    ), weighted as (
      select
        supermarket,
        count(*)::integer as matched_skus,
        sum(previous_price)::numeric as previous_basket_value,
        sum(current_price)::numeric as current_basket_value
      from comparable_pairs
      group by supermarket
    ), rows as (
      select
        r.supermarket,
        c.current_skus,
        c.previous_skus,
        c.latest_observation_at,
        coalesce(w.matched_skus, 0) as matched_skus,
        w.previous_basket_value,
        w.current_basket_value,
        case
          when coalesce(w.previous_basket_value, 0) <= 0 then null
          else round((w.current_basket_value / w.previous_basket_value - 1) * 100, 2)
        end as variation_pct,
        case
          when c.previous_skus <= 0 then null
          else round(coalesce(w.matched_skus, 0)::numeric / c.previous_skus * 100, 1)
        end as coverage_pct
      from requested_retailers r
      left join daily_counts c on c.supermarket = r.supermarket
      left join weighted w on w.supermarket = r.supermarket
    )
    select jsonb_build_object(
      'data', coalesce(jsonb_agg(jsonb_build_object(
        'supermarket', supermarket,
        'variationPct', variation_pct,
        'weightedCurrent', case when current_basket_value is null then null else round(current_basket_value, 0) end,
        'weightedPrevious', case when previous_basket_value is null then null else round(previous_basket_value, 0) end,
        'matchedSkus', matched_skus,
        'currentSkus', coalesce(current_skus, 0),
        'previousSkus', coalesce(previous_skus, 0),
        'coveragePct', coverage_pct,
        'status', case when matched_skus >= 30 then 'ready' else 'building' end,
        'confidence', case
          when matched_skus >= 100 and coalesce(coverage_pct, 0) >= 60 then 'high'
          when matched_skus >= 50 and coalesce(coverage_pct, 0) >= 15 then 'medium'
          when matched_skus >= 10 then 'low'
          else 'building'
        end,
        'latestObservationAt', latest_observation_at
      ) order by case supermarket
        when 'Jumbo' then 1
        when 'Santa Isabel' then 2
        when 'Lider' then 3
        else 4
      end), '[]'::jsonb),
      'asOfDate', v_today,
      'previousDate', v_today - 1,
      'partialDay', true,
      'latestObservationAt', max(latest_observation_at),
      'method', 'matched_sku_value_weighted_index',
      'weighting', 'previous_day_sku_value',
      'outlierTreatment', '2.5_97.5_percentile_and_0.5_2.0_relative_bounds',
      'currency', 'CLP'
    )
    from rows
  );
end;
$$;

revoke all on function public.enterprise_weighted_price_pulse(uuid) from public, anon;
grant execute on function public.enterprise_weighted_price_pulse(uuid) to authenticated, service_role;
