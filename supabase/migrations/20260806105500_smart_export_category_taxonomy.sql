create or replace function public.smart_product_category(
  p_name text,
  p_category text,
  p_industry_slug text
) returns text
language sql
immutable
set search_path=public,pg_temp
as $$
  with source as (
    select lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) value,
           lower(coalesce(p_industry_slug,'')) industry
  )
  select case
    when value ~ '(vino tinto|cabernet|carmenere|merlot|syrah|pinot noir|malbec)' then 'Vinos tintos'
    when value ~ '(vino blanco|sauvignon blanc|chardonnay|riesling)' then 'Vinos blancos'
    when value ~ '(espumante|champagne|prosecco)' then 'Espumantes'
    when value ~ '(cerveza|lager|ale|stout|ipa)' then 'Cervezas'
    when value ~ '(pisco|whisk|\mron\M|vodka|\mgin\M|ginebra|tequila|cognac|brandy)' then 'Destilados'
    when industry='alcoholic_beverages' then 'Otros vinos y licores'
    when value ~ '(energ[eé]tic|isot[oó]nic|bebida deportiva)' then 'Energéticas e isotónicas'
    when value ~ '(jugo|n[eé]ctar|limonada|kombucha)' then 'Jugos y néctares'
    when value ~ '(agua mineral|agua sabor|agua con gas|agua sin gas)' then 'Aguas'
    when value ~ '(gaseosa|bebida cola|refresco|\msoda\M|t[oó]nica)' then 'Gaseosas y mixers'
    when industry='soft_drinks' then 'Otras bebidas sin alcohol'
    when value ~ '(zapatill|zapato|bot[ií]n|bota|sandalia|calzado)' then 'Calzado'
    when value ~ '(cartera|mochila|bolso|cintur[oó]n|gorro|sombrero|accesorio)' and industry='textiles' then 'Accesorios de moda'
    when value ~ '(ropa interior|lencer[ií]a|calzoncillo|sost[eé]n|pijama)' then 'Ropa interior y dormir'
    when value ~ '(ni[nñ]o|ni[nñ]a|infantil|kids)' and industry='textiles' then 'Vestuario infantil'
    when value ~ '(beb[eé]|reci[eé]n nacido)' and industry in ('textiles','toys') then 'Bebé'
    when value ~ '(mujer|dama|femenin)' and industry='textiles' then 'Vestuario mujer'
    when value ~ '(hombre|caballero|masculin)' and industry='textiles' then 'Vestuario hombre'
    when value ~ '(deportiv|running|fitness)' and industry='textiles' then 'Vestuario deportivo'
    when industry='textiles' then 'Otros textiles y moda'
    when value ~ '(celular|smartphone|telefon[ií]a)' then 'Celulares y telefonía'
    when value ~ '(notebook|laptop|computador|monitor|impresora|computaci[oó]n)' then 'Computación'
    when value ~ '(televisor|smart tv|video)' and industry='technology' then 'TV y video'
    when value ~ '(audio|parlante|aud[ií]fono|soundbar)' then 'Audio'
    when value ~ '(videojuego|consola|gaming|playstation|xbox|nintendo)' then 'Gaming'
    when value ~ '(smartwatch|reloj inteligente|wearable)' then 'Wearables'
    when value ~ '(c[aá]mara|fotograf[ií]a|lente)' and industry='technology' then 'Fotografía'
    when industry='technology' then 'Accesorios y otros tecnología'
    when value ~ '(sof[aá]|sill[oó]n|mesa|comedor|mueble|estante|rack)' then 'Muebles'
    when value ~ '(cuadro|espejo|alfombra|decoraci[oó]n|adorno|coj[ií]n|cortina)' then 'Decoración'
    when value ~ '(colch[oó]n|cama|dormitorio|s[aá]bana|plum[oó]n|almohada)' then 'Dormitorio'
    when value ~ '(menaje|olla|sart[eé]n|vajilla|cubierto|cocina)' and industry='home' then 'Cocina y menaje'
    when value ~ '(ba[nñ]o|toalla|ducha)' and industry='home' then 'Baño'
    when value ~ '(jard[ií]n|terraza|parrilla)' then 'Jardín y terraza'
    when value ~ '(refrigerador|lavadora|secadora|microonda|aspiradora|electrohogar|electrodom[eé]stico)' then 'Electrohogar'
    when value ~ '(l[aá]mpara|iluminaci[oó]n|ampolleta)' then 'Iluminación'
    when industry='home' then 'Otros hogar'
    when value ~ '(shampoo|acondicionador|cabello|capilar)' then 'Cuidado capilar'
    when value ~ '(perfume|fragancia|colonia)' then 'Perfumería'
    when value ~ '(maquillaje|labial|m[aá]scara|base facial|delineador)' then 'Maquillaje'
    when value ~ '(facial|rostro|antiarrugas|serum|s[eé]rum)' then 'Cuidado facial'
    when value ~ '(desodorante|jab[oó]n|higiene|depilaci[oó]n)' then 'Higiene personal'
    when industry='beauty' then 'Cuidado corporal y otros belleza'
    when value ~ '(vitamina|suplemento|prote[ií]na|omega)' then 'Vitaminas y suplementos'
    when value ~ '(ortopedia|primeros auxilios|term[oó]metro)' then 'Cuidado de salud'
    when industry='health' then 'Farmacia y salud'
    when value ~ '(libro|librer[ií]a|escolar|cuaderno|l[aá]piz)' then 'Libros y escolares'
    when value ~ '(juguet|mu[nñ]eca|peluche|did[aá]ctic|juego de mesa)' then 'Juguetes'
    when industry='toys' then 'Bebé y otros infantil'
    when value ~ '(bicicleta|ciclismo)' then 'Bicicletas y ciclismo'
    when value ~ '(f[uú]tbol|bal[oó]n|camiseta deportiva)' then 'Fútbol'
    when value ~ '(camping|outdoor|senderismo|trekking)' then 'Outdoor y camping'
    when value ~ '(fitness|gimnasio|mancuerna|entrenamiento)' then 'Fitness'
    when industry='sports' then 'Otros deportes'
    when value ~ '(neum[aá]tico)' then 'Neumáticos'
    when value ~ '(lubricante|aceite motor)' then 'Lubricantes'
    when value ~ '(repuesto)' then 'Repuestos'
    when industry='automotive' then 'Accesorios automotrices'
    when value ~ '(perro|canino)' then 'Perros'
    when value ~ '(gato|felino)' then 'Gatos'
    when industry='pets' then 'Otras mascotas'
    when value ~ '(leche|yogurt|yoghurt|queso|l[aá]cteo)' then 'Lácteos'
    when value ~ '(carne|pollo|pavo|cerdo|vacuno|pescado|marisco)' then 'Carnes, pescados y proteínas'
    when value ~ '(fruta|verdura|hortaliza)' then 'Frutas y verduras'
    when value ~ '(pan|panader[ií]a|pasteler[ií]a|torta)' then 'Panadería y pastelería'
    when value ~ '(congelado|helado)' then 'Congelados'
    when value ~ '(snack|papas fritas|chocolate|galleta|picoteo)' then 'Snacks y confites'
    when value ~ '(arroz|pasta|fideo|harina|legumbre|cereal)' then 'Despensa y abarrotes'
    when value ~ '(aceite|sal|condimento|salsa|aderezo)' then 'Aceites, salsas y condimentos'
    when value ~ '(caf[eé]|t[eé]|hierba|infusi[oó]n)' then 'Café, té e infusiones'
    when value ~ '(fiambre|embutido)' then 'Fiambres y embutidos'
    when industry in ('food','grocery') then 'Otros alimentos y supermercado'
    else 'Otros productos'
  end from source;
$$;

alter table public.products add column if not exists smart_category text;

create or replace function public.products_apply_smart_category()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.smart_category:=public.smart_product_category(new.name,new.category,new.industry_slug);
  return new;
end;
$$;

drop trigger if exists products_apply_smart_category on public.products;
create trigger products_apply_smart_category
before insert or update of name,category,industry_slug
on public.products
for each row execute function public.products_apply_smart_category();

create index if not exists products_industry_smart_category_idx on public.products(industry_slug,smart_category);
create index if not exists products_retailer_smart_category_idx on public.products(supermarket,smart_category);

create or replace function public.backfill_smart_product_categories_service(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_count integer;
begin
  with batch as (
    select id from public.products where smart_category is null
    order by id limit greatest(1,least(coalesce(p_limit,1000),5000)) for update skip locked
  )
  update public.products p
  set smart_category=public.smart_product_category(p.name,p.category,p.industry_slug)
  from batch where p.id=batch.id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

grant execute on function public.backfill_smart_product_categories_service(integer) to service_role;

create or replace view public.enterprise_price_export_rows
with (security_invoker=true)
as
select
  d.product_id,d.price_date,d.observed_at,d.observation_id,d.supermarket,
  p.external_id,p.name,p.brand,p.category,p.url,p.image_url,
  o.regular_price,o.offer_price,d.effective_price,o.unit,o.unit_price,o.in_stock,
  p.retailer_type,p.industry_slug,
  coalesce(p.smart_category,public.smart_product_category(p.name,p.category,p.industry_slug)) smart_category
from public.daily_pricing_live d
join public.products p on p.id=d.product_id
join public.price_observations o on o.id=d.observation_id;

grant select on public.enterprise_price_export_rows to authenticated;

create or replace function public.enterprise_export_filter_options(
  p_organization_id uuid,
  p_retailer text default null,
  p_category text default null,
  p_search text default null,
  p_limit integer default 800
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_retailers text[];
  v_brands text[];
  v_categories text[];
  v_industry text;
  v_limit integer := greatest(50,least(coalesce(p_limit,800),2500));
begin
  perform public.enterprise_access_context(p_organization_id,'overview');
  select s.retailers,s.brands,s.categories,os.industry_slug
  into v_retailers,v_brands,v_categories,v_industry
  from public.organization_scopes s
  left join public.organization_settings os on os.organization_id=s.organization_id
  where s.organization_id=p_organization_id;

  if p_retailer is not null and coalesce(cardinality(v_retailers),0)>0
     and not exists(select 1 from unnest(v_retailers) r where lower(r)=lower(p_retailer)) then
    raise exception 'retailer_not_allowed' using errcode='42501';
  end if;

  return (
    with filtered as materialized (
      select p.id,p.supermarket,p.external_id,p.name,p.brand,p.category,
        coalesce(p.smart_category,public.smart_product_category(p.name,p.category,p.industry_slug)) smart_category,
        p.retailer_type,p.industry_slug
      from public.products p
      where exists(select 1 from public.price_observations po where po.product_id=p.id and po.crawl_run_id is not null)
        and (coalesce(cardinality(v_retailers),0)=0 or p.supermarket=any(v_retailers))
        and (coalesce(cardinality(v_brands),0)=0 or exists(select 1 from unnest(v_brands) b where lower(b)=lower(coalesce(p.brand,''))))
        and (coalesce(cardinality(v_categories),0)=0 or exists(select 1 from unnest(v_categories) c where lower(c)=lower(coalesce(p.category,''))))
        and public.product_industry_allowed(v_industry,p.industry_slug,p.retailer_type)
        and (p_retailer is null or lower(p.supermarket)=lower(p_retailer))
    ), category_rows as (
      select smart_category,count(*)::integer products,count(distinct supermarket)::integer retailers
      from filtered where nullif(btrim(smart_category),'') is not null group by smart_category
    ), matching_products as materialized (
      select id,supermarket,external_id,name,brand,category,smart_category,industry_slug
      from filtered
      where p_category is not null and lower(coalesce(smart_category,''))=lower(p_category)
        and (nullif(btrim(coalesce(p_search,'')),'') is null
          or lower(name) like '%'||lower(btrim(p_search))||'%'
          or lower(coalesce(brand,'')) like '%'||lower(btrim(p_search))||'%'
          or lower(external_id) like '%'||lower(btrim(p_search))||'%')
    ), product_rows as (
      select * from matching_products order by name,brand,supermarket,external_id limit v_limit
    )
    select jsonb_build_object(
      'industrySlug',v_industry,'aiFiltered',true,'retailer',p_retailer,'category',p_category,
      'categories',coalesce((select jsonb_agg(jsonb_build_object('value',smart_category,'label',smart_category,'products',products,'retailers',retailers) order by products desc,smart_category) from category_rows),'[]'::jsonb),
      'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'externalId',external_id,'name',name,'brand',brand,'supermarket',supermarket,'category',smart_category,'rawCategory',category,'industrySlug',industry_slug) order by name,brand,supermarket,external_id) from product_rows),'[]'::jsonb),
      'productCount',(select count(*)::integer from matching_products),
      'truncated',(select count(*)>v_limit from matching_products),'limit',v_limit
    )
  );
end;
$$;

grant execute on function public.enterprise_export_filter_options(uuid,text,text,text,integer) to authenticated;
