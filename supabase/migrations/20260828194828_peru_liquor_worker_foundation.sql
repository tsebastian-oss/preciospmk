create schema if not exists private;

create table if not exists private.peru_liquor_worker_config (
  id integer primary key check (id = 1),
  token text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

revoke all on table private.peru_liquor_worker_config from public, anon, authenticated;

insert into private.peru_liquor_worker_config(id, token, enabled)
values (1, encode(gen_random_bytes(32), 'hex'), true)
on conflict (id) do update set enabled = true, updated_at = now();

insert into public.brands_vertical_brands(slug,name,country_code,official_url,status)
values ('bodegas-don-luis','Bodegas Don Luis','PE','https://www.bodegasdonluis.pe/','active')
on conflict (slug) do update
set name=excluded.name,
    country_code=excluded.country_code,
    official_url=excluded.official_url,
    status='active',
    updated_at=now();

create or replace function public.verify_peru_liquor_worker_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select exists(
    select 1
    from private.peru_liquor_worker_config
    where id=1 and enabled and token = p_token
  );
$$;

revoke all on function public.verify_peru_liquor_worker_token(text) from public, anon, authenticated;
grant execute on function public.verify_peru_liquor_worker_token(text) to service_role;

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
