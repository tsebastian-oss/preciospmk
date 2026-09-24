
insert into public.automotive_financing_sources
(source_key,provider,source_type,product_name,source_url,parser_key,priority,metadata)
values
('maf-toyota','MAF Chile','auto_finance','Plan Renueve · Toyota','https://toyota.cl/terminos-y-condiciones-comerciales-por-modelo/','maf_toyota',142,'{"brand":"Toyota","coverage":"model_promotions"}'),
('bk-auto','BK Servicios Financieros','auto_finance','Financiamiento automotriz','https://bkserviciosfinancieros.cl/pages/credito_personal','bk_conditions',125,'{"coverage":"conditions"}'),
('autofin-auto','Autofin','auto_finance','Crédito automotriz','https://www.autofin.cl/','autofin_conditions',124,'{"coverage":"conditions"}'),
('global-auto','Global Soluciones Financieras','auto_finance','Crédito automotriz','https://www.grupoglobal.cl/productos/','global_conditions',118,'{"coverage":"conditions"}'),
('eurocapital-auto','Eurocapital','auto_finance','Financiamiento automotriz','https://www.eurocapital.cl/pago-automotriz/','eurocapital_conditions',105,'{"coverage":"conditions"}')
on conflict (source_key) do update set
 provider=excluded.provider,source_type=excluded.source_type,product_name=excluded.product_name,
 source_url=excluded.source_url,parser_key=excluded.parser_key,priority=excluded.priority,
 metadata=excluded.metadata,active=true,updated_at=now();

create or replace function public.automotive_financing_current(
  p_organization_id uuid,
  p_source_type text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','private','pg_temp'
as $$
declare
  v_access jsonb;
  v_offers jsonb;
  v_sources jsonb;
  v_summary jsonb;
begin
  v_access := public.enterprise_access_context(p_organization_id,'automotive');
  if p_source_type is not null and p_source_type not in ('auto_finance','credit_card','consumer_credit','benchmark') then
    raise exception 'invalid financing source type';
  end if;

  with ranked as (
    select o.*,
      row_number() over (
        partition by o.source_id, coalesce(o.brand,''), coalesce(o.model,''), coalesce(o.term_months,-1)
        order by o.observed_at desc, o.id desc
      ) rn
    from public.automotive_financing_observations o
    join public.automotive_financing_sources s on s.id=o.source_id and s.active
    where (p_source_type is null or o.source_type=p_source_type)
      and (o.valid_until is null or o.valid_until >= (now() at time zone 'America/Santiago')::date)
  ), current_rows as (
    select * from ranked where rn=1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id::text,'sourceId',source_id::text,'provider',provider,'sourceType',source_type,
    'productName',product_name,'brand',brand,'model',model,'vehiclePrice',vehicle_price,
    'financedPrice',financed_price,'financeBonus',finance_bonus,'downPaymentPct',down_payment_pct,
    'downPaymentAmount',down_payment_amount,'termMonths',term_months,'installmentsCount',installments_count,
    'installmentAmount',installment_amount,'balloonAmount',balloon_amount,'monthlyRatePct',monthly_rate_pct,
    'annualRatePct',annual_rate_pct,'caePct',cae_pct,'loanAmount',loan_amount,'creditTotalCost',credit_total_cost,
    'vehicleTotalCost',vehicle_total_cost,'fees',fees,'minIncome',min_income,'confidence',confidence,
    'sourceUrl',source_url,'observedAt',observed_at,'validFrom',valid_from,'validUntil',valid_until,
    'raw',raw_payload
  ) order by case source_type when 'auto_finance' then 1 when 'credit_card' then 2 when 'consumer_credit' then 3 else 4 end,
  provider, product_name, brand, model),'[]'::jsonb),
  jsonb_build_object(
    'providers',count(distinct provider),
    'offers',count(*),
    'autoFinance',count(*) filter(where source_type='auto_finance'),
    'creditCards',count(*) filter(where source_type='credit_card'),
    'withCae',count(*) filter(where cae_pct is not null),
    'withPublishedRate',count(*) filter(where monthly_rate_pct is not null or annual_rate_pct is not null)
  )
  into v_offers,v_summary
  from current_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id::text,'sourceKey',s.source_key,'provider',s.provider,'sourceType',s.source_type,
    'productName',s.product_name,'sourceUrl',s.source_url,'parserKey',s.parser_key,'priority',s.priority,
    'lastScrapedAt',s.last_scraped_at,'lastStatus',s.last_status,'lastError',s.last_error,'metadata',s.metadata
  ) order by s.priority desc,s.provider),'[]'::jsonb)
  into v_sources
  from public.automotive_financing_sources s
  where s.active and (p_source_type is null or s.source_type=p_source_type);

  return jsonb_build_object(
    'source','supabase','asOf',now(),'summary',v_summary,'offers',v_offers,'sources',v_sources,
    'methodology','Datos públicos capturados por fuente. Las simulaciones normalizadas respetan la disponibilidad de plazo declarada cuando está disponible y se muestran separadas de las condiciones publicadas.'
  );
end;
$$;

revoke all on function public.automotive_financing_current(uuid,text) from public, anon;
grant execute on function public.automotive_financing_current(uuid,text) to authenticated, service_role;
