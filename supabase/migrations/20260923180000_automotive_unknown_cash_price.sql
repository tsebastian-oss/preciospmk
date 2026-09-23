-- Explicitly absent cash prices remain unknown (zero in the catalog UI), rather than inheriting list prices.
create or replace function public.automotive_data_rows(
  p_organization_id uuid,
  p_brand text default null,
  p_model text default null,
  p_window text default 'none'
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_access jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_rows jsonb;
begin
  v_access := public.enterprise_access_context(p_organization_id,'automotive');

  if p_window='previous_week' then
    v_end := (date_trunc('week', now() at time zone 'America/Santiago') at time zone 'America/Santiago');
    v_start := v_end - interval '7 days';
  elsif p_window='previous_month' then
    v_end := (date_trunc('month', now() at time zone 'America/Santiago') at time zone 'America/Santiago');
    v_start := v_end - interval '1 month';
  elsif p_window <> 'none' then
    raise exception 'invalid automotive comparison window';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.brand,x.model,x.current_price,x.version,x.dealer),'[]'::jsonb)
  into v_rows
  from (
    select
      p.id::text as id,
      coalesce(p.brand,'') as brand,
      coalesce(nullif(p.source_metadata->>'model',''),nullif(p.parent_external_id,''),p.name) as model,
      coalesce(nullif(p.variant,''),nullif(p.source_metadata->>'version',''),'Versión no informada') as version,
      p.supermarket as dealer,
      coalesce(
        case when coalesce(p.source_metadata->>'list_price','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'list_price')::numeric end,
        o.regular_price,0
      ) as list_price,
      coalesce(case when coalesce(p.source_metadata->>'brand_bonus','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'brand_bonus')::numeric end,0) as brand_bonus,
      coalesce(case when coalesce(p.source_metadata->>'online_bonus','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'online_bonus')::numeric end,0) as online_bonus,
      coalesce(case when coalesce(p.source_metadata->>'dealer_bonus','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'dealer_bonus')::numeric end,0) as dealer_bonus,
      case when coalesce(p.source_metadata ? 'cash_price',false) then
        coalesce(case when coalesce(p.source_metadata->>'cash_price','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'cash_price')::numeric end,0)
      else coalesce(o.regular_price,0) end as cash_price,
      coalesce(case when coalesce(p.source_metadata->>'finance_bonus','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'finance_bonus')::numeric end,0) as finance_bonus,
      coalesce(
        nullif(o.offer_price,0),
        case when coalesce(p.source_metadata->>'final_price','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'final_price')::numeric end,
        nullif(o.regular_price,0),
        case when coalesce(p.source_metadata->>'cash_price','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'cash_price')::numeric end,
        case when coalesce(p.source_metadata->>'list_price','') ~ '^[0-9]+([.][0-9]+)?$' then (p.source_metadata->>'list_price')::numeric end,
        0
      ) as current_price,
      o.observed_at,
      coalesce(prev.offer_price,prev.regular_price,0) as previous_price,
      prev.observed_at as previous_observed_at
    from public.products p
    join lateral (
      select po.regular_price,po.offer_price,po.observed_at
      from public.price_observations po
      where po.product_id=p.id
      order by po.observed_at desc
      limit 1
    ) o on true
    left join lateral (
      select po.regular_price,po.offer_price,po.observed_at
      from public.price_observations po
      where po.product_id=p.id
        and p_window <> 'none'
        and po.observed_at >= v_start
        and po.observed_at < v_end
      order by po.observed_at desc
      limit 1
    ) prev on true
    where p.retailer_type='automotive'
      and p.industry_slug='automotive'
      and coalesce(p.source_metadata->>'capture_status','') <> 'invalid_identity'
      and (nullif(btrim(coalesce(p_brand,'')),'') is null or p.brand=p_brand)
      and (
        nullif(btrim(coalesce(p_model,'')),'') is null
        or coalesce(nullif(p.source_metadata->>'model',''),nullif(p.parent_external_id,''),p.name)=p_model
      )
      and (
        jsonb_array_length(coalesce(v_access->'brands','[]'::jsonb))=0
        or p.brand in (select jsonb_array_elements_text(coalesce(v_access->'brands','[]'::jsonb)))
      )
  ) x
  where x.current_price between 3000000 and 500000000
  limit 20000;

  return jsonb_build_object(
    'window',p_window,
    'windowStart',v_start,
    'windowEnd',v_end,
    'rows',v_rows
  );
end;
$$;

revoke all on function public.automotive_data_rows(uuid,text,text,text) from public,anon;
grant execute on function public.automotive_data_rows(uuid,text,text,text) to authenticated;
