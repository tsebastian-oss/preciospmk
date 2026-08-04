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
- Ingesta interna mediante una Edge Function con rol de servicio no expuesto.
- Reserva atómica de cada corrida y límite de una ejecución cada 15 minutos.
- Verificación automática del deployment desde GitHub Actions.

## Arquitectura de seguridad

El repositorio no contiene claves administrativas. La ruta `/api/scrape` solo dispara una operación fija, sin aceptar URLs, SQL ni parámetros del usuario. La Edge Function reserva atómicamente la corrida en PostgreSQL, rechaza ejecuciones simultáneas o repetidas durante 15 minutos y usa el rol de servicio únicamente dentro de Supabase.

Las variables de `.env.example` son opcionales y solo permiten reemplazar la configuración pública durante desarrollo local.

Las migraciones están disponibles en `supabase/migrations` y el código de la Edge Function en `supabase/functions/scrape-supermarkets`.

Producción: https://preciospmk.vercel.app

Última verificación end-to-end: 4 de agosto de 2026. Página pública, API de productos y API de scraping respondieron correctamente.

Última solicitud manual de corrida integral: 4 de agosto de 2026, 14:08 CLT.

Sonda técnica de cobertura Unimarc activada el 4 de agosto de 2026.
