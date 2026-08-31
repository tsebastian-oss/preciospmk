
create or replace function public.dispatch_victorinox_search_worker_sync(p_mode text default 'official')
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_token text;
  v_response extensions.http_response;
  v_body text;
begin
  select token into v_token from public.qsr_worker_config where id=1;
  if v_token is null then raise exception 'victorinox_worker_token_missing'; end if;
  v_body := jsonb_build_object('mode',case when p_mode='marketplace' then 'marketplace' else 'official' end)::text;
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','180000');
  v_response := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/victorinox-search-worker'::varchar,
    array[
      row('x-victorinox-worker-token',v_token)::extensions.http_header,
      row('accept','application/json')::extensions.http_header
    ],
    'application/json'::varchar,
    v_body::varchar
  )::extensions.http_request);
  return jsonb_build_object('status',v_response.status,'content',case when coalesce(v_response.content,'')='' then '{}'::jsonb else v_response.content::jsonb end);
end;
$$;

revoke all on function public.dispatch_victorinox_search_worker_sync(text) from public,anon,authenticated;
grant execute on function public.dispatch_victorinox_search_worker_sync(text) to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname in ('victorinox-official-daily','victorinox-mercadolibre-daily') loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule('victorinox-official-daily','50 10 * * *',$$select public.dispatch_victorinox_search_worker_sync('official');$$);
select cron.schedule('victorinox-mercadolibre-daily','5 11 * * *',$$select public.dispatch_victorinox_search_worker_sync('marketplace');$$);
