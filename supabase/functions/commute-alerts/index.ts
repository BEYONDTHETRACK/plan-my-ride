import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush, type VapidKeys, type Sub } from './webpush.ts';
import { sendFcm } from './fcm.ts';
import { localParts, zoned, addDays, isoWd, route, weather, ride, verdict, tr, LANGS, unitsOf, cv } from './forecast.ts';

// Alertes Commute (26/11/2026). POST { action: 'cron' } avec l'en-tête x-cron-token (push_keys), toutes les 15 min (pg_cron).
// Pour chaque compte de commute_alerts (trajet fixé dans Moi, alertes cochées) :
// - « eve » : la veille d'un jour ouvré (lun.–ven.), à partir de 20 h 30 heure locale → météo du trajet aller ;
// - « morn » : Sillage.cc + seulement, un jour ouvré, 45 min avant le départ de l'aller → météo de l'aller remise à jour
//   (26/11/2026, demande d'Antoine ; remplace la notification de la veille) ;
// - « aft » : un jour ouvré, à partir de 2 h avant le départ du retour → météo du retour.
// Sillage.cc + (plan full, plus_until futur, admin) : la météo à chaque fois.
// Compte gratuit : jours ouvrés comptés depuis started_at : 1–5 météo (essai) ; 6–10 invitation soir/après-midi en alternance
// (6 soir, 7 après-midi, 8 soir, 9 après-midi) ; 11–15 deux invitations (11 soir, 13 après-midi) ; ensuite une par semaine,
// soir et après-midi en alternance. POST { action: 'preview', user_id, slot, date? } (même jeton) : rend le message sans l'envoyer.

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const SITE = 'https://app.sillage-ride.eu/';
type Admin = ReturnType<typeof createClient>;
type Row = { user_id: string; enabled: boolean; route_go: string; route_ret: string | null; go_time: string; go_mode: string; margin: number;
  back_time: string; per_day: boolean; days: Record<string, { go?: string; back?: string }> | null; speed: number | null; vam: number | null;
  tz: string | null; lang: string | null; dist: string | null; temp: string | null; page: string | null; started_at: string; last_eve: string | null; last_morn: string | null; last_aft: string | null };
type Slot = 'eve' | 'morn' | 'aft';

const EN: Record<string, string> = {
  'Demain {0} - {1}': 'Tomorrow {0} - {1}', 'Départ {0} - {1}': 'Leaving {0} - {1}', 'Retour {0} - {1}': 'Ride home {0} - {1}',
  'Ton trajet de demain': "Tomorrow's commute", 'Ton trajet retour': 'Your ride home',
  'Avec Sillage.cc +, tu recevrais ici la météo de ton trajet aller, la veille au soir, et celle du retour deux heures avant de rentrer.':
    'With Sillage.cc +, you would get the weather for your ride to work here the evening before, and for your ride home two hours before you leave.',
  'Essai Sillage.cc + : jour {0}/5': 'Sillage.cc + trial: day {0}/5', 'arrivée vers {0}': 'arrive around {0}',
};
const t = (lang: string, k: string, a: (string | number)[] = []) => (lang === 'en' && EN[k] ? EN[k] : k).replace(/\{(\d+)\}/g, (_m, i) => String(a[+i]));

const hm = (s: string | undefined, d: string) => (/^\d{2}:\d{2}$/.test(String(s)) ? String(s) : d);
const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const pad = (n: number) => String(n).padStart(2, '0');
const toHm = (m: number) => pad(Math.floor(((m % 1440) + 1440) % 1440 / 60)) + ':' + pad(((m % 60) + 60) % 60);
function times(r: Row, day: string) {
  const d = (r.per_day && r.days && r.days[String(isoWd(day))]) || {};
  return { go: hm(d.go, hm(r.go_time, '07:45')), back: hm(d.back, hm(r.back_time, '17:30')) };
}
// rang du jour ouvré `day` depuis started_at (1 = premier jour ouvré)
function workIdx(start: string, day: string) {
  let n = 0; for (let d = start; d <= day && n < 4000; d = addDays(d, 1)) if (isoWd(d) <= 5) n++;
  return Math.max(1, n);
}
function freePhase(n: number, slot: Slot): 'wx' | 'inv' | null {
  if (n <= 5) return 'wx';
  if (n <= 10) return ({ 6: 'eve', 7: 'aft', 8: 'eve', 9: 'aft' } as Record<number, string>)[n] === slot ? 'inv' : null;
  if (n <= 15) return ({ 11: 'eve', 13: 'aft' } as Record<number, string>)[n] === slot ? 'inv' : null;
  if ((n - 16) % 5) return null;
  return (Math.floor((n - 16) / 5) % 2 === 0 ? 'eve' : 'aft') === slot ? 'inv' : null;
}

async function trace(db: Admin, uid: string, id: string) {
  const { data } = await db.from('routes').select('name,pts').eq('user_id', uid).eq('id', id).is('deleted_at', null).maybeSingle();
  return data && Array.isArray(data.pts) && data.pts.length > 1 ? { name: String(data.name || ''), pts: data.pts as number[][] } : null;
}

// message météo d'un trajet (aller : départ à go, ou arrivée à go si go_mode = arr ; retour : départ à back)
async function wxMsg(db: Admin, r: Row, slot: Slot, day: string, today: string) {
  const lang = LANGS.includes(String(r.lang)) ? String(r.lang) : 'fr', u = unitsOf(r), tz = r.tz || 'Europe/Paris';
  const go = await trace(db, r.user_id, r.route_go); if (!go) return null;
  let p = go.pts, name = go.name;
  if (slot === 'aft') { const back = r.route_ret ? await trace(db, r.user_id, r.route_ret) : null; p = back ? back.pts : go.pts.slice().reverse(); if (back) name = back.name; }
  const R = route(p), speed = Math.min(45, Math.max(10, Number(r.speed) || 20)), vam = Math.min(1500, Math.max(250, Number(r.vam) || 700));
  const ahead = Math.round((Date.parse(day) - Date.parse(today)) / 864e5);
  const wx = await weather(R.smp, addDays(day, -1), addDays(day, 1), ahead <= 2);
  const tm = times(r, day);
  let dep = slot === 'aft' ? tm.back : tm.go;
  if (slot !== 'aft' && r.go_mode === 'arr') { // heure d'arrivée au travail : départ = arrivée − trajet − marge
    let s = ride(R, wx, zoned(day, toHm(mins(tm.go) - 30), tz), speed, vam);
    dep = toHm(mins(tm.go) - Math.round(s.rideH * 60) - (Number(r.margin) || 0));
    s = ride(R, wx, zoned(day, dep, tz), speed, vam); dep = toHm(mins(tm.go) - Math.round(s.rideH * 60) - (Number(r.margin) || 0));
  }
  const s = ride(R, wx, zoned(day, dep, tz), speed, vam), v = verdict(s, lang, u);
  const T = (k: string, a?: (string | number)[]) => tr(lang, k, a, u);
  const ressenti = Math.round(s.amin) === Math.round(s.amax) ? T('ressenti {0} °C', [cv.t(u, s.amin)]) : T('ressenti {0} à {1} °C', [cv.t(u, s.amin), cv.t(u, s.amax)]);
  // pas d'heure d'arrivée (26/11/2026, demande d'Antoine)
  const body = s.miss ? T('Prévision incomplète pour ce parcours.') : `${['🟢', '🟠', '🔴'][v.lvl]} ${v.txt} · ${ressenti}`;
  // titre (26/11/2026, demande d'Antoine) : « Demain 07h45 - nom de la trace » / « Retour 17h30 - nom de la trace »
  const at = lang === 'en' ? dep : dep.replace(':', 'h');
  return { lang, title: t(lang, slot === 'eve' ? 'Demain {0} - {1}' : slot === 'morn' ? 'Départ {0} - {1}' : 'Retour {0} - {1}', [at, name || 'Commute']), body };
}

async function deliver(db: Admin, keys: VapidKeys | null, uid: string, msg: Record<string, unknown>) {
  let sent = 0, devices = 0;
  if (keys) {
    const { data: subs } = await db.from('push_subs').select('id,endpoint,p256dh,auth').eq('user_id', uid);
    for (const s of subs ?? []) { devices++; let st = 0; try { st = await sendPush(s as Sub, msg, keys, SITE); } catch (_) { st = 0; }
      if (st >= 200 && st < 300) sent++; else if (st === 404 || st === 410) await db.from('push_subs').delete().eq('id', s.id); }
  }
  const { data: devs } = await db.from('push_devices').select('id,token').eq('user_id', uid);
  for (const d of devs ?? []) { devices++; let st = 0; try { st = await sendFcm(d.token as string, msg); } catch (_) { st = 0; }
    if (st >= 200 && st < 300) sent++; else if (st === 404 || st === 400) await db.from('push_devices').delete().eq('id', d.id); }
  return { devices, sent };
}

// message d'un compte pour un créneau, ou null s'il n'y a rien à envoyer
async function build(db: Admin, r: Row, plus: boolean, slot: Slot, today: string) {
  if (slot === 'morn' && !plus) return null;
  const day = slot === 'eve' ? addDays(today, 1) : today;
  if (isoWd(day) > 5) return null;
  const page = r.page && r.page.startsWith(SITE) ? r.page : SITE;
  let phase: 'wx' | 'inv' | null = 'wx', n = 0;
  if (!plus) { n = workIdx(r.started_at, day); phase = freePhase(n, slot); }
  if (!phase) return null;
  const lang = LANGS.includes(String(r.lang)) ? String(r.lang) : 'fr';
  if (phase === 'inv') return { title: t(lang, slot === 'eve' ? 'Ton trajet de demain' : 'Ton trajet retour'),
    body: t(lang, 'Avec Sillage.cc +, tu recevrais ici la météo de ton trajet aller, la veille au soir, et celle du retour deux heures avant de rentrer.'),
    url: page + '?open=plus', tag: 'sillage-commute-' + slot };
  const m = await wxMsg(db, r, slot, day, today); if (!m) return null;
  return { title: m.title, body: m.body + (plus ? '' : '\n' + t(lang, 'Essai Sillage.cc + : jour {0}/5', [n])), url: page + '?open=taf', tag: 'sillage-commute-' + (slot === 'aft' ? 'aft' : 'eve') };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const tok = req.headers.get('x-cron-token') ?? '';
  const { data: k } = await db.from('push_keys').select('cron_token,pub,priv').eq('id', 1).maybeSingle();
  if (!tok || !k?.cron_token || tok !== k.cron_token) return json({ error: 'auth' }, 401);
  let b: Record<string, unknown> = {}; try { b = await req.json(); } catch (_) { /* vide */ }
  const keys = k.pub && k.priv ? { pub: k.pub, priv: k.priv } as VapidKeys : null;
  const plusOf = (u: { plan?: string; plus_until?: string | null; is_admin?: boolean } | null) => !!u && (u.plan === 'full' || !!u.is_admin || (!!u.plus_until && Date.parse(u.plus_until) > Date.now()));

  if (b.action === 'preview') { // essai : message d'un compte pour un créneau, sans envoi
    const { data: r } = await db.from('commute_alerts').select('*').eq('user_id', String(b.user_id ?? '')).maybeSingle();
    if (!r) return json({ error: 'row' }, 404);
    const { data: u } = await db.from('app_users').select('plan,plus_until,is_admin').eq('user_id', r.user_id).maybeSingle();
    const slot: Slot = b.slot === 'aft' ? 'aft' : b.slot === 'morn' ? 'morn' : 'eve', today = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : localParts(Date.now(), r.tz || 'Europe/Paris').date;
    const plus = b.free ? false : plusOf(u);
    const msg = await build(db, r as Row, plus, slot, today);
    if (b.send && msg) return json({ ok: true, plus, msg, ...(await deliver(db, keys, r.user_id, msg)) });
    return json({ ok: true, plus, msg });
  }
  if (b.action !== 'cron') return json({ error: 'action' }, 400);

  const now = Date.now(), out: unknown[] = [], users = new Map<string, unknown>();
  const userOf = async (id: string) => { if (!users.has(id)) { const { data } = await db.from('app_users').select('plan,plus_until,is_admin').eq('user_id', id).maybeSingle(); users.set(id, data); }
    return users.get(id) as { plan?: string; plus_until?: string | null; is_admin?: boolean } | null; };
  // heure de départ de l'aller (minutes) ; heure d'arrivée → départ estimé sans vent (distance / vitesse + montée / VAM) et marge
  const goStart = async (r: Row, day: string) => {
    const go = times(r, day).go; if (r.go_mode !== 'arr') return mins(go);
    const tr0 = await trace(db, r.user_id, r.route_go); if (!tr0) return mins(go);
    const R = route(tr0.pts), speed = Math.min(45, Math.max(10, Number(r.speed) || 20)), vam = Math.min(1500, Math.max(250, Number(r.vam) || 700));
    const h = R.segs.reduce((a, g) => a + g.km / speed + g.climb / vam, 0);
    return mins(go) - Math.round(h * 60) - (Number(r.margin) || 0);
  };
  const { data: rows } = await db.from('commute_alerts').select('*').eq('enabled', true).not('route_go', 'is', null);
  for (const r of (rows ?? []) as Row[]) {
    try {
      const tz = r.tz || 'Europe/Paris', L = localParts(now, tz), cur = L.hour * 60 + L.minute;
      let slot: Slot | null = null;
      if (r.last_eve !== L.date && cur >= 20 * 60 + 30 && cur < 22 * 60) slot = 'eve';
      else if (r.last_morn !== L.date && isoWd(L.date) <= 5 && cur < mins(times(r, L.date).go) && plusOf(await userOf(r.user_id))) {
        const d = await goStart(r, L.date) - 45; if (cur >= d && cur < d + 30) slot = 'morn';
      }
      if (!slot && r.last_aft !== L.date && isoWd(L.date) <= 5) { const a = mins(times(r, L.date).back) - 120; if (cur >= a && cur < a + 60) slot = 'aft'; }
      if (!slot) continue;
      await db.from('commute_alerts').update(slot === 'eve' ? { last_eve: L.date } : slot === 'morn' ? { last_morn: L.date } : { last_aft: L.date }).eq('user_id', r.user_id);
      const { data: u } = await db.from('app_users').select('status,pmr,plan,plus_until,is_admin').eq('user_id', r.user_id).maybeSingle();
      if (!u || u.status !== 'active' || !u.pmr) continue;
      const msg = await build(db, r, plusOf(u), slot, L.date); if (!msg) { out.push({ u: r.user_id, slot, skip: true }); continue; }
      out.push({ u: r.user_id, slot, ...(await deliver(db, keys, r.user_id, msg)) });
    } catch (e) { out.push({ u: r.user_id, error: String((e as Error).message ?? e).slice(0, 200) }); }
  }
  return json({ ok: true, done: out });
});
