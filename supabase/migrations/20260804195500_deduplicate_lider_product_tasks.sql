create or replace function public.claim_lider_catalog_tasks_service(p_limit integer default 2)
returns table (
  id bigint,
  run_id bigint,
  supermarket text,
  kind text,
  payload jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(824631973);

  update public.catalog_crawl_tasks as duplicate_task
  set status = 'completed',
      finished_at = now(),
      claimed_at = null,
      products_found = 0,
      error = 'Skipped because this product was already observed in the crawl run'
  where duplicate_task.status = 'queued'
    and duplicate_task.supermarket = 'Lider'
    and duplicate_task.kind = 'lider_product_page'
    and exists (
      select 1
      from public.products product
      join public.price_observations observation
        on observation.product_id = product.id
      where observation.crawl_run_id = duplicate_task.run_id
        and product.supermarket = 'Lider'
        and product.url = duplicate_task.payload->>'url'
    );

  update public.catalog_crawl_tasks as stale_task
  set status = 'queued',
      claimed_at = null,
      available_at = now(),
      error = coalesce(stale_task.error, 'Recovered after a stale Lider product worker claim')
  where stale_task.status = 'running'
    and stale_task.supermarket = 'Lider'
    and stale_task.kind in (
      'lider_siteindex',
      'lider_product_sitemap',
      'lider_product_batch',
      'lider_product_page'
    )
    and stale_task.claimed_at < now() - interval '12 minutes';

  return query
  with selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.status = 'running'
      and task.supermarket = 'Lider'
      and task.kind in (
        'lider_siteindex',
        'lider_product_sitemap',
        'lider_product_batch',
        'lider_product_page'
      )
      and task.status = 'queued'
      and task.available_at <= now()
    order by
      case task.kind
        when 'lider_siteindex' then 0
        when 'lider_product_sitemap' then 1
        when 'lider_product_batch' then 2
        when 'lider_product_page' then 3
        else 9
      end,
      task.id
    limit greatest(1, least(coalesce(p_limit, 2), 8))
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running',
        attempts = task.attempts + 1,
        claimed_at = now(),
        error = null
    from selected
    where task.id = selected.id
      and task.status = 'queued'
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed
  order by claimed.id;
end;
$$;

revoke all on function public.claim_lider_catalog_tasks_service(integer) from public, anon, authenticated;
grant execute on function public.claim_lider_catalog_tasks_service(integer) to service_role;
