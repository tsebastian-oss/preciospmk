do $$
declare sid uuid;
begin
  select dispatch_secret_id into sid
  from private.notification_provider_config
  where singleton=true
  for update;

  if sid is null then
    sid:=vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'mgp_notification_dispatch_token',
      'Internal token for notification dispatcher'
    );
    update private.notification_provider_config
    set dispatch_secret_id=sid,updated_at=now()
    where singleton=true;
  end if;
end;
$$;
