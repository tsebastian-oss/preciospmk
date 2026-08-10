alter role authenticator set statement_timeout='30s';
alter role authenticated set statement_timeout='30s';
alter role anon set statement_timeout='15s';

alter function public.enterprise_ai_price_map_context(uuid,text,text,text,text,text,text,text) set statement_timeout='30s';
alter function public.enterprise_brand_intelligence_context(uuid,text,text,text,text,text,text,integer) set statement_timeout='30s';
alter function public.enterprise_brand_intelligence_context_v2(uuid,text,text,text,text,text,text,integer) set statement_timeout='30s';
alter function public.enterprise_cascading_filter_options(uuid,text,text,text,text) set statement_timeout='30s';
alter function public.enterprise_contextual_pricing_trend(uuid,integer,text,text,text,text,text) set statement_timeout='30s';
alter function public.enterprise_daily_pricing_trend_cached(uuid,integer,text[]) set statement_timeout='30s';
alter function public.enterprise_daily_pricing_trend_v2(uuid,integer,text[]) set statement_timeout='30s';
alter function public.enterprise_daily_pricing_trend_v2_raw(uuid,integer,text[]) set statement_timeout='30s';
alter function public.enterprise_export_filter_options(uuid,text,text,text,integer) set statement_timeout='30s';
alter function public.enterprise_price_matches(uuid,integer,integer,text,text,text,numeric,text,text,text) set statement_timeout='30s';
alter function public.enterprise_price_matching_summary(uuid) set statement_timeout='30s';
alter function public.enterprise_products_page(uuid,integer,integer,text,text,text,text,text,text,boolean,text) set statement_timeout='30s';
