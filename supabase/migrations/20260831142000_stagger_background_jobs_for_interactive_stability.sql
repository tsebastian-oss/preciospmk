-- Reduce background contention while keeping every scraper and cache pipeline active.
-- Jobs remain online, but heavy work is staggered so interactive traffic (Auth/dashboard) wins.

do $$
declare
  r record;
  v_job_id bigint;
begin
  for r in
    select *
    from (values
      ('classify-new-products-every-10-minutes',          '12 * * * *',      true),
      ('refresh-product-match-features-ai',               '15 */2 * * *',    true),
      ('refresh-product-match-fuzzy-ai',                  '25 */2 * * *',    true),
      ('refresh-product-match-summary-ai',                '35 */2 * * *',    true),
      ('refresh-enterprise-dashboard-cache',              '7 * * * *',       true),
      ('refresh-enterprise-ui-metadata-cache',            '17 * * * *',      true),
      ('refresh-enterprise-daily-pricing-trend-cache',    '27 * * * *',      true),
      ('refresh-product-filter-facets',                   '37 * * * *',      true),
      ('readiness-retailer-health-refresh',               '9,39 * * * *',    true),
      ('readiness-crawl-run-reconciler',                  '*/10 * * * *',    true),
      ('refresh-marketing-retailer-coverage',             '14,44 * * * *',   true),
      ('enterprise-alert-evaluator',                      '19,49 * * * *',   true),
      ('auto-recover-degraded-retailers',                 '47 * * * *',      true),
      ('catalog-assortment-finalizer',                    '4,24,44 * * * *', true),
      ('scraping-pro-dispatcher-every-minute',            '*/2 * * * *',     true),
      ('refresh-ai-learning-hourly',                      '52 */2 * * *',    true),
      ('automotive-crawl-monday-friday',                  '*/20 * * * 1,5',  true),
      ('daily-non-supermarket-crawls',                    '*/20 * * * *',    true),
      ('daily-catalog-crawl-starter',                     '*/10 * * * *',    true)
    ) as cfg(jobname, schedule, active)
  loop
    select jobid into v_job_id
    from cron.job
    where jobname = r.jobname;

    if v_job_id is not null then
      perform cron.alter_job(
        job_id := v_job_id,
        schedule := r.schedule,
        active := r.active
      );
    end if;
  end loop;
end $$;
