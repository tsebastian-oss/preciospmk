create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists http with schema extensions;

create or replace function public.dispatch_qsr_pricing_worker_sync()
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
  if v_token is null then raise exception 'qsr_worker_token_missing'; end if;
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
  v_response := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/qsr-pricing-worker'::varchar,
    array[
      row('x-qsr-worker-token',v_token)::extensions.http_header,
      row('accept','application/json')::extensions.http_header
    ],
    'application/json'::varchar,
    '{"slug":"all"}'::varchar
  )::extensions.http_request);
  return jsonb_build_object(
    'status',v_response.status,
    'content',case when coalesce(v_response.content,'')='' then '{}'::jsonb else v_response.content::jsonb end
  );
end;
$$;

revoke all on function public.dispatch_qsr_pricing_worker_sync() from public,anon,authenticated;
grant execute on function public.dispatch_qsr_pricing_worker_sync() to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='qsr-pricing-refresh-6h' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'qsr-pricing-refresh-6h',
  '17 */6 * * *',
  'select public.dispatch_qsr_pricing_worker_sync();'
);
