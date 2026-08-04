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
- Persistencia mediante RPC protegida, sin exponer credenciales administrativas.

## Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SCRAPE_INGEST_SECRET=
```

Las migraciones están disponibles en `supabase/migrations`.

Última verificación de despliegue Git: 4 de agosto de 2026.
