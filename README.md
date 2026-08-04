# MGP Super Precios Chile

Aplicación para monitorear, comparar y almacenar precios históricos de supermercados en Chile.

## Stack

- Next.js 15
- Supabase/PostgreSQL
- Vercel Functions y Cron
- Scrapers extensibles por supermercado

## Funcionalidades del MVP

- Dashboard de productos, supermercados y ofertas.
- Buscador conectado a la vista `latest_prices`.
- Histórico de observaciones de precio.
- Ejecución manual y programada del scraping.
- Conectores iniciales para Lider, Jumbo, Santa Isabel y Unimarc.

## Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

La migración inicial está en `supabase/migrations/20260804134500_initial_schema.sql`.
