create table if not exists public.industries (
  slug text primary key,
  name text not null,
  description text not null default '',
  retailer_types text[] not null default '{}'::text[],
  display_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.industries(slug,name,description,retailer_types,display_order)
values
  ('all','Todas las industrias','Acceso al universo completo autorizado para la organización.',array['supermarket','department_store'],1),
  ('grocery','Consumo masivo / supermercados','Todo el surtido disponible en supermercados.',array['supermarket'],10),
  ('food','Alimentos','Abarrotes, lácteos, carnes, congelados, snacks y alimentos preparados.',array['supermarket','department_store'],20),
  ('soft_drinks','Bebidas de fantasía, aguas y jugos','Gaseosas, aguas, jugos, néctares, energéticas e isotónicas.',array['supermarket','department_store'],30),
  ('alcoholic_beverages','Bebidas alcohólicas','Cervezas, vinos, espumantes, destilados y licores.',array['supermarket','department_store'],40),
  ('textiles','Textil, vestuario y calzado','Moda, ropa, calzado y accesorios textiles.',array['supermarket','department_store'],50),
  ('technology','Tecnología y electrónica','Computación, telefonía, TV, audio, gaming y electrónica.',array['supermarket','department_store'],60),
  ('home','Hogar, muebles y decoración','Muebles, dormitorio, cocina, baño, decoración y electrohogar.',array['supermarket','department_store'],70),
  ('beauty','Belleza y cuidado personal','Perfumería, maquillaje, cosmética, higiene y cuidado capilar.',array['supermarket','department_store'],80),
  ('health','Salud y farmacia','Salud, farmacia, vitaminas, suplementos y cuidado especializado.',array['supermarket','department_store'],90),
  ('toys','Juguetería y bebé','Juguetes, juegos, productos infantiles y mundo bebé.',array['supermarket','department_store'],100),
  ('sports','Deportes y outdoor','Fitness, running, fútbol, bicicletas, camping y actividades outdoor.',array['supermarket','department_store'],110),
  ('automotive','Automotriz','Neumáticos, repuestos, lubricantes y accesorios para vehículos.',array['supermarket','department_store'],120),
  ('pets','Mascotas','Alimentos, higiene y accesorios para mascotas.',array['supermarket','department_store'],130),
  ('other','Otras categorías','Productos que todavía no pertenecen a una industria especializada.',array['supermarket','department_store'],999)
on conflict (slug) do update set
  name=excluded.name,
  description=excluded.description,
  retailer_types=excluded.retailer_types,
  display_order=excluded.display_order,
  active=true,
  updated_at=now();

alter table public.organization_settings
  add column if not exists industry_slug text null references public.industries(slug);

alter table public.products
  add column if not exists industry_slug text null references public.industries(slug),
  add column if not exists industry_confidence numeric(4,3) not null default 0,
  add column if not exists industry_source text not null default 'rule';

create or replace function public.classify_product_industry(
  p_name text,
  p_category text,
  p_retailer_type text
) returns text
language sql
immutable
set search_path=public,pg_temp
as $$
  with source as (
    select lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) value
  )
  select case
    when value ~ '(destilad|licor|vino|cervez|espumante|champagne|pisco|whisk|\mron\M|vodka|\mgin\M|ginebra|tequila|cognac|brandy|aperitivo|alcoh[oó]l)' then 'alcoholic_beverages'
    when value ~ '(bebida|gaseosa|refresco|agua mineral|agua sabor|jugo|n[eé]ctar|energ[eé]tic|isot[oó]nic|\msoda\M|t[oó]nica|\mcola\M|limonada|kombucha)' then 'soft_drinks'
    when value ~ '(vestuario|moda|ropa|calzado|zapatill|zapato|bot[ií]n|sandalia|polera|poler[oó]n|pantal[oó]n|jean|camisa|blusa|chaqueta|parka|abrigo|sweater|chaleco|short|bermuda|falda|vestido|ropa interior|calcet[ií]n|lencer[ií]a|traje|terno|textil)' then 'textiles'
    when value ~ '(tecnolog|electr[oó]nica|computaci[oó]n|notebook|laptop|celular|smartphone|tablet|televisor|audio|videojuego|consola|c[aá]mara|impresora|monitor|smartwatch|wearable)' then 'technology'
    when value ~ '(hogar|mueble|decoraci[oó]n|dormitorio|cocina|ba[nñ]o|menaje|colch[oó]n|cama|sof[aá]|sill[oó]n|comedor|alfombra|iluminaci[oó]n|jard[ií]n|terraza|electrohogar|electrodom[eé]stico|l[ií]nea blanca)' then 'home'
    when value ~ '(belleza|cuidado personal|higiene|perfume|fragancia|maquillaje|cosm[eé]tic|cabello|shampoo|acondicionador|dermocosm[eé]tica)' then 'beauty'
    when value ~ '(salud|farmacia|medicamento|vitamina|suplemento|ortopedia|primeros auxilios)' then 'health'
    when value ~ '(juguet|mundo beb[eé]|beb[eé]|did[aá]ctic|juegos de mesa|mu[nñ]eca|peluche)' then 'toys'
    when value ~ '(deporte|outdoor|fitness|gimnasio|bicicleta|camping|f[uú]tbol|running|senderismo)' then 'sports'
    when value ~ '(automotriz|neum[aá]tico|repuesto|lubricante|aceite motor|accesorio auto|veh[ií]culo)' then 'automotive'
    when value ~ '(mascota|perro|gato|alimento animal|veterin)' then 'pets'
    when value ~ '(alimento|abarrote|despensa|l[aá]cteo|carne|pollo|pescado|fruta|verdura|congelado|panader[ií]a|pasteler[ií]a|snack|chocolate|cereal|galleta|arroz|pasta|fideo|aceite|salsa|condimento|comida|queso|yogurt|leche|huevo)' then 'food'
    when lower(coalesce(p_retailer_type,''))='supermarket' then 'grocery'
    else 'other'
  end from source;
$$;

create or replace function public.product_industry_allowed(
  p_selected_industry text,
  p_product_industry text,
  p_retailer_type text
) returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select case
    when p_selected_industry is null or p_selected_industry in ('','all') then true
    when p_selected_industry='grocery' then lower(coalesce(p_retailer_type,''))='supermarket'
    else p_product_industry=p_selected_industry
  end;
$$;

create or replace function public.products_apply_industry()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if coalesce(new.industry_source,'rule')<>'manual' then
    new.industry_slug:=public.classify_product_industry(new.name,new.category,new.retailer_type);
    new.industry_confidence:=case when new.industry_slug in ('grocery','other') then 0.550 else 0.900 end;
    new.industry_source:='rule';
  end if;
  return new;
end;
$$;

drop trigger if exists products_apply_industry on public.products;
create trigger products_apply_industry
before insert or update of name,category,retailer_type,industry_source
on public.products
for each row execute function public.products_apply_industry();

create index if not exists products_industry_slug_idx on public.products(industry_slug);
create index if not exists products_retailer_type_industry_idx on public.products(retailer_type,industry_slug);

alter table public.industries enable row level security;
drop policy if exists industries_authenticated_read on public.industries;
create policy industries_authenticated_read on public.industries
for select to authenticated using(active=true);

grant select on public.industries to authenticated;
