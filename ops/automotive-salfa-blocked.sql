-- Salfa's public catalog returned HTTP 403 to the identified crawler during production validation.
-- Keep the source registered for market coverage, but do not retry automatically or bypass the restriction.

update public.automotive_sources
set enabled=false,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'adapter_status','blocked_http_403',
      'source_policy','dealer_primary',
      'next_action','alternative_public_integration'
    ),
    updated_at=now()
where source_key='salfa_automotriz';
