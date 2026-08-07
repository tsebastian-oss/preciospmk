revoke all on function public.enterprise_cascading_filter_options(uuid, text, text, text, text) from public;
revoke all on function public.enterprise_cascading_filter_options(uuid, text, text, text, text) from anon;
grant execute on function public.enterprise_cascading_filter_options(uuid, text, text, text, text) to authenticated;
