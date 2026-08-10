do $block$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='finalize_catalog_run_assortment_service'
    and pg_get_function_identity_arguments(p.oid)='p_run_id bigint';

  if v_oid is null then
    raise exception 'finalize_catalog_run_assortment_service(bigint) not found';
  end if;

  v_def:=pg_get_functiondef(v_oid);

  if position('v_vertical text' in v_def)=0 then
    v_def:=replace(v_def,
      '  v_summary jsonb;',
      '  v_summary jsonb;'||chr(10)||'  v_vertical text;');
  end if;

  if position('select vertical into v_vertical' in lower(v_def))=0 then
    v_def:=replace(v_def,
      '  perform pg_advisory_xact_lock(824631973, p_run_id::integer);',
      '  perform pg_advisory_xact_lock(824631973, p_run_id::integer);'||chr(10)||chr(10)||
      '  select vertical into v_vertical from public.catalog_crawl_runs where id=p_run_id;');
  end if;

  v_def:=replace(v_def,
    '  where r.id < p_run_id'||chr(10)||'    and r.status in (''completed'',''completed_with_errors'')',
    '  where r.id < p_run_id'||chr(10)||'    and r.vertical = v_vertical'||chr(10)||'    and r.status in (''completed'',''completed_with_errors'')');

  v_def:=replace(v_def,
    '    from public.catalog_run_product_snapshots h'||chr(10)||
    '    where h.crawl_run_id < coalesce(v_previous_run_id, p_run_id)',
    '    from public.catalog_run_product_snapshots h'||chr(10)||
    '    join public.catalog_crawl_runs hr on hr.id=h.crawl_run_id'||chr(10)||
    '    where hr.vertical=v_vertical'||chr(10)||
    '      and h.crawl_run_id < coalesce(v_previous_run_id, p_run_id)');

  execute v_def;
end
$block$;
