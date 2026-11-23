# Sillage (dépôt plan-my-ride) — notes pour Claude Code

Application de planification de sorties vélo : trace GPX + prévisions météo, en ligne sur https://app.sillage-ride.eu/ et en app iPhone / Android (dossier `app/`). Ancien nom : Plan My Ride (les noms techniques `pmr-*`, `plan-my-ride` restent).

**Ce fichier ne garde que l'essentiel.** Le détail de chaque fonctionnalité est dans `docs/notes/` (texte complet d'avant le 23/11/2026, non résumé) : lis le fichier concerné avant de modifier une partie du code. Une nouvelle note sur une fonctionnalité va dans le fichier de `docs/notes/` qui en parle ; ici, seulement les règles générales.

## Contraintes
- Tout tient dans `index.html` (pas de build, pas de framework). Garder ce choix sauf demande contraire.
- Déploiement : GitHub Pages depuis la branche `main`, racine du dépôt `BEYONDTHETRACK/plan-my-ride`, sur https://app.sillage-ride.eu/ (fichier `CNAME` à la racine, DNS OVH `app` CNAME → `beyondthetrack.github.io.`). Historique de la migration : `docs/notes/comptes-et-serveur.md`.
- Interface en français et en anglais : tout texte affiché passe par `T('…')` (ou le HTML) et sa traduction va dans `lang.js`. Voir `docs/notes/interface.md`.
- Unités : tout est calculé en km, m, km/h, °C, mm ; toute valeur affichée à côté d'une unité passe par `fD` / `fE` / `fV` / `fT` / `fR`. Voir `docs/notes/interface.md`.
- Leaflet 1.9.4 via cdnjs. Fonds sans clé uniquement (CARTO exige désormais une clé) : OSM standard (seulement servi en http(s), il exige un Referer), CyclOSM, OpenTopoMap, Esri Topo/Satellite. En `file://`, le fond par défaut est Esri Topo.

## Règles de travail
- Les nouveautés se font d'abord dans `test.html` (https://app.sillage-ride.eu/test.html), copie de `index.html`. Mise en ligne quand Antoine valide : recopier `test.html` dans `index.html` (ou reporter seulement les morceaux validés), en gardant ce qui diffère : lien de la supervision (`sup-test-k7q2x9.html` dans test.html, `sup-k7q2x9.html` dans index.html), manifeste (`manifest-test.webmanifest` / `manifest.webmanifest`), morceaux test seulement (mode démo, compte gratuit, Sillage.cc +…). Toute correction faite dans `index.html` doit être reportée dans `test.html` tant que les deux diffèrent. Détail et historique des mises en ligne : `docs/notes/ecrans.md`.
- Supervision : `sup-k7q2x9.html` (prod) et `sup-test-k7q2x9.html` (test), adresse non devinable, jamais liée depuis la vitrine ; `admin.html` / `admin-test.html` sont des pages vides « Page introuvable ». Les notes qui disent `admin.html` / `admin-test.html` désignent ces deux pages renommées.
- Parcours du compte : toute requête sur `routes` côté app garde `.eq('user_id', SB_UID)` (sinon un admin voit et modifie les parcours des autres).
- App : `app/scripts/build-www.mjs` adapte une copie de la page ; si on change dans index.html / test.html la balise viewport, le manifeste, les polices Google, Leaflet CDN, `redirectTo` ou le lien de la supervision, adapter le script. Origine de l'app fixée par `server.hostname` = `app.sillage-ride.eu` : ne plus la changer. Voir `docs/notes/app-mobile-et-alertes.md`.
- Supabase : projet `plan-my-ride` (réf. `bsypkdsnhiepvcnhmfsm`, Francfort), organisation « Production » (plan Pro) du compte Beyond The Track. Sources des fonctions dans `supabase/functions/` ; préférer `npm:@supabase/supabase-js@2` à `jsr:`. Clés et secrets (`OPENMETEO_API_KEY`, `METEOBLUE_API_KEY`, `BREVO_API_KEY`, clés VAPID de `push_keys`) jamais dans le dépôt. La CLI Supabase n'est pas installée sur le Mac d'Antoine : déployer par le connecteur Supabase.
- GitHub : tous les dépôts sont chez BEYONDTHETRACK (vitrine `BEYONDTHETRACK/sillage-site` sur sillage-ride.eu, hébergée chez OVH par FTP ; Coach Miguel `BEYONDTHETRACK/coach-miguel` sur https://beyondthetrack.github.io/coach-miguel/). `coach.html` n'est qu'une redirection vers Coach Miguel.
- Décision du 07/11/2026 : pas d'ouverture de la version web au grand public pour l'instant (mobile et tablette d'abord).
- Charte Sillage (couleurs, police Archivo, logo) : `docs/notes/interface.md`.

## Où trouver le détail (`docs/notes/`)
| Fichier | Contenu |
|---|---|
| `ecrans.md` | Page de test et historique des mises en ligne ; écrans Sortie, Ultra, Commute (Vélotaf), Mes parcours, Mes sorties, Moi, Aide, connexion ; refontes v2.0 ; planification journalière et lieux le long de la trace (Ultra) ; Mes parcours (IndexedDB, compte) ; lune, ciel ; Carte des points utiles ; Tendance 5 semaines ; démo en accès libre ; packs de points OSM ; fond de carte « Sillage » ; flèches de vent |
| `meteo-et-calcul.md` | Architecture du script (`parseGPX`, `prepare`, `simulate`, `wxAt`, rendus) ; sources météo (Open-Meteo et modèles nationaux, MET Norway, AROME, « Le plus précis selon le lieu », meteoblue) ; graphes, export image ; modèle de vitesse ; Open-Meteo payant (relais `open-meteo`, quota) ; meteoblue réservé aux admins |
| `comptes-et-serveur.md` | Accès et écran de connexion, comptes, quotas, supervision ; séparation de Coach Miguel ; connexion Google / Apple / code ; conservation des données et pages légales ; suppression du compte ; inscription ouverte ; trois offres (démo, gratuit, Sillage.cc +) ; migration du 23/11/2026 |
| `app-mobile-et-alertes.md` | App Capacitor (`app/`, `native.js`, écran de démarrage, icônes) ; alertes météo (`push-alerts`, `sw.js`) et application installable |
| `interface.md` | Langues (`T`, `lang.js`), unités, charte Sillage, accessibilité, polices, thème |
