-- Keep rejected identities in the complete observation audit export with an explicit status.
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
 coalesce(nullif(po.automotive_snapshot->'metadata'->>'capture_status',''),nullif(p.source_metadata->>'capture_status',''),
   case when coalesce(po.automotive_snapshot->>'brand',p.brand)='Nuevo' then 'invalid_identity' end,'captured') capture_status,
 case when po.automotive_snapshot is null then 'legacy_identity_current' else 'captured_snapshot' end identity_basis
 from public.price_observations po join public.products p on p.id=po.product_id
 where p.industry_slug='automotive' and p.retailer_type='automotive'
 and po.id>greatest(coalesce(p_after_id,0),0) and po.id<=v_until
 and (nullif(p_brand,'') is null or coalesce(po.automotive_snapshot->>'brand',p.brand)=p_brand)
 and (nullif(p_model,'') is null or coalesce(po.automotive_snapshot->>'model',nullif(p.source_metadata->>'model',''),p.parent_external_id,p.name)=p_model)
 and (nullif(p_dealer,'') is null or coalesce(po.automotive_snapshot->>'dealer',p.supermarket)=p_dealer)
 and (coalesce((v_access->>'isSaasAdmin')::boolean,false) or jsonb_array_length(coalesce(v_access->'brands','[]'::jsonb))=0 or
   (p.brand in (select jsonb_array_elements_text(v_access->'brands')) and coalesce(po.automotive_snapshot->>'brand',p.brand) in (select jsonb_array_elements_text(v_access->'brands'))))
 and (coalesce((v_access->>'isSaasAdmin')::boolean,false) or jsonb_array_length(coalesce(v_access->'retailers','[]'::jsonb))=0 or
   (p.supermarket in (select jsonb_array_elements_text(v_access->'retailers')) and coalesce(po.automotive_snapshot->>'dealer',p.supermarket) in (select jsonb_array_elements_text(v_access->'retailers'))))
 order by po.id limit least(greatest(coalesce(p_page_size,1000),1),2000)
 ) r;
 return jsonb_build_object('rows',v_rows,'untilId',v_until::text,'nextId',case when jsonb_array_length(v_rows)>0 then v_rows->(jsonb_array_length(v_rows)-1)->>'observation_id' else null end);
end; $$;
revoke all on function public.automotive_history_page(uuid,text,text,text,bigint,bigint,integer) from public,anon;
grant execute on function public.automotive_history_page(uuid,text,text,text,bigint,bigint,integer) to authenticated;

