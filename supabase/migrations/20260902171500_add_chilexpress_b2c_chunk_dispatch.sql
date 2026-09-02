create or replace function private.dispatch_chilexpress_b2c_chunk(
  p_destinations text[],
  p_trigger text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_token text;
  v_id bigint;
  v_trigger text := case when p_trigger in ('manual','schedule','backfill') then p_trigger else 'manual' end;
  v_destinations text[];
begin
  select token into v_token from public.qsr_worker_config where id=1;
  if v_token is null or length(v_token)<10 then
    raise exception 'worker token unavailable';
  end if;

  select array_agg(distinct d order by d)
  into v_destinations
  from unnest(coalesce(p_destinations,'{}'::text[])) d
  where d = any(array[
    'Santiago Centro','Rancagua','Valparaíso','Talca','Chillán','Concepción','La Serena',
    'Copiapó','Temuco','Valdivia','Puerto Montt','Antofagasta','Iquique','Arica'
  ]::text[]);

  if coalesce(array_length(v_destinations,1),0)=0 then
    raise exception 'no valid destinations';
  end if;
  if array_length(v_destinations,1)>6 then
    raise exception 'maximum 6 destinations per chunk';
  end if;

  select net.http_post(
    url := 'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/chilexpress-b2c-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-chilexpress-worker-token',v_token
    ),
    body := jsonb_build_object(
      'provider','chilexpress',
      'trigger',v_trigger,
      'destinations',to_jsonb(v_destinations)
    ),
    timeout_milliseconds := 120000
  ) into v_id;

  return jsonb_build_object(
    'requestId',v_id,
    'destinations',to_jsonb(v_destinations),
    'trigger',v_trigger,
    'dispatchedAt',now()
  );
end
$function$;
