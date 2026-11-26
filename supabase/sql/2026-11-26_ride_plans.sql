-- Sorties programmées (26/11/2026) : jour et heure gardés avec une trace Sortie (écrits par l'app, son propre compte) ;
-- la fonction ride-plans prévient la veille à 19 h (heure locale).
create table if not exists public.ride_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  route_id text not null,
  date date not null,
  time text not null,
  tz text, lang text, dist text, temp text, page text,
  speed numeric, vam numeric,
  notified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, route_id)
);
alter table public.ride_plans enable row level security;
drop policy if exists ride_plans_own on public.ride_plans;
create policy ride_plans_own on public.ride_plans for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
select cron.unschedule('sillage-ride-plans') where exists (select 1 from cron.job where jobname = 'sillage-ride-plans');
select cron.schedule('sillage-ride-plans', '1 * * * *', $$
  select net.http_post(
    url := 'https://bsypkdsnhiepvcnhmfsm.supabase.co/functions/v1/ride-plans',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', (select cron_token from public.push_keys where id = 1)),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000);
$$);
