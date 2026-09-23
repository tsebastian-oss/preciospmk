-- Follow-up for the initial live migration: immutable snapshots, scoped history and priority sources.
create or replace function public.snapshot_automotive_observation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    new.automotive_snapshot:=old.automotive_snapshot;
    return new;
  end if;
  select jsonb_build_object('brand',p.brand,'model',coalesce(nullif(p.source_metadata->>'model',''),p.parent_external_id,p.name),
    'version',coalesce(nullif(p.variant,''),p.source_metadata->>'version'),'dealer',p.supermarket,'url',p.url,
    'metadata',p.source_metadata) into new.automotive_snapshot
  from public.products p where p.id=new.product_id and p.industry_slug='automotive' and p.retailer_type='automotive';
  return new;
end; $$;
revoke all on function public.snapshot_automotive_observation() from public,anon,authenticated;
drop trigger if exists capture_automotive_snapshot on public.price_observations;
create trigger capture_automotive_snapshot before insert or update of regular_price,offer_price,observed_at on public.price_observations
for each row execute function public.snapshot_automotive_observation();

create or replace function public.automotive_history_page(p_organization_id uuid,p_brand text default null,p_model text default null,
 p_dealer text default null,p_after_id bigint default 0,p_until_id bigint default null,p_page_size integer default 1000)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_access jsonb; v_rows jsonb; v_until bigint;
begin
 v_access:=public.enterprise_access_context(p_organization_id,'automotive');
 if v_access->>'organizationType'='brand' and coalesce((v_access->>'isSaasAdmin')::boolean,false)=false
    and jsonb_array_length(coalesce(v_access->'brands','[]'::jsonb))=0 then
   raise exception 'automotive brand scope required' using errcode='42501';
 end if;
 v_until:=coalesce(p_until_id,(select max(id) from public.price_observations));
 select coalesce(jsonb_agg(to_jsonb(r)-'sort_id' order by r.sort_id),'[]'::jsonb) into v_rows from (
 select po.id sort_id,po.id::text observation_id,p.id::text product_id,po.crawl_run_id::text crawl_run_id,po.observed_at,
 coalesce(po.automotive_snapshot->>'brand',p.brand) brand,
 coalesce(po.automotive_snapshot->>'model',nullif(p.source_metadata->>'model',''),p.parent_external_id,p.name) model,
 coalesce(po.automotive_snapshot->>'version',nullif(p.variant,''),p.source_metadata->>'version','Versión no informada') version,
 coalesce(po.automotive_snapshot->>'dealer',p.supermarket) dealer,coalesce(po.automotive_snapshot->>'url',p.url) url,
 po.regular_price,po.offer_price,po.in_stock,po.automotive_snapshot,
 case when po.automotive_snapshot is null then 'legacy_identity_current' else 'captured_snapshot' end identity_basis
 from public.price_observations po join public.products p on p.id=po.product_id
 where p.industry_slug='automotive' and p.retailer_type='automotive'
 and coalesce(po.automotive_snapshot->>'brand',p.brand,'') <> 'Nuevo'
 and po.id>greatest(coalesce(p_after_id,0),0) and po.id<=v_until
 and (nullif(p_brand,'') is null or coalesce(po.automotive_snapshot->>'brand',p.brand)=p_brand)
 and (nullif(p_model,'') is null or coalesce(po.automotive_snapshot->>'model',nullif(p.source_metadata->>'model',''),p.parent_external_id,p.name)=p_model)
 and (nullif(p_dealer,'') is null or coalesce(po.automotive_snapshot->>'dealer',p.supermarket)=p_dealer)
 and (jsonb_array_length(coalesce(v_access->'brands','[]'::jsonb))=0 or
   (p.brand in (select jsonb_array_elements_text(v_access->'brands')) and coalesce(po.automotive_snapshot->>'brand',p.brand) in (select jsonb_array_elements_text(v_access->'brands'))))
 and (jsonb_array_length(coalesce(v_access->'retailers','[]'::jsonb))=0 or
   (p.supermarket in (select jsonb_array_elements_text(v_access->'retailers')) and coalesce(po.automotive_snapshot->>'dealer',p.supermarket) in (select jsonb_array_elements_text(v_access->'retailers'))))
 order by po.id limit least(greatest(coalesce(p_page_size,1000),1),2000)
 ) r;
 return jsonb_build_object('rows',v_rows,'untilId',v_until::text,'nextId',case when jsonb_array_length(v_rows)>0 then v_rows->(jsonb_array_length(v_rows)-1)->>'observation_id' else null end);
end; $$;
revoke all on function public.automotive_history_page(uuid,text,text,text,bigint,bigint,integer) from public,anon;
grant execute on function public.automotive_history_page(uuid,text,text,text,bigint,bigint,integer) to authenticated;

drop function if exists public.automotive_monthly_history(uuid,text,text,text,text);
create or replace function public.automotive_monthly_history(p_organization_id uuid,p_brand text default null,p_model text default null,p_dealer text default null,p_price_type text default 'final',p_sources jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_access jsonb; v_months jsonb;
begin
 v_access:=public.enterprise_access_context(p_organization_id,'automotive');
 if v_access->>'organizationType'='brand' and coalesce((v_access->>'isSaasAdmin')::boolean,false)=false
    and jsonb_array_length(coalesce(v_access->'brands','[]'::jsonb))=0 then
   raise exception 'automotive brand scope required' using errcode='42501';
 end if;
 if p_price_type is null or p_price_type not in ('final','list','cash') then raise exception 'invalid price type'; end if;
 with raw as materialized (
 select p.id,coalesce(o.automotive_snapshot->>'brand',p.brand) brand,
 coalesce(o.automotive_snapshot->>'model',nullif(p.source_metadata->>'model',''),p.parent_external_id,p.name) model,
 coalesce(o.automotive_snapshot->>'version',nullif(p.variant,''),p.source_metadata->>'version','') version,
 coalesce(o.automotive_snapshot->>'dealer',p.supermarket) dealer,
 date_trunc('month',o.observed_at at time zone 'America/Santiago') period,o.observed_at,o.id observation_id,
 case p_price_type when 'final' then coalesce(nullif(o.offer_price,0),o.regular_price) when 'list' then o.regular_price else
 case when (o.automotive_snapshot->'metadata'->>'cash_price') ~ '^[0-9]+([.][0-9]+)?$' then (o.automotive_snapshot->'metadata'->>'cash_price')::numeric end end price
 from public.price_observations o join public.products p on p.id=o.product_id
 where p.industry_slug='automotive' and p.retailer_type='automotive'
 and coalesce(o.automotive_snapshot->>'brand',p.brand,'') <> 'Nuevo'
 and (jsonb_array_length(coalesce(v_access->'brands','[]'::jsonb))=0 or
   (p.brand in (select jsonb_array_elements_text(v_access->'brands')) and coalesce(o.automotive_snapshot->>'brand',p.brand) in (select jsonb_array_elements_text(v_access->'brands'))))
 and (jsonb_array_length(coalesce(v_access->'retailers','[]'::jsonb))=0 or
   (p.supermarket in (select jsonb_array_elements_text(v_access->'retailers')) and coalesce(o.automotive_snapshot->>'dealer',p.supermarket) in (select jsonb_array_elements_text(v_access->'retailers'))))
 and (jsonb_typeof(p_sources)='object' and ((p_sources->>p.brand) is null or p.supermarket=(p_sources->>p.brand)))
 ), filtered as materialized (
 select * from raw where price between 3000000 and 500000000
 and (nullif(p_brand,'') is null or brand=p_brand) and (nullif(p_model,'') is null or model=p_model) and (nullif(p_dealer,'') is null or dealer=p_dealer)
 and lower(btrim(version)) not in ('','precio desde','versión no informada','modelo')
 ), closes as (
 select distinct on(id,brand,model,version,dealer,period) * from filtered order by id,brand,model,version,dealer,period,observed_at desc,observation_id desc
 ), pairs as (
 select c.*,prev.price previous_price from closes c left join closes prev on prev.id=c.id and prev.brand=c.brand and prev.model=c.model and prev.version=c.version and prev.dealer=c.dealer and prev.period=c.period-interval '1 month'
 ), brand_stats as (
 select period,brand,avg((price/previous_price-1)*100) brand_change
 from pairs where previous_price>0 group by period,brand
 ), stats as (
 select period,avg(price) avg_price,count(*) versions,count(distinct brand) brands,
 count(previous_price) comparable_versions,count(distinct brand) filter(where previous_price is not null) comparable_brands,
 count(previous_price)::numeric/nullif(count(*),0)*100 coverage
 from pairs group by period
 ), periods as (
 select generate_series((select min(period) from filtered),date_trunc('month',now() at time zone 'America/Santiago'),interval '1 month') period
 )
 select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.period,'YYYY-MM'),'percentageChange',
 (select avg(bs.brand_change) from brand_stats bs where bs.period=m.period),
 'averagePrice',s.avg_price,'brands',coalesce(s.brands,0),'versions',coalesce(s.versions,0),
 'comparableBrands',coalesce(s.comparable_brands,0),'comparableVersions',coalesce(s.comparable_versions,0),'coveragePct',coalesce(s.coverage,0),
 'observations',(select count(*) from filtered f where f.period=m.period),
 'isPartial',m.period=date_trunc('month',now() at time zone 'America/Santiago')) order by m.period),'[]'::jsonb) into v_months from periods m left join stats s using(period);
 return jsonb_build_object('months',v_months,'priceType',p_price_type,'methodology','Promedio simple entre marcas del cambio porcentual promedio de sus versiones y fuentes comparables, usando la última observación de cada mes y la del mes inmediatamente anterior. Sin ponderación por ventas. Los meses sin pares comparables se muestran sin variación. Incluye las fuentes observadas; no representa un censo de toda la industria. Precio lista corresponde al precio regular almacenado; contado sólo disponible desde la captura detallada.','source','supabase','timezone','America/Santiago');
end; $$;
revoke all on function public.automotive_monthly_history(uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.automotive_monthly_history(uuid,text,text,text,text,jsonb) to authenticated;
