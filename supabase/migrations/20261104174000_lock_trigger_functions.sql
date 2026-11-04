-- Advisors 0028/0029: trigger functions run as their owner from triggers; nobody
-- should be able to reach them through /rest/v1/rpc. Revoking EXECUTE does not
-- affect the triggers themselves.
revoke execute on function public.alert_new_complaints()    from public, anon, authenticated;
revoke execute on function public.alert_closed_complaints() from public, anon, authenticated;
revoke execute on function public.alert_new_report()        from public, anon, authenticated;
revoke execute on function public.touch_updated_at()        from public, anon, authenticated;
-- Created by the Supabase platform on new projects (event-trigger helper).
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
