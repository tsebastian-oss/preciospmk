-- Enforce the co-brand correction at the central products boundary so any
-- crawler/upsert keeps Jack & Coke separate from Coca-Cola soft-drink KPIs.

create or replace function private.normalize_product_brand_before_write()
returns trigger
language plpgsql
set search_path to 'public','private','pg_temp'
as $$
begin
  if regexp_replace(lower(coalesce(new.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g') = 'cocacola'
     and lower(coalesce(new.name,'')) ~ 'jack[[:space:]&-]*coke' then
    new.brand := 'Jack Daniel''s & Coca-Cola';
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_product_brand_before_write() from public, anon, authenticated;

drop trigger if exists normalize_product_brand_before_write on public.products;
create trigger normalize_product_brand_before_write
before insert or update of name, brand on public.products
for each row execute function private.normalize_product_brand_before_write();
