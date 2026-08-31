
create or replace function public.dispatch_piwen_mercadolibre_worker_sync()
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
  if v_token is null then raise exception 'marketplace_worker_token_missing'; end if;

  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','180000');

  v_response := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/piwen-mercadolibre-search-worker'::varchar,
    array[
      row('x-marketplace-worker-token',v_token)::extensions.http_header,
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

revoke all on function public.dispatch_piwen_mercadolibre_worker_sync() from public,anon,authenticated;
grant execute on function public.dispatch_piwen_mercadolibre_worker_sync() to service_role;
