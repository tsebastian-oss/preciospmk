
insert into public.automotive_financing_sources
(source_key,provider,source_type,product_name,source_url,parser_key,priority,metadata)
values
('bch-card-auto','Banco de Chile','credit_card','Tarjeta de crédito · Automotriz 0,99%','https://sitiospublicos.bancochile.cl/personas/beneficios/promociones/automotriz-2026','bch_card_auto',148,'{"category":"automotriz","termRange":"13-36"}')
on conflict (source_key) do update set
 provider=excluded.provider,source_type=excluded.source_type,product_name=excluded.product_name,
 source_url=excluded.source_url,parser_key=excluded.parser_key,priority=excluded.priority,
 metadata=excluded.metadata,active=true,updated_at=now();
