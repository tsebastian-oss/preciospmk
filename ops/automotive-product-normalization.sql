-- Normalize automotive model/version names at the products boundary so parser-specific
-- HTML or marketing prefixes never leak into ClickHouse or the UI.

create or replace function public.normalize_automotive_product_service()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_model text;
  v_version text;
begin
  if new.retailer_type <> 'automotive' then return new; end if;

  v_model:=replace(replace(replace(coalesce(new.source_metadata->>'model',''),'&#215;','×'),'&amp;','&'),'&nbsp;',' ');
  v_version:=replace(replace(replace(coalesce(new.variant,new.source_metadata->>'version',''),'&#215;','×'),'&amp;','&'),'&nbsp;',' ');

  if new.supermarket='Salazar Israel' then
    v_model:=regexp_replace(
      v_model,
      '^Nuevo\s+'||regexp_replace(coalesce(new.brand,''),'([\\.\\+\\*\\?\\[\\^\\]\\$\\(\\)\\{\\}=!<>|:\\-])','\\\1','g')||'\s+',
      '',
      'i'
    );
    v_model:=regexp_replace(v_model,'\s+Salazar Israel$','','i');
    v_model:=regexp_replace(v_model,'^(Nuevo|Nueva)\s+','','i');
  end if;

  v_model:=btrim(regexp_replace(v_model,'\s+',' ','g'));
  v_version:=btrim(regexp_replace(v_version,'\s+',' ','g'));

  if v_model<>'' then
    new.source_metadata:=jsonb_set(new.source_metadata,'{model}',to_jsonb(v_model),true);
    new.parent_external_id:=lower(coalesce(new.brand,''))||':'||lower(v_model);
  end if;
  if v_version<>'' then
    new.variant:=v_version;
    new.source_metadata:=jsonb_set(new.source_metadata,'{version}',to_jsonb(v_version),true);
  end if;

  new.name:=btrim(concat_ws(
    ' ',
    new.brand,
    nullif(v_model,''),
    case when nullif(v_version,'') is not null then '·' end,
    nullif(v_version,'')
  ));
  return new;
end;
$function$;

revoke all on function public.normalize_automotive_product_service() from public,anon,authenticated;

drop trigger if exists normalize_automotive_product_trigger on public.products;
create trigger normalize_automotive_product_trigger
before insert or update on public.products
for each row
when (new.retailer_type='automotive')
execute function public.normalize_automotive_product_service();

-- Re-run the trigger once for any rows captured before this normalizer existed.
update public.products
set source_metadata=source_metadata
where retailer_type='automotive';
