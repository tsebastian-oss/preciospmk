create or replace function public.split_failed_product_batch_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  product_url text;
begin
  if old.kind = 'product_batch'
     and old.status = 'running'
     and new.status in ('queued', 'failed')
     and new.error is not null then
    for product_url in
      select value
      from jsonb_array_elements_text(coalesce(old.payload->'urls', '[]'::jsonb))
    loop
      insert into public.catalog_crawl_tasks(
        run_id, task_key, supermarket, kind, payload, status, available_at
      ) values (
        old.run_id, 'product-page:' || product_url, old.supermarket, 'product_page',
        jsonb_build_object('url', product_url), 'queued', now()
      )
      on conflict (run_id, task_key) do nothing;
    end loop;

    new.status := 'completed';
    new.finished_at := now();
    new.claimed_at := null;
    new.products_found := 0;
    new.error := 'Batch split into individual product tasks after: ' || left(new.error, 3500);
  end if;

  return new;
end;
$$;

drop trigger if exists catalog_crawl_split_failed_batch on public.catalog_crawl_tasks;
create trigger catalog_crawl_split_failed_batch
before update on public.catalog_crawl_tasks
for each row
execute function public.split_failed_product_batch_task();

create or replace function public.claim_catalog_tasks_service(p_limit integer default 8)
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
  update public.catalog_crawl_tasks
  set status = 'queued', claimed_at = null, available_at = now(),
      error = coalesce(error, 'Recovered after a stale worker claim')
  where status = 'running'
    and claimed_at < now() - interval '12 minutes';

  return query
  with ranked as (
    select
      task.id,
      case
        when task.kind in ('sitemap', 'vtex_categories') then 0
        when task.kind = 'product_page' then 1
        else 2
      end as task_priority,
      row_number() over (
        partition by task.supermarket
        order by
          case
            when task.kind in ('sitemap', 'vtex_categories') then 0
            when task.kind = 'product_page' then 1
            else 2
          end,
          task.id
      ) as supermarket_rank
    from public.catalog_crawl_tasks task
    join public.catalog_crawl_runs run on run.id = task.run_id
    where run.status = 'running'
      and task.status = 'queued'
      and task.available_at <= now()
  ), selected as (
    select task.id
    from public.catalog_crawl_tasks task
    join ranked on ranked.id = task.id
    order by ranked.task_priority, ranked.supermarket_rank, task.supermarket, task.id
    for update of task skip locked
    limit greatest(1, least(coalesce(p_limit, 8), 24))
  ), claimed as (
    update public.catalog_crawl_tasks task
    set status = 'running', attempts = task.attempts + 1, claimed_at = now(), error = null
    from selected
    where task.id = selected.id
    returning task.id, task.run_id, task.supermarket, task.kind, task.payload, task.attempts
  )
  select claimed.id, claimed.run_id, claimed.supermarket, claimed.kind, claimed.payload, claimed.attempts
  from claimed;
end;
$$;

revoke all on function public.claim_catalog_tasks_service(integer) from public, anon, authenticated;
grant execute on function public.claim_catalog_tasks_service(integer) to service_role;
