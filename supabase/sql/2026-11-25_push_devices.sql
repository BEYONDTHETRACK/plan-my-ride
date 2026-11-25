-- 25/11/2026 : jetons Firebase (FCM) des apps iPhone / Android, pour les alertes météo en notification native.
-- Un jeton par appareil et par compte ; écrit et lu seulement par la fonction push-alerts (clé de service).
create table if not exists public.push_devices (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null unique,
  platform    text not null check (platform in ('ios', 'android')),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fails       int not null default 0
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security; -- aucune politique : accès par la fonction edge seulement
