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
set search_path = public, pg_temp
as $$
  with source as (
    select lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) as value
  )
  select case
    when value ~ '(destilad|licor|vino|cervez|espumante|champagne|pisco|whisk|\mron\M|vodka|\mgin\M|ginebra|tequila|cognac|brandy|aperitivo|alcoh[oó]l)' then 'alcoholic_beverages'
    when value ~ '(bebida|gaseosa|refresco|agua mineral|agua sabor|jugo|n[eé]ctar|energ[eé]tic|isot[oó]nic|\msoda\M|t[oó]nica|\mcola\M|limonada|kombucha)' then 'soft_drinks'
    when value ~ '(vestuario|\bmoda\b|\bropa\b|calzado|zapatill|zapato|bot[ií]n|sandalia|polera|poler[oó]n|pantal[oó]n|\bjean|camisa|blusa|chaqueta|parka|abrigo|sweater|chaleco|\bshort|bermuda|falda|vestido|ropa interior|calcet[ií]n|lencer[ií]a|traje|terno|textil)' then 'textiles'
    when value ~ '(tecnolog|electr[oó]nica|computaci[oó]n|notebook|laptop|celular|smartphone|tablet|televisor|audio|videojuego|consola|c[aá]mara|impresora|monitor|smartwatch|wearable)' then 'technology'
    when value ~ '(hogar|mueble|decoraci[oó]n|dormitorio|cocina|ba[nñ]o|menaje|colch[oó]n|\bcama\b|sof[aá]|sill[oó]n|comedor|alfombra|iluminaci[oó]n|jard[ií]n|terraza|electrohogar|electrodom[eé]stico|l[ií]nea blanca)' then 'home'
    when value ~ '(belleza|cuidado personal|higiene|perfume|fragancia|maquillaje|cosm[eé]tic|cabello|shampoo|acondicionador|dermocosm[eé]tica)' then 'beauty'
    when value ~ '(salud|farmacia|medicamento|vitamina|suplemento|ortopedia|primeros auxilios)' then 'health'
    when value ~ '(juguet|mundo beb[eé]|\bbeb[eé]\b|did[aá]ctic|juegos de mesa|mu[nñ]eca|peluche)' then 'toys'
    when value ~ '(deporte|outdoor|fitness|gimnasio|bicicleta|camping|f[uú]tbol|running|senderismo)' then 'sports'
    when value ~ '(automotriz|neum[aá]tico|repuesto|lubricante|aceite motor|accesorio auto|veh[ií]culo)' then 'automotive'
    when value ~ '(mascota|perro|gato|alimento animal|veterin)' then 'pets'
    when value ~ '(alimento|abarrote|despensa|l[aá]cteo|carne|pollo|pescado|fruta|verdura|congelado|panader[ií]a|pasteler[ií]a|snack|chocolate|cereal|galleta|arroz|pasta|fideo|aceite|salsa|condimento|comida|queso|yogurt|leche|huevo)' then 'food'
    when lower(coalesce(p_retailer_type,''))='supermarket' then 'grocery'
    else 'other'
  end
  from source;
$$;

create or replace function public.product_industry_allowed(
  p_selected_industry text,
  p_product_industry text,
  p_retailer_type text
) returns boolean
language sql
immutable
set search_path = public, pg_temp
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
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.industry_source,'rule') <> 'manual' then
    new.industry_slug := public.classify_product_industry(new.name,new.category,new.retailer_type);
    new.industry_confidence := case when new.industry_slug in ('grocery','other') then 0.550 else 0.900 end;
    new.industry_source := 'rule';
  end if;
  return new;
end;
$$;

drop trigger if exists products_apply_industry on public.products;
create trigger products_apply_industry
before insert or update of name,category,retailer_type,industry_source
on public.products
for each row execute function public.products_apply_industry();

update public.products
set industry_slug=public.classify_product_industry(name,category,retailer_type),
    industry_confidence=case
      when public.classify_product_industry(name,category,retailer_type) in ('grocery','other') then 0.550
      else 0.900
    end,
    industry_source='rule'
where industry_source <> 'manual'
  and (industry_slug is null or industry_confidence=0);

create index if not exists products_industry_slug_idx on public.products(industry_slug);
create index if not exists products_retailer_type_industry_idx on public.products(retailer_type,industry_slug);

alter table public.industries enable row level security;
drop policy if exists industries_authenticated_read on public.industries;
create policy industries_authenticated_read on public.industries
for select to authenticated using (active=true);

grant select on public.industries to authenticated;

create or replace view public.dashboard_products
with (security_invoker=true)
as
select
  p.id,
  p.supermarket,
  p.retailer_type,
  p.industry_slug,
  p.external_id,
  btrim(replace(replace(replace(replace(p.name,'&nbsp;',' '),'&amp;','&'),'&quot;','"'),'&#39;','''')) as name,
  p.brand,
  case
    when p.category is null or length(btrim(p.category))<=1 then null
    when p.category='juguetera a' then 'Juguetería'
    when p.category='librera a' then 'Librería'
    when p.category='tecnologa a' then 'Tecnología'
    when p.category='muebles y decoracion' then 'Muebles y decoración'
    when p.category='menaje cocina' then 'Menaje de cocina'
    when p.category='menaje comedor' then 'Menaje de comedor'
    when p.category='rutina para el cabello' then 'Cuidado capilar'
    when p.category='vestuario' then 'Vestuario'
    when p.category='electrohogar' then 'Electrohogar'
    when p.category='dormitorio' then 'Dormitorio'
    when p.category='destilados' then 'Destilados'
    when p.category='supermercado' then 'Supermercado'
    else p.category
  end as category,
  p.url,
  p.image_url,
  p.seller,
  p.variant,
  o.regular_price,
  o.offer_price,
  o.unit,
  o.unit_price,
  o.in_stock,
  o.observed_at,
  greatest(coalesce(o.regular_price,o.offer_price)-o.offer_price,0) as savings,
  case when o.regular_price is not null and o.regular_price>o.offer_price and o.offer_price>0
    then round((o.regular_price-o.offer_price)/o.regular_price*100,1)
    else 0 end as discount_pct
from public.products p
join lateral (
  select po.regular_price,po.offer_price,po.unit,po.unit_price,po.in_stock,po.observed_at
  from public.price_observations po
  where po.product_id=p.id and po.crawl_run_id is not null
  order by po.observed_at desc
  limit 1
) o on true
where p.retailer_type in ('supermarket','department_store');

grant select on public.dashboard_products to authenticated, anon;

create or replace view public.enterprise_price_export_rows
with (security_invoker=true)
as
select
  d.product_id,d.price_date,d.observed_at,d.observation_id,d.supermarket,
  p.retailer_type,p.industry_slug,p.external_id,p.name,p.brand,p.category,p.url,p.image_url,
  o.regular_price,o.offer_price,d.effective_price,o.unit,o.unit_price,o.in_stock
from public.daily_pricing_live d
join public.products p on p.id=d.product_id
join public.price_observations o on o.id=d.observation_id;

grant select on public.enterprise_price_export_rows to authenticated;

create or replace function public.enterprise_set_industry(
  p_organization_id uuid,
  p_industry_slug text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_industry public.industries;
  v_current text;
begin
  if p_organization_id is null then raise exception 'organization required'; end if;
  if not public.enterprise_is_org_member(p_organization_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into v_industry from public.industries where slug=p_industry_slug and active=true;
  if v_industry.slug is null then raise exception 'invalid industry'; end if;

  select industry_slug into v_current
  from public.organization_settings
  where organization_id=p_organization_id;

  if v_current is not null
     and not public.is_saas_admin()
     and not public.enterprise_has_org_role(p_organization_id,array['owner','admin']::text[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  insert into public.organization_settings(organization_id,industry_slug,updated_by,updated_at)
  values(p_organization_id,v_industry.slug,auth.uid(),now())
  on conflict (organization_id) do update set
    industry_slug=excluded.industry_slug,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'industry.selected','organization',p_organization_id::text,
    jsonb_build_object('previousIndustry',v_current,'industrySlug',v_industry.slug,'industryName',v_industry.name));

  return jsonb_build_object('industrySlug',v_industry.slug,'industryName',v_industry.name);
end;
$$;

grant execute on function public.enterprise_set_industry(uuid,text) to authenticated;

create or replace function public.enterprise_access_context(p_organization_id uuid,p_module text default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public, private
as $$
declare
  v_org public.organizations;
  v_scopes public.organization_scopes;
  v_settings public.organization_settings;
  v_industry_name text;
  v_role text;
  v_allowed boolean;
begin
  if p_organization_id is null then raise exception 'organization required'; end if;
  if not public.enterprise_is_org_member(p_organization_id) then raise exception 'forbidden' using errcode='42501'; end if;

  select * into v_org from public.organizations where id=p_organization_id;
  if v_org.id is null then raise exception 'organization not found'; end if;
  if not public.is_saas_admin() and v_org.status not in ('trial','active') then raise exception 'organization suspended' using errcode='42501'; end if;

  select * into v_scopes from public.organization_scopes where organization_id=p_organization_id;
  select * into v_settings from public.organization_settings where organization_id=p_organization_id;
  select name into v_industry_name from public.industries where slug=v_settings.industry_slug;
  v_role:=coalesce(private.enterprise_member_role(p_organization_id,auth.uid()),case when public.is_saas_admin() then 'saas_admin' end);
  v_allowed:=p_module is null or coalesce(cardinality(v_scopes.modules),0)=0 or p_module=any(v_scopes.modules) or public.is_saas_admin();
  if not v_allowed then raise exception 'module not enabled' using errcode='42501'; end if;

  return jsonb_build_object(
    'organizationId',v_org.id,'organizationName',v_org.name,'organizationType',v_org.organization_type,
    'status',v_org.status,'plan',v_org.plan,'role',v_role,'module',p_module,'moduleAllowed',v_allowed,
    'retailers',coalesce(to_jsonb(v_scopes.retailers),'[]'::jsonb),
    'brands',coalesce(to_jsonb(v_scopes.brands),'[]'::jsonb),
    'competitors',coalesce(to_jsonb(v_scopes.competitors),'[]'::jsonb),
    'categories',coalesce(to_jsonb(v_scopes.categories),'[]'::jsonb),
    'modules',coalesce(to_jsonb(v_scopes.modules),'[]'::jsonb),
    'limits',coalesce(v_scopes.limits,'{}'::jsonb),
    'settings',to_jsonb(v_settings),
    'industrySlug',v_settings.industry_slug,
    'industryName',v_industry_name,
    'industryConfigured',v_settings.industry_slug is not null,
    'isSaasAdmin',public.is_saas_admin()
  );
end;
$$;

create or replace function public.enterprise_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public, private
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with filtered as (
      select * from public.dashboard_products p
      where (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(p.brand,''))))
        and (coalesce(cardinality(v_categories),0)=0 or exists(select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(p.category,''))))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), summary as (
      select jsonb_build_object(
        'total_products',count(*),'in_stock_products',count(*) filter(where in_stock),
        'offers',count(*) filter(where coalesce(discount_pct,0)>0),'supermarkets',count(distinct supermarket),
        'average_price',coalesce(round(avg(nullif(coalesce(offer_price,regular_price),0)),2),0),
        'total_savings',coalesce(round(sum(coalesce(savings,0)),2),0),'last_updated',max(observed_at)
      ) value from filtered
    ), stores as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'supermarket',supermarket,'products',products,'in_stock',in_stock,'offers',offers,
        'average_price',average_price,'average_discount',average_discount,'last_updated',last_updated
      ) order by products desc),'[]'::jsonb) value
      from (
        select supermarket,count(*) products,count(*) filter(where in_stock) in_stock,
          count(*) filter(where coalesce(discount_pct,0)>0) offers,
          coalesce(round(avg(nullif(coalesce(offer_price,regular_price),0)),2),0) average_price,
          coalesce(round(avg(coalesce(discount_pct,0)),2),0) average_discount,max(observed_at) last_updated
        from filtered group by supermarket
      ) s
    ), categories as (
      select coalesce(jsonb_agg(jsonb_build_object('supermarket',supermarket,'category',category,'products',products) order by products desc),'[]'::jsonb) value
      from (
        select supermarket,coalesce(category,'Sin categoría') category,count(*) products
        from filtered group by supermarket,coalesce(category,'Sin categoría') order by products desc limit 1000
      ) c
    ), offers as (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.discount_pct desc,x.savings desc),'[]'::jsonb) value
      from (
        select id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at,savings,discount_pct
        from filtered where coalesce(discount_pct,0)>0 order by discount_pct desc,savings desc limit 8
      ) x
    ), latest_run as (
      select to_jsonb(r) value from (
        select id,status,vertical,started_at,finished_at,tasks_total,tasks_completed,tasks_failed,products_found,source_counts,errors
        from public.catalog_crawl_runs order by id desc limit 1
      ) r
    )
    select jsonb_build_object(
      'summary',(select value from summary),'supermarkets',(select value from stores),
      'categories',(select value from categories),'run',(select value from latest_run),
      'topOffers',(select value from offers),'organizationId',p_organization_id,'industrySlug',v_industry
    )
  );
end;
$$;

create or replace function public.enterprise_export_availability(p_organization_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public, private, pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select s.retailers,s.brands,s.categories,os.industry_slug
    into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  return (
    with scoped as (
      select d.*
      from public.daily_pricing_live d
      join public.products p on p.id=d.product_id
      where (coalesce(cardinality(v_retailers),0)=0 or d.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(d.brand,''))))
        and (coalesce(cardinality(v_categories),0)=0 or exists(select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(d.category,''))))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
    ), retailer_rows as (
      select supermarket,count(*)::bigint observations from scoped group by supermarket
    )
    select jsonb_build_object(
      'firstDate',min(price_date),'lastDate',max(price_date),'observations',count(*),
      'products',count(distinct product_id),'industrySlug',v_industry,
      'retailers',coalesce((select jsonb_agg(jsonb_build_object('supermarket',supermarket,'observations',observations) order by supermarket) from retailer_rows),'[]'::jsonb)
    ) from scoped
  );
end;
$$;
