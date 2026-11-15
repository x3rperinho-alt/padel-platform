-- дубль игрока Vitaliy Багно (неактивный, без записей, матчей и привязки в league_members) — из-за него в «моём профиле» показывался чужой уровень
delete from public.players p
 where p.id = 'p_d02c74cf0d46'
   and not exists (select 1 from public.registrations r where r.player_id = p.id)
   and not exists (select 1 from public.games g where p.id = any(g.team_a) or p.id = any(g.team_b))
   and not exists (select 1 from public.league_members m where m.player_id = p.id);
-- у одного аккаунта в лиге — только один игрок (защита от двойного нажатия «Сохранить» в анкете)
create unique index if not exists players_one_per_user on public.players (league_id, user_id) where user_id is not null;
