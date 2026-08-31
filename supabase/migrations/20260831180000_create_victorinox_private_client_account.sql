
do $$
declare
  v_user uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_email text := 'victorinox@mgp-retail.internal';
begin
  if exists (select 1 from auth.users where lower(email)=v_email) then
    raise exception 'victorinox user already exists';
  end if;
  if exists (select 1 from public.organizations where slug='victorinox') then
    raise exception 'victorinox organization already exists';
  end if;

  insert into auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,
    phone_change,phone_change_token,reauthentication_token,
    raw_app_meta_data,raw_user_meta_data,
    is_super_admin,is_sso_user,is_anonymous,created_at,updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000'::uuid,
    v_user,'authenticated','authenticated',v_email,
    extensions.crypt('victorinoxmgp2026', extensions.gen_salt('bf')),
    now(),
    '','','','','','','','',
    jsonb_build_object(
      'provider','email',
      'providers',jsonb_build_array('email'),
      'client_type','brand_client',
      'client_brand','victorinox'
    ),
    jsonb_build_object(
      'company','Victorinox',
      'job_title','Cliente',
      'display_name','Victorinox',
      'email_verified',true,
      'registration_source','brand_client_admin'
    ),
    false,false,false,now(),now()
  );

  insert into auth.identities (
    provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at
  ) values (
    v_user::text,v_user,
    jsonb_build_object('sub',v_user::text,'email',v_email,'email_verified',false,'phone_verified',false),
    'email',null,now(),now()
  );

  insert into public.organizations (
    id,name,slug,organization_type,status,plan,settings,created_by,created_at,updated_at
  ) values (
    v_org,'Victorinox','victorinox','brand','active','brand_intelligence',
    jsonb_build_object(
      'client_panel_brand','victorinox',
      'monitoring_market','Chile',
      'monitoring_frequency','daily'
    ),
    v_user,now(),now()
  );

  insert into public.organization_members (
    organization_id,user_id,role,status,created_by,joined_at,updated_at
  ) values (
    v_org,v_user,'owner','active',v_user,now(),now()
  );

  insert into public.user_profiles (
    user_id,display_name,job_title,locale,timezone,last_organization_id,last_seen_at,created_at,updated_at
  ) values (
    v_user,'Victorinox','Cliente','es-CL','America/Santiago',v_org,now(),now(),now()
  )
  on conflict (user_id) do update set
    display_name=excluded.display_name,
    job_title=excluded.job_title,
    locale=excluded.locale,
    timezone=excluded.timezone,
    last_organization_id=excluded.last_organization_id,
    updated_at=now();

  insert into public.organization_scopes (
    organization_id,retailers,brands,competitors,categories,modules,limits,updated_by,updated_at
  ) values (
    v_org,
    array['Victorinox Store Chile','Falabella','Ripley','Mercado Libre']::text[],
    array['Victorinox']::text[],
    array['Tissot','Seiko','Citizen','Samsonite','American Tourister','Saxoline','Leatherman','Arcos','Global','Zwilling','Tramontina','Wusthof']::text[],
    array['Relojes','Equipo de viaje','Navajas y multiherramientas','Cuchillos']::text[],
    array['brand-panel']::text[],
    '{"users":3,"brands":1,"exports_per_month":50}'::jsonb,
    v_user,now()
  );

  insert into public.organization_settings (
    organization_id,default_world,locale,timezone,refresh_frequency,ai_enabled,alerts_enabled,report_branding,data_retention_months,updated_by,updated_at
  ) values (
    v_org,'brand','es-CL','America/Santiago','daily',true,true,
    '{"client":"Victorinox","accent":"red"}'::jsonb,36,v_user,now()
  );
end $$;
