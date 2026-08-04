revoke all on function public.split_failed_product_batch_task() from public, anon, authenticated;
grant execute on function public.split_failed_product_batch_task() to service_role;

drop policy if exists "No client access to catalog crawl tasks" on public.catalog_crawl_tasks;
create policy "No client access to catalog crawl tasks"
  on public.catalog_crawl_tasks
  for all
  to anon, authenticated
  using (false)
  with check (false);
