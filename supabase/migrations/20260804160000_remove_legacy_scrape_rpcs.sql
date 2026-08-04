drop function if exists public.scrape_status(text);
drop function if exists public.ingest_scrape(text, timestamptz, jsonb, jsonb);
drop function if exists public.scrape_service_status();
drop function if exists public.ingest_scrape_service(timestamptz, jsonb, jsonb);
