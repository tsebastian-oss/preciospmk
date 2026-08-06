do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'refresh-product-match-summary-v2'
  ) then
    perform cron.schedule(
      'refresh-product-match-summary-v2',
      '*/30 * * * *',
      'refresh materialized view concurrently public.product_match_summary'
    );
  end if;
end
$$;
