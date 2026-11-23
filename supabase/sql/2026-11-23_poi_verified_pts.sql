-- 23/11/2026 : poi_verified renvoie aussi type, nom, position et étiquettes du point OSM,
-- pour afficher les points vérifiés à tous les zooms (sans attendre le chargement des carrés OSM).
drop function if exists public.poi_verified(double precision, double precision, double precision, double precision);
create or replace function public.poi_verified(s double precision, w double precision, n double precision, e double precision)
returns table (poi_key text, ok int, ko int, last_at timestamptz, type text, name text, lat double precision, lon double precision, t jsonb)
language sql stable security definer set search_path = public as $$
  with ev as (
    select r.poi_key, true as ok, r.created_at as at from public.poi_review r
      where r.status = 'valid' and r.poi_key !~ '^p:' and r.created_at > now() - interval '12 months'
    union all
    select c.poi_key, c.ok, c.at from public.poi_check c
      where c.poi_key !~ '^p:' and c.at > now() - interval '12 months'
  ), agg as (
    select ev.poi_key, count(*) filter (where ev.ok)::int ok, count(*) filter (where not ev.ok)::int ko, max(ev.at) filter (where ev.ok) last_at
    from ev group by ev.poi_key
  )
  select a.poi_key, a.ok, a.ko, a.last_at, o.type, o.name, o.lat, o.lon, o.t
  from agg a join public.osm_poi o on o.id = a.poi_key
  where auth.uid() is not null and a.ok > a.ko
    and o.lat between s and n and o.lon between w and e;
$$;
revoke all on function public.poi_verified(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.poi_verified(double precision, double precision, double precision, double precision) to authenticated;
