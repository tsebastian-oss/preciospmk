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
    when value ~ '(detergente|lavaloza|limpiador|desinfectante|suavizante|cloro|papel higi[eé]nico|bolsa.*basura|limpieza de ropa)' then 'home'
    when value ~ '(destilad|licor|vino|cervez|espumante|champagne|pisco|whisk|\mron\M|vodka|\mgin\M|ginebra|tequila|cognac|brandy|aperitivo|alcoh[oó]l)' then 'alcoholic_beverages'
    when value ~ '(bebida|gaseosa|refresco|agua mineral|agua sabor|jugo|n[eé]ctar|energ[eé]tic|isot[oó]nic|\msoda\M|t[oó]nica|\mcola\M|limonada|kombucha)' then 'soft_drinks'
    when value ~ '(vestuario|moda|\mropa\M|calzado|zapatill|zapato|bot[ií]n|sandalia|polera|poler[oó]n|pantal[oó]n|jean|camisa|blusa|chaqueta|parka|abrigo|sweater|chaleco|short|bermuda|falda|vestido|ropa interior|calcet[ií]n|lencer[ií]a|traje|terno|textil)' then 'textiles'
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
  select case industry
    when 'alcoholic_beverages' then case
      when value ~ '(vino tinto|cabernet|carmenere|merlot|syrah|pinot noir|malbec)' then 'Vinos tintos'
      when value ~ '(vino blanco|sauvignon blanc|chardonnay|riesling)' then 'Vinos blancos'
      when value ~ '(espumante|champagne|prosecco)' then 'Espumantes'
      when value ~ '(\mcerveza|\mlager\M|\male\M|\mstout\M|\mipa\M)' then 'Cervezas'
      when value ~ '(pisco|whisk|\mron\M|vodka|\mgin\M|ginebra|tequila|cognac|brandy)' then 'Destilados'
      else 'Otros vinos y licores' end
    when 'soft_drinks' then case
      when value ~ '(energ[eé]tic|isot[oó]nic|bebida deportiva)' then 'Energéticas e isotónicas'
      when value ~ '(jugo|n[eé]ctar|limonada|kombucha)' then 'Jugos y néctares'
      when value ~ '(agua mineral|agua sabor|agua con gas|agua sin gas)' then 'Aguas'
      when value ~ '(gaseosa|bebida cola|refresco|\msoda\M|t[oó]nica)' then 'Gaseosas y mixers'
      else 'Otras bebidas sin alcohol' end
    when 'textiles' then case
      when value ~ '(zapatill|zapato|bot[ií]n|\mbota\M|sandalia|calzado)' then 'Calzado'
      when value ~ '(cartera|mochila|bolso|cintur[oó]n|gorro|sombrero|accesorio)' then 'Accesorios de moda'
      when value ~ '(ropa interior|lencer[ií]a|calzoncillo|sost[eé]n|pijama)' then 'Ropa interior y dormir'
      when value ~ '(ni[nñ]o|ni[nñ]a|infantil|\mkids\M)' then 'Vestuario infantil'
      when value ~ '(beb[eé]|reci[eé]n nacido)' then 'Bebé'
      when value ~ '(mujer|dama|femenin)' then 'Vestuario mujer'
      when value ~ '(hombre|caballero|masculin)' then 'Vestuario hombre'
      when value ~ '(deportiv|running|fitness)' then 'Vestuario deportivo'
      else 'Otros textiles y moda' end
    when 'technology' then case
      when value ~ '(celular|smartphone|telefon[ií]a)' then 'Celulares y telefonía'
      when value ~ '(notebook|laptop|computador|monitor|impresora|computaci[oó]n)' then 'Computación'
      when value ~ '(televisor|smart tv|\mtv\M|video)' then 'TV y video'
      when value ~ '(audio|parlante|aud[ií]fono|soundbar)' then 'Audio'
      when value ~ '(videojuego|consola|gaming|playstation|xbox|nintendo)' then 'Gaming'
      when value ~ '(smartwatch|reloj inteligente|wearable)' then 'Wearables'
      when value ~ '(c[aá]mara|fotograf[ií]a|lente)' then 'Fotografía'
      else 'Accesorios y otros tecnología' end
    when 'home' then case
      when value ~ '(detergente|lavaloza|limpiador|desinfectante|suavizante|cloro|limpieza)' then 'Limpieza del hogar'
      when value ~ '(sof[aá]|sill[oó]n|\mmesa\M|comedor|mueble|estante|\mrack\M)' then 'Muebles'
      when value ~ '(cuadro|espejo|alfombra|decoraci[oó]n|adorno|coj[ií]n|cortina)' then 'Decoración'
      when value ~ '(colch[oó]n|\mcama\M|dormitorio|s[aá]bana|plum[oó]n|almohada)' then 'Dormitorio'
      when value ~ '(menaje|\molla\M|sart[eé]n|vajilla|cubierto|cocina)' then 'Cocina y menaje'
      when value ~ '(ba[nñ]o|toalla|ducha)' then 'Baño'
      when value ~ '(jard[ií]n|terraza|parrilla)' then 'Jardín y terraza'
      when value ~ '(refrigerador|lavadora|secadora|microonda|aspiradora|electrohogar|electrodom[eé]stico)' then 'Electrohogar'
      when value ~ '(l[aá]mpara|iluminaci[oó]n|ampolleta)' then 'Iluminación'
      else 'Otros hogar' end
    when 'beauty' then case
      when value ~ '(shampoo|acondicionador|cabello|capilar)' then 'Cuidado capilar'
      when value ~ '(perfume|fragancia|colonia)' then 'Perfumería'
      when value ~ '(maquillaje|labial|m[aá]scara|base facial|delineador)' then 'Maquillaje'
      when value ~ '(facial|rostro|antiarrugas|\mserum\M|s[eé]rum)' then 'Cuidado facial'
      when value ~ '(desodorante|jab[oó]n|higiene|depilaci[oó]n)' then 'Higiene personal'
      else 'Cuidado corporal y otros belleza' end
    when 'health' then case
      when value ~ '(vitamina|suplemento|prote[ií]na|omega)' then 'Vitaminas y suplementos'
      when value ~ '(ortopedia|primeros auxilios|term[oó]metro)' then 'Cuidado de salud'
      else 'Farmacia y salud' end
    when 'toys' then case
      when value ~ '(libro|librer[ií]a|escolar|cuaderno|l[aá]piz)' then 'Libros y escolares'
      when value ~ '(juguet|mu[nñ]eca|peluche|did[aá]ctic|juego de mesa)' then 'Juguetes'
      else 'Bebé y otros infantil' end
    when 'sports' then case
      when value ~ '(bicicleta|ciclismo)' then 'Bicicletas y ciclismo'
      when value ~ '(f[uú]tbol|bal[oó]n|camiseta deportiva)' then 'Fútbol'
      when value ~ '(camping|outdoor|senderismo|trekking)' then 'Outdoor y camping'
      when value ~ '(fitness|gimnasio|mancuerna|entrenamiento)' then 'Fitness'
      else 'Otros deportes' end
    when 'automotive' then case
      when value ~ 'neum[aá]tico' then 'Neumáticos'
      when value ~ '(lubricante|aceite motor)' then 'Lubricantes'
      when value ~ 'repuesto' then 'Repuestos'
      else 'Accesorios automotrices' end
    when 'pets' then case
      when value ~ '(\mperro|canino)' then 'Perros'
      when value ~ '(\mgato|felino)' then 'Gatos'
      else 'Otras mascotas' end
    when 'food' then case
      when value ~ '(leche|yogurt|yoghurt|queso|l[aá]cteo)' then 'Lácteos'
      when value ~ '(carne|pollo|pavo|cerdo|vacuno|pescado|marisco)' then 'Carnes, pescados y proteínas'
      when value ~ '(fruta|verdura|hortaliza)' then 'Frutas y verduras'
      when value ~ '(\mpan\M|panader[ií]a|pasteler[ií]a|torta)' then 'Panadería y pastelería'
      when value ~ '(congelado|helado)' then 'Congelados'
      when value ~ '(snack|papas fritas|chocolate|galleta|picoteo)' then 'Snacks y confites'
      when value ~ '(arroz|pasta|fideo|harina|legumbre|cereal)' then 'Despensa y abarrotes'
      when value ~ '(aceite|\msal\M|condimento|salsa|aderezo)' then 'Aceites, salsas y condimentos'
      when value ~ '(caf[eé]|\mt[eé]\M|hierba|infusi[oó]n)' then 'Café, té e infusiones'
      when value ~ '(fiambre|embutido)' then 'Fiambres y embutidos'
      else 'Otros alimentos' end
    when 'grocery' then case
      when value ~ '(detergente|lavaloza|limpiador|desinfectante|suavizante|cloro|limpieza)' then 'Limpieza del hogar'
      when value ~ '(papel higi[eé]nico|servilleta|toalla de papel|bolsa.*basura)' then 'Papel y desechables'
      when value ~ '(leche|yogurt|yoghurt|queso|l[aá]cteo)' then 'Lácteos'
      when value ~ '(snack|chocolate|galleta|picoteo)' then 'Snacks y confites'
      when value ~ '(caf[eé]|\mt[eé]\M|hierba|infusi[oó]n)' then 'Café, té e infusiones'
      else 'Otros supermercado' end
    when 'other' then case
      when value ~ '(libro|librer[ií]a|escolar|cuaderno)' then 'Libros y escolares'
      when value ~ '(herramienta|destornillador|taladro|martillo)' then 'Herramientas'
      when value ~ '(maleta|equipaje|viaje)' then 'Maletería y viaje'
      else 'Otros productos' end
    else 'Otros productos'
  end from source;
$$;

create or replace function public.reclassify_product_industries_service(p_limit integer default 2000)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_count integer;
begin
  with batch as (
    select id from public.products
    where coalesce(industry_source,'rule')<>'manual'
      and industry_slug is distinct from public.classify_product_industry(name,category,retailer_type)
    order by id limit greatest(1,least(coalesce(p_limit,2000),5000)) for update skip locked
  )
  update public.products p
  set industry_slug=public.classify_product_industry(p.name,p.category,p.retailer_type),
      industry_confidence=case when public.classify_product_industry(p.name,p.category,p.retailer_type) in ('grocery','other') then 0.550 else 0.900 end,
      industry_source='rule'
  from batch where p.id=batch.id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.reclassify_smart_product_categories_service(p_limit integer default 2000)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_count integer;
begin
  with batch as (
    select id from public.products
    where smart_category is distinct from public.smart_product_category(name,category,industry_slug)
    order by id limit greatest(1,least(coalesce(p_limit,2000),5000)) for update skip locked
  )
  update public.products p
  set smart_category=public.smart_product_category(p.name,p.category,p.industry_slug)
  from batch where p.id=batch.id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

grant execute on function public.reclassify_product_industries_service(integer) to service_role;
grant execute on function public.reclassify_smart_product_categories_service(integer) to service_role;
