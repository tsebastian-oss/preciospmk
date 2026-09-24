-- Forum financing coverage
-- Direct forum.cl endpoints return 403 to server-to-server crawlers, so the worker keeps
-- forum-main as a connectivity probe/fallback and captures detailed Forum conditions
-- from partner brand legal pages that publish the same credit terms.

insert into public.automotive_financing_sources
(source_key,provider,source_type,product_name,source_url,parser_key,priority,metadata)
values
('forum-kia-partner','Forum','auto_finance','Forum vía Kia Chile','https://www.kia.cl/terminos-y-condiciones.html','forum_promo',260,'{"brand":"Kia","coverage":"partner_legal","directForumBlocked":true}'),
('forum-dongfeng-partner','Forum','auto_finance','Forum vía Dongfeng Indumotora','https://dongfengindumotora.cl/terminos-y-condiciones.html','forum_promo',258,'{"brand":"Dongfeng","coverage":"partner_legal","directForumBlocked":true}'),
('forum-baic-partner','Forum','auto_finance','Forum vía BAIC Chile','https://www.baic.cl/legales-modelos/','forum_promo',252,'{"brand":"BAIC","coverage":"partner_legal","directForumBlocked":true}'),
('forum-ford-partner','Forum','auto_finance','Forum vía Ford Chile','https://www.ford.cl/condicioneslegales/','forum_ford',265,'{"brand":"Ford","coverage":"partner_legal","directForumBlocked":true}'),
('forum-geely-coolray-partner','Forum','auto_finance','Forum vía Geely · New Coolray','https://www.geely.cl/modelos/new-coolray/','forum_promo',246,'{"brand":"Geely","coverage":"partner_model","directForumBlocked":true}'),
('forum-geely-ex2-partner','Forum','auto_finance','Forum vía Geely · EX2','https://www.geely.cl/modelos/geely-ex2/','forum_promo',244,'{"brand":"Geely","coverage":"partner_model","directForumBlocked":true}'),
('forum-geely-ex5-partner','Forum','auto_finance','Forum vía Geely · EX5','https://www.geely.cl/modelos/ex5/','forum_promo',242,'{"brand":"Geely","coverage":"partner_model","directForumBlocked":true}'),
('forum-geely-ex5-emi-partner','Forum','auto_finance','Forum vía Geely · EX5 EM-i','https://www.geely.cl/modelos/geely-ex5-em-i/','forum_promo',240,'{"brand":"Geely","coverage":"partner_model","directForumBlocked":true}')
on conflict (source_key) do update set
  provider=excluded.provider,
  source_type=excluded.source_type,
  product_name=excluded.product_name,
  source_url=excluded.source_url,
  parser_key=excluded.parser_key,
  priority=excluded.priority,
  metadata=excluded.metadata,
  active=true,
  updated_at=now();

update public.automotive_financing_sources
set active=false, updated_at=now()
where source_key in (
'forum-byd-promos','forum-kia-promos','forum-geely-promos','forum-ford-promos','forum-baic-promos',
'forum-omoda-jaecoo-promos','forum-cidef-promos','forum-peugeot-promos','forum-dongfeng-ev-promos'
);
