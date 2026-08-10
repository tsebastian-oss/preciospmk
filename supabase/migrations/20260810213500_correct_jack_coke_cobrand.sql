-- Retailer feeds label Jack & Coke cans as Coca-Cola. Keep the co-brand out of
-- Coca-Cola soft-drink KPIs and preserve that correction for current daily data.

update public.products
set brand = 'Jack Daniel''s & Coca-Cola',
    updated_at = now()
where regexp_replace(lower(coalesce(brand,'')),'[^[:alnum:]áéíóúüñ]+','','g') = 'cocacola'
  and lower(name) ~ 'jack[[:space:]&-]*coke';

update public.daily_pricing_live d
set brand = 'Jack Daniel''s & Coca-Cola'
from public.products p
where p.id = d.product_id
  and p.brand = 'Jack Daniel''s & Coca-Cola'
  and regexp_replace(lower(coalesce(d.brand,'')),'[^[:alnum:]áéíóúüñ]+','','g') = 'cocacola';
