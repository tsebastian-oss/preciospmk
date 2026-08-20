revoke all on function public.brands_qsr_competitive_snapshot(text) from public;
revoke all on function public.brands_qsr_competitive_snapshot(text) from anon;
grant execute on function public.brands_qsr_competitive_snapshot(text) to authenticated, service_role;

drop function if exists public.dispatch_qsr_pricing_worker();
