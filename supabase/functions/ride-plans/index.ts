import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush, type VapidKeys, type Sub } from './webpush.ts';
import { sendFcm } from './fcm.ts';
import { localParts, zoned, addDays, route, weather, ride, verdict, tr, LANGS, unitsOf, cv } from './forecast.ts';

// Sorties programmées (26/11/2026) : jour et heure gardés avec une trace Sortie (table ride_plans, écrite par l'app).
// POST { action: 'cron' } avec l'en-tête x-cron-token (push_keys), chaque heure (pg_cron, minute 1) :
// la veille du jour prévu, à 19 h heure locale → « Météo sur ta trace … » (Sillage.cc +) ou une invitation (compte gratuit).
// POST { action: 'preview', user_id, route_id?, free?, send? } (même jeton) : le message d'un compte, envoyé si send.

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const SITE = 'https://app.sillage-ride.eu/';
type Admin = ReturnType<typeof createClient>;
type Plan = { user_id: string; route_id: string; date: string; time: string; tz: string | null; lang: string | null; dist: string | null; temp: string | null;
  speed: number | null; vam: number | null; page: string | null; notified_at: string | null };

const EN: Record<string, string> = {
  'Météo sur ta trace {0}': 'Weather for your route {0}', 'Demain {0}': 'Tomorrow {0}', 'Ta sortie de demain': "Tomorrow's ride",
  'Avec Sillage.cc +, tu recevrais ici la météo de ta trace « {0} » la veille au soir.': 'With Sillage.cc +, you would get the weather for your route “{0}” here the evening before.',
};
const t = (lang: string, k: string, a: (string | number)[] = []) => (lang === 'en' && EN[k] ? EN[k] : k).replace(/\{(\d+)\}/g, (_m, i) => String(a[+i]));

async function build(db: Admin, p: Plan, plus: boolean, today: string) {
  const lang = LANGS.includes(String(p.lang)) ? String(p.lang) : 'fr', tz = p.tz || 'Europe/Paris', u = unitsOf(p);
  const { data: r } = await db.from('routes').select('id,name,pts').eq('user_id', p.user_id).eq('id', p.route_id).is('deleted_at', null).maybeSingle();
  if (!r || !Array.isArray(r.pts) || r.pts.length < 2) return null;
  const name = String(r.name || ''), page = p.page && p.page.startsWith(SITE) ? p.page : SITE;
  if (!plus) return { title: t(lang, 'Ta sortie de demain'), body: t(lang, 'Avec Sillage.cc +, tu recevrais ici la météo de ta trace « {0} » la veille au soir.', [name]),
    url: page + '?open=plus', tag: 'sillage-ride-' + p.route_id };
  const R = route(r.pts as number[][]), speed = Math.min(45, Math.max(10, Number(p.speed) || 25)), vam = Math.min(1500, Math.max(250, Number(p.vam) || 700));
  const ahead = Math.round((Date.parse(p.date) - Date.parse(today)) / 864e5);
  const wx = await weather(R.smp, addDays(p.date, -1), addDays(p.date, 1), ahead <= 2);
  const s = ride(R, wx, zoned(p.date, p.time, tz), speed, vam), v = verdict(s, lang, u);
  const T = (k: string, a?: (string | number)[]) => tr(lang, k, a, u);
  const ressenti = Math.round(s.amin) === Math.round(s.amax) ? T('ressenti {0} °C', [cv.t(u, s.amin)]) : T('ressenti {0} à {1} °C', [cv.t(u, s.amin), cv.t(u, s.amax)]);
  const at = lang === 'en' ? p.time : p.time.replace(':', 'h');
  const when = p.date === addDays(today, 1) ? t(lang, 'Demain {0}', [at]) : p.date + ' ' + at;
  const body = s.miss ? T('Prévision incomplète pour ce parcours.') : `${when} · ${['🟢', '🟠', '🔴'][v.lvl]} ${v.txt} · ${ressenti}`;
  return { title: t(lang, 'Météo sur ta trace {0}', [name]), body,
    url: `${page}?route=${encodeURIComponent(p.route_id)}&date=${p.date}&time=${p.time}`, tag: 'sillage-ride-' + p.route_id };
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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const tok = req.headers.get('x-cron-token') ?? '';
  const { data: k } = await db.from('push_keys').select('cron_token,pub,priv').eq('id', 1).maybeSingle();
  if (!tok || !k?.cron_token || tok !== k.cron_token) return json({ error: 'auth' }, 401);
  let b: Record<string, unknown> = {}; try { b = await req.json(); } catch (_) { /* vide */ }
  const keys = k.pub && k.priv ? { pub: k.pub, priv: k.priv } as VapidKeys : null;
  const plusOf = (u: { plan?: string; plus_until?: string | null; is_admin?: boolean } | null) => !!u && (u.plan === 'full' || !!u.is_admin || (!!u.plus_until && Date.parse(u.plus_until) > Date.now()));

  if (b.action === 'preview') {
    let q = db.from('ride_plans').select('*').eq('user_id', String(b.user_id ?? ''));
    if (b.route_id) q = q.eq('route_id', String(b.route_id));
    const { data: rows } = await q.order('updated_at', { ascending: false }).limit(1);
    const p = (rows ?? [])[0] as Plan | undefined; if (!p) return json({ error: 'plan' }, 404);
    const { data: u } = await db.from('app_users').select('plan,plus_until,is_admin').eq('user_id', p.user_id).maybeSingle();
    const plus = b.free ? false : plusOf(u), today = addDays(p.date, -1);
    const msg = await build(db, p, plus, today);
    if (b.send && msg) return json({ ok: true, plus, msg, ...(await deliver(db, keys, p.user_id, msg)) });
    return json({ ok: true, plus, msg });
  }
  if (b.action !== 'cron') return json({ error: 'action' }, 400);

  const now = Date.now(), out: unknown[] = [];
  const { data: rows } = await db.from('ride_plans').select('*').is('notified_at', null).gte('date', new Date(now - 864e5).toISOString().slice(0, 10));
  for (const p of (rows ?? []) as Plan[]) {
    try {
      const L = localParts(now, p.tz || 'Europe/Paris');
      if (L.hour !== 19 || p.date !== addDays(L.date, 1)) continue;
      await db.from('ride_plans').update({ notified_at: new Date().toISOString() }).eq('user_id', p.user_id).eq('route_id', p.route_id);
      const { data: u } = await db.from('app_users').select('status,pmr,plan,plus_until,is_admin').eq('user_id', p.user_id).maybeSingle();
      if (!u || u.status !== 'active' || !u.pmr) continue;
      const { data: np } = await db.from('notif_prefs').select('ride').eq('user_id', p.user_id).maybeSingle(); // menu Notifications (27/11/2026)
      if (np && np.ride === false) continue;
      const msg = await build(db, p, plusOf(u), L.date); if (!msg) continue;
      out.push({ u: p.user_id, r: p.route_id, ...(await deliver(db, keys, p.user_id, msg)) });
    } catch (e) { out.push({ u: p.user_id, error: String((e as Error).message ?? e).slice(0, 200) }); }
  }
  return json({ ok: true, done: out });
});
