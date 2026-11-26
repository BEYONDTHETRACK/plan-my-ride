-- 27/11/2026 (demande d'Antoine) : menu Notifications — ce que chaque compte veut recevoir.
-- Pas de ligne = tout activé. Lu par commute-alerts (taf_eve / taf_morn / taf_aft), ride-plans (ride),
-- push-alerts admin_send « tout le monde » (news). L'alerte d'un parcours reste push_alerts.enabled.
create table if not exists public.notif_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ride boolean not null default true,
  taf_eve boolean not null default true,
  taf_morn boolean not null default true,
  taf_aft boolean not null default true,
  news boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notif_prefs enable row level security;
create policy "notif_prefs ses lignes" on public.notif_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
