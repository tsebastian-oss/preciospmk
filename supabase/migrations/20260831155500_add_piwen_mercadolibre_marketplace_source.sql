
-- Add MercadoLibre Chile as a marketplace source for the Piwén competitive vertical.
-- The worker scrapes Piwén, Alto La Cruz and Millantú sequentially to protect platform stability.

insert into public.brands_vertical_sources (
  brand_id, retailer_name, domain, source_type, search_url, priority, active, discovered_at
)
select
  b.id,
  'MercadoLibre Chile',
  'mercadolibre.cl',
  'marketplace',
  'https://listado.mercadolibre.cl/frutos-secos-piwen',
  110,
  true,
  now()
from public.brands_vertical_brands b
where b.slug = 'piwen'
on conflict (brand_id, domain) do update
set retailer_name = excluded.retailer_name,
    source_type = excluded.source_type,
    search_url = excluded.search_url,
    priority = excluded.priority,
    active = true;

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
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');

  v_response := extensions.http((
    'POST'::extensions.http_method,
    'https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/piwen-mercadolibre-worker'::varchar,
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

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='piwen-mercadolibre-daily' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

-- 10:23 UTC = 06:23 Chile during standard winter offset (-04).
select cron.schedule(
  'piwen-mercadolibre-daily',
  '23 10 * * *',
  'select public.dispatch_piwen_mercadolibre_worker_sync();'
);
