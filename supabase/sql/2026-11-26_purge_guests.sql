-- 26/11/2026 (demande d'Antoine) : comptes invités (mode démo) effacés chaque nuit à minuit, heure de Paris.
-- pg_cron est en UTC : la tâche tourne à 22 h et 23 h UTC, la fonction n'agit que s'il est minuit à Paris (heure d'été / d'hiver).
create or replace function public.purge_guests()
returns int language plpgsql security definer set search_path to 'public' as $$
declare g int;
begin
  if extract(hour from now() at time zone 'Europe/Paris') <> 0 then return 0; end if;
  delete from auth.users au using public.app_users ap
    where ap.user_id = au.id and ap.status = 'guest'
      and greatest(au.created_at, coalesce(au.last_sign_in_at, au.created_at), coalesce(ap.last_seen_at, au.created_at)) < now() - interval '15 minutes';
  get diagnostics g = row_count;
  return g;
end $$;
revoke all on function public.purge_guests() from public, anon, authenticated;
select cron.schedule('sillage-purge-guests', '0 22,23 * * *', 'select public.purge_guests()');
