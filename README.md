# MGP Super Precios Chile

Aplicación para monitorear, comparar y almacenar precios históricos de supermercados en Chile.

## Stack

- Next.js 15 en Vercel
- Supabase/PostgreSQL
- Supabase Edge Functions
- Vercel Cron
- Scrapers extensibles por supermercado

## Funcionalidades del MVP

- Dashboard de productos, supermercados y ofertas.
- Buscador conectado a la vista `latest_prices`.
- Histórico de observaciones de precio.
- Ejecución manual y programada del scraping.
- Conectores iniciales para Lider, Jumbo, Santa Isabel y Unimarc.
- Lectura pública mediante RLS y clave publicable de Supabase.
- Escritura protegida mediante Vercel OIDC y una Edge Function de Supabase.
- Límite de una ejecución cada 15 minutos.

## Arquitectura de seguridad

El repositorio no contiene claves administrativas. La ruta `/api/scrape` obtiene automáticamente la identidad OIDC del deployment de Vercel y la envía a la función `scrape-supermarkets`. La función valida emisor, audiencia, proyecto y ambiente antes de usar internamente el rol de servicio de Supabase.

Las variables de `.env.example` son opcionales y solo permiten reemplazar la configuración pública durante desarrollo local.

Las migraciones están disponibles en `supabase/migrations` y el código de la Edge Function en `supabase/functions/scrape-supermarkets`.

Última verificación de despliegue Git: 4 de agosto de 2026.
