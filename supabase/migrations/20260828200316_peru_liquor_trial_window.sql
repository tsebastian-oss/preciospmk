alter table private.peru_liquor_worker_config
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz;

update private.peru_liquor_worker_config
set trial_started_at=coalesce(trial_started_at,now()),
    trial_ends_at=coalesce(trial_ends_at,now()+interval '30 days'),
    updated_at=now()
where id=1;

create or replace function public.dispatch_peru_liquor_pricing_worker_sync()
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_token text;
  v_trial_ends_at timestamptz;
  v_response extensions.http_response;
begin
  select token,trial_ends_at into v_token,v_trial_ends_at
  from private.peru_liquor_worker_config
  where id=1 and enabled and coalesce(trial_ends_at,now()+interval '1 minute')>now();

  if v_token is null then
    return jsonb_build_object('status','trial_ended','trialEndsAt',v_trial_ends_at);
  end if;

  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');

  v_response := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/peru-liquor-pricing-worker'::varchar,
    array[
      row('x-worker-token',v_token)::extensions.http_header,
      row('accept','application/json')::extensions.http_header
    ],
    'application/json'::varchar,
    '{"slug":"bodegas-don-luis"}'::varchar
  )::extensions.http_request);

  return jsonb_build_object(
    'status',v_response.status,
    'trialEndsAt',v_trial_ends_at,
    'content',case when coalesce(v_response.content,'')='' then '{}'::jsonb else v_response.content::jsonb end
  );
end;
$$;

revoke all on function public.dispatch_peru_liquor_pricing_worker_sync() from public,anon,authenticated;
grant execute on function public.dispatch_peru_liquor_pricing_worker_sync() to service_role;
