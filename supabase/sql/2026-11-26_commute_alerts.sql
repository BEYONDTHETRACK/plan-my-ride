-- Alertes Commute (26/11/2026) : trajet fixé dans Moi (aller, retour), heures, réglages ; écrit par l'app (son propre compte),
-- lu par la fonction commute-alerts (clé de service) toutes les 15 minutes.
create table if not exists public.commute_alerts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  route_go text,                       -- parcours aller (routes.id)
  route_ret text,                      -- parcours retour, null = l'aller à l'envers
  go_time text not null default '07:45',
  go_mode text not null default 'dep', -- dep = heure de départ, arr = heure d'arrivée au travail
  margin int not null default 5,
  back_time text not null default '17:30',
  per_day boolean not null default false,
  days jsonb,                          -- { "1": { "go": "07:30", "back": "17:00" }, … } (1 = lundi)
  speed numeric, vam numeric,
  tz text, lang text, dist text, temp text, page text,
  started_at date not null default current_date, -- début du parcours « compte gratuit » (essai, puis invitations)
  last_eve date, last_aft date,
  updated_at timestamptz not null default now()
);
alter table public.commute_alerts enable row level security;
drop policy if exists commute_alerts_own on public.commute_alerts;
create policy commute_alerts_own on public.commute_alerts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- appel toutes les 15 minutes (1, 16, 31, 46)
select cron.unschedule('sillage-commute-alerts') where exists (select 1 from cron.job where jobname = 'sillage-commute-alerts');
select cron.schedule('sillage-commute-alerts', '1,16,31,46 * * * *', $$
  select net.http_post(
    url := 'https://bsypkdsnhiepvcnhmfsm.supabase.co/functions/v1/commute-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', (select cron_token from public.push_keys where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000);
$$);
