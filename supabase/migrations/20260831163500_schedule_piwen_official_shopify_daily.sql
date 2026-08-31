
create or replace function public.dispatch_piwen_official_shopify_worker_sync()
returns jsonb
language plpgsql
security definer
set search_path = public,extensions
as $$
declare
  v_token text;
  v_response extensions.http_response;
begin
  select token into v_token from public.qsr_worker_config where id=1;
  if v_token is null then raise exception 'piwen_worker_token_missing'; end if;

  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');

  v_response := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/piwen-official-shopify-worker'::varchar,
    array[
      row('x-piwen-worker-token',v_token)::extensions.http_header,
      row('accept','application/json')::extensions.http_header
    ],
    'application/json'::varchar,
    '{}'::varchar
  )::extensions.http_request);

  return jsonb_build_object(
    'status', v_response.status,
    'content', case when coalesce(v_response.content,'')='' then '{}'::jsonb else v_response.content::jsonb end
  );
end;
$$;

revoke all on function public.dispatch_piwen_official_shopify_worker_sync() from public,anon,authenticated;
grant execute on function public.dispatch_piwen_official_shopify_worker_sync() to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='piwen-official-daily' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- 10:35 UTC = 06:35 Chile during winter time. Runs after MercadoLibre.
select cron.schedule(
  'piwen-official-daily',
  '35 10 * * *',
  'select public.dispatch_piwen_official_shopify_worker_sync();'
);
