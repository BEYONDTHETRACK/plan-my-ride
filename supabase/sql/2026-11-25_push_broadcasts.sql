-- Notifications envoyées à la main depuis la supervision (25/11/2026) : historique des envois.
-- Écrit par la fonction push-alerts (clé de service) ; lisible par les administrateurs seulement.
create table if not exists public.push_broadcasts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  sent_by uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  url text,
  target text not null,          -- 'all' ou l'e-mail du compte visé
  platforms text[] not null,     -- parmi ios, android, web
  devices int not null default 0,
  sent int not null default 0
);
alter table public.push_broadcasts enable row level security;
drop policy if exists push_broadcasts_admin_read on public.push_broadcasts;
create policy push_broadcasts_admin_read on public.push_broadcasts for select to authenticated using (public.is_admin());
