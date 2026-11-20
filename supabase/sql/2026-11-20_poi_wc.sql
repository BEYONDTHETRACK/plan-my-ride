-- Nouveaux types de point pour la Carte : wc (toilettes), douche, defibrillateur, atm
alter table public.poi drop constraint if exists poi_type_check;
alter table public.poi add constraint poi_type_check
  check (type in ('bivouac','boulangerie','fontaine','epicerie','atelier','abri','cafe','recharge','wc','douche','defibrillateur','atm'));
