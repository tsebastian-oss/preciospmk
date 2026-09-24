
create or replace function public.trigger_automotive_financing_worker()
returns bigint
language plpgsql
security definer
set search_path to 'public','vault','net','pg_temp'
as $$
declare
  v_worker_token text;
  v_anon_jwt text;
  v_request_id bigint;
begin
  select decrypted_secret into v_worker_token
  from vault.decrypted_secrets where name='automotive_financing_worker_token' limit 1;
  select decrypted_secret into v_anon_jwt
  from vault.decrypted_secrets where name='automotive_financing_anon_jwt' limit 1;
  if nullif(v_worker_token,'') is null or nullif(v_anon_jwt,'') is null then
    raise exception 'automotive financing worker secrets missing';
  end if;
  select net.http_post(
    url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/automotive-financing-worker',
    headers := jsonb_build_object(
      'Authorization','Bearer ' || v_anon_jwt,
      'Content-Type','application/json',
      'x-automotive-financing-token',v_worker_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.trigger_automotive_financing_worker() from public, anon, authenticated;
grant execute on function public.trigger_automotive_financing_worker() to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname='automotive-financing-daily') then
    perform cron.schedule(
      'automotive-financing-daily',
      '15 11 * * *',
      'select public.trigger_automotive_financing_worker();'
    );
  end if;
end $$;
