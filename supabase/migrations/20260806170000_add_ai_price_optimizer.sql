create table if not exists public.pricing_optimizer_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  match_key text not null,
  product_name text not null,
  objective text not null check (objective in ('volume','balanced','margin')),
  current_price numeric(14,2) not null,
  unit_cost numeric(14,2) not null,
  baseline_units numeric(14,2) not null,
  stock_units numeric(14,2),
  min_margin_pct numeric(7,2) not null,
  elasticity numeric(8,4) not null,
  recommended_price numeric(14,2) not null,
  projected_units numeric(14,2) not null,
  projected_revenue numeric(16,2) not null,
  projected_gross_profit numeric(16,2) not null,
  confidence numeric(7,4) not null,
  inputs jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists pricing_optimizer_scenarios_org_created_idx
  on public.pricing_optimizer_scenarios(organization_id, created_at desc);
create index if not exists pricing_optimizer_scenarios_match_idx
  on public.pricing_optimizer_scenarios(organization_id, match_key, created_at desc);

alter table public.pricing_optimizer_scenarios enable row level security;

drop policy if exists pricing_optimizer_scenarios_select on public.pricing_optimizer_scenarios;
create policy pricing_optimizer_scenarios_select on public.pricing_optimizer_scenarios
for select using (public.enterprise_is_org_member(organization_id));

drop policy if exists pricing_optimizer_scenarios_insert on public.pricing_optimizer_scenarios;
create policy pricing_optimizer_scenarios_insert on public.pricing_optimizer_scenarios
for insert with check (public.enterprise_has_org_role(organization_id,array['owner','admin','analyst']::text[]));

create or replace function public.enterprise_price_optimizer_catalog(
  p_organization_id uuid,
  p_search text default null,
  p_match_key text default null,
  p_limit integer default 30
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','private'
as $$
declare
  v_scopes public.organization_scopes;
  v_settings public.organization_settings;
  v_limit integer := greatest(1, least(coalesce(p_limit,30),100));
begin
  perform public.enterprise_access_context(p_organization_id,'pricing');
  select * into v_scopes from public.organization_scopes where organization_id=p_organization_id;
  select * into v_settings from public.organization_settings where organization_id=p_organization_id;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.match_confidence desc, x.last_updated desc, x.canonical_name)
    from (
      select s.match_key,s.canonical_name,s.canonical_brand,s.category,s.smart_category,
             s.best_price,s.average_price,s.highest_price,s.price_gap,s.savings_pct,
             s.match_method,s.match_confidence,s.last_updated,s.image_url,s.store_listings
      from public.product_match_summary s
      left join public.products p on p.id=s.best_product_id
      where s.supermarkets=3
        and (p_match_key is null or s.match_key=p_match_key)
        and (nullif(trim(coalesce(p_search,'')),'') is null
          or s.canonical_name ilike '%'||trim(p_search)||'%'
          or coalesce(s.canonical_brand,'') ilike '%'||trim(p_search)||'%'
          or coalesce(s.smart_category,'') ilike '%'||trim(p_search)||'%')
        and (coalesce(cardinality(v_scopes.brands),0)=0
          or exists(select 1 from unnest(v_scopes.brands) b where lower(b)=lower(coalesce(s.canonical_brand,''))))
        and (coalesce(cardinality(v_scopes.categories),0)=0
          or exists(select 1 from unnest(v_scopes.categories) c where lower(c)=lower(coalesce(s.category,'')) or lower(c)=lower(coalesce(s.smart_category,''))))
        and public.product_industry_allowed(v_settings.industry_slug,p.industry_slug,p.retailer_type)
      order by s.match_confidence desc,s.last_updated desc,s.canonical_name
      limit v_limit
    ) x
  ),'[]'::jsonb);
end;
$$;

create or replace function public.enterprise_save_price_optimizer_scenario(
  p_organization_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'public','private'
as $$
declare v_row public.pricing_optimizer_scenarios;
begin
  if not public.enterprise_has_org_role(p_organization_id,array['owner','admin','analyst']::text[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  insert into public.pricing_optimizer_scenarios(
    organization_id,match_key,product_name,objective,current_price,unit_cost,baseline_units,stock_units,
    min_margin_pct,elasticity,recommended_price,projected_units,projected_revenue,
    projected_gross_profit,confidence,inputs,recommendation,created_by
  ) values (
    p_organization_id,p_payload->>'matchKey',p_payload->>'productName',p_payload->>'objective',
    (p_payload->>'currentPrice')::numeric,(p_payload->>'unitCost')::numeric,(p_payload->>'baselineUnits')::numeric,
    nullif(p_payload->>'stockUnits','')::numeric,(p_payload->>'minMarginPct')::numeric,(p_payload->>'elasticity')::numeric,
    (p_payload->>'recommendedPrice')::numeric,(p_payload->>'projectedUnits')::numeric,
    (p_payload->>'projectedRevenue')::numeric,(p_payload->>'projectedGrossProfit')::numeric,
    (p_payload->>'confidence')::numeric,coalesce(p_payload->'inputs','{}'::jsonb),
    coalesce(p_payload->'recommendation','{}'::jsonb),auth.uid()
  ) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.enterprise_price_optimizer_history(
  p_organization_id uuid,
  p_limit integer default 12
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','private'
as $$
begin
  perform public.enterprise_access_context(p_organization_id,'pricing');
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select id,match_key,product_name,objective,current_price,recommended_price,
             projected_units,projected_revenue,projected_gross_profit,confidence,created_at
      from public.pricing_optimizer_scenarios
      where organization_id=p_organization_id
      order by created_at desc
      limit greatest(1,least(coalesce(p_limit,12),50))
    ) x
  ),'[]'::jsonb);
end;
$$;

grant execute on function public.enterprise_price_optimizer_catalog(uuid,text,text,integer) to authenticated;
grant execute on function public.enterprise_save_price_optimizer_scenario(uuid,jsonb) to authenticated;
grant execute on function public.enterprise_price_optimizer_history(uuid,integer) to authenticated;
