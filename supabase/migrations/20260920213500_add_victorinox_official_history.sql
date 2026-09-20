-- Real Victorinox daily history sourced from the captured official catalog.
create or replace function public.brands_vertical_official_history(p_slug text default 'victorinox',p_days integer default 90)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
with b as (
 select id from public.brands_vertical_brands where slug=p_slug and status='active' limit 1
),raw as (
 select l.title,l.category,l.current_price,l.observed_at,(l.observed_at at time zone 'America/Santiago')::date price_date,
 lower(regexp_replace(translate(coalesce(l.title,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'),'\s+',' ','g')) nt
 from public.brands_vertical_listings l join b on b.id=l.brand_id join public.brands_vertical_sources s on s.id=l.source_id
 where s.domain='victorinoxstore.cl' and l.current_price>0 and coalesce(l.in_stock,true)
 and (l.observed_at at time zone 'America/Santiago')::date>=current_date-greatest(1,least(coalesce(p_days,90),180))+1
),classified as (
 select *,case
 when category='Relojes' and nt like 'reloj %' then 'Relojes'
 when category in('Equipo de viaje','Mochilas y bolsos') and nt~'(maleta|equipaje|trolley|carry-on|carry on|spinner|luggage|suitcase)' and nt!~'(repuesto|rueda|candado|cobertor|funda|etiqueta|identificador|adaptador)' then 'Equipo de viaje'
 when category in('Navajas y multiherramientas','Swiss Army Knife & Tools') and nt~'(navaj|cortapluma|swisstool|swiss tool|spartan|climber|huntsman|cadet|classic sd|explorer|rambler|fieldmaster|swiss champ|ranger.?grip|cybertool|work champ|outrider|super tinker|hiker|camper|sportsman|recruit|sentinel|evoke|hunter pro|wine master|mountaineer|handyman|minichamp|swiss lite)' and nt!~'(multiherramientas para navajas|navaja.*juguete|^(funda|estuche|repuesto|aceite|cordon|lanyard|cadena|multiclip|alfiler|palillo|pinza) )' then 'Navajas y multiherramientas'
 when category='Cuchillos' and nt~'(cuchillo|cuchiller| knife|santoku|mondador|paring|chef|trinchar|filetear|fibrox|bistec|pan y pasteleria|tomate y de mesa)' and nt!~'(pelador|rallador|tabla de corte|tijera|cuchara|tenedor|afilador|soporte|olla|sarten|cubierto|vajilla)' then 'Cuchillos' end clean_category
 from raw
),dedup as (
 select distinct on(clean_category,price_date,nt)* from classified where clean_category is not null
 order by clean_category,price_date,nt,observed_at desc
),daily as (
 select clean_category category,price_date,round(percentile_cont(.5) within group(order by current_price))::bigint median_price,count(*)::integer products
 from dedup group by clean_category,price_date
)
select coalesce(jsonb_agg(jsonb_build_object('category',category,'date',price_date,'median_price',median_price,'products',products) order by category,price_date),'[]'::jsonb) from daily;
$function$;
revoke execute on function public.brands_vertical_official_history(text,integer) from public,anon;
grant execute on function public.brands_vertical_official_history(text,integer) to authenticated,service_role;
