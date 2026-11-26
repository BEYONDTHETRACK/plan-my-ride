-- 26/11/2026 : notification 45 min avant le départ de l'aller (Sillage.cc +)
alter table public.commute_alerts add column if not exists last_morn date;
