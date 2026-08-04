create index if not exists price_observations_crawl_run_id_idx
  on public.price_observations(crawl_run_id)
  where crawl_run_id is not null;
