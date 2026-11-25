-- 25/11/2026 : plateforme de chaque évènement du journal (app iPhone, app Android ou web), pour la supervision.
-- Déduite à l'insertion des en-têtes de la requête (PostgREST) : origine capacitor:// = app iPhone ; WebView Android
-- (« ; wv) » dans le User-Agent) = app Android ; sinon web. Aucune version de l'app à refaire.
alter table public.activity_log add column if not exists platform text;

create or replace function public.activity_set_platform()
returns trigger language plpgsql security definer set search_path = public as $$
declare h json; ua text; og text;
begin
  if new.platform is null then
    begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
    ua := coalesce(h ->> 'user-agent', ''); og := coalesce(h ->> 'origin', '');
    if h is null then new.platform := null;
    elsif og like 'capacitor://%' then new.platform := 'ios';
    elsif ua ~* '; wv\)' and ua ~* 'android' then new.platform := 'android';
    else new.platform := 'web';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists activity_log_platform on public.activity_log;
create trigger activity_log_platform before insert on public.activity_log
  for each row execute function public.activity_set_platform();
