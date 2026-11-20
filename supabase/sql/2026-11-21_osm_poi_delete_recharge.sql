-- Le type « recharge » a été retiré de la Carte (21/11/2026) : on vide ses points OSM pour libérer de la place.
-- 1. Combien de lignes ? (à lancer d'abord)
select type, count(*) from public.osm_poi where type = 'recharge' group by type;

-- 2. Suppression (les points OSM peuvent être réimportés, rien d'irremplaçable).
delete from public.osm_poi where type = 'recharge';

-- 3. Rendre la place au disque (la taille affichée par Supabase ne baisse qu'après cette étape).
--    À lancer seul, sans les lignes du dessus, car VACUUM ne passe pas dans une transaction.
vacuum full public.osm_poi;
