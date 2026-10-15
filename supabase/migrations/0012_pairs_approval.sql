-- 0012: запись парами (N пар по 2 места) и подтверждение заявок админом.
-- settings турнира: pairs = true → slots означает количество пар; approval = true → заявки ждут админа.

alter table public.registrations add column if not exists team_no  integer;   -- номер пары (только для турниров парами)
alter table public.registrations add column if not exists approval text not null default 'ok';
alter table public.registrations add column if not exists added_by text;      -- кто записал (себя или партнёра)
alter table public.registrations drop constraint if exists registrations_approval_check;
alter table public.registrations add constraint registrations_approval_check check (approval in ('ok','pending','rejected'));

-- Игрок больше не пишет в таблицу записей напрямую (иначе мог бы сам поставить себе «основа» / «подтверждено»).
-- Читать могут все участники (regs_read), админ правит всё (regs_admin), игрок — только через функции ниже.
drop policy if exists regs_self on public.registrations;

-- Старая версия функции была с 2 параметрами — убираем, чтобы не было двух одноимённых функций
drop function if exists public.register_tournament(text, text);

-- Запись: себя или себя с партнёром (только в турнире парами); p_team — номер пары, куда встать (необязательно)
create or replace function public.register_tournament(p_league text, p_tournament text, p_team integer default null, p_partner text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_pid text; v_t record; v_pairs boolean; v_n int; v_main int; v_status text; v_appr text; v_team int; v_need int; v_occ int;
  v_ids text[]; v_x text; v_lv numeric; v_ls text; v_min numeric; v_max numeric; v_me boolean;
begin
  select player_id into v_pid from public.league_members where league_id = p_league and user_id = auth.uid();
  if v_pid is null then raise exception 'no player card'; end if;
  -- блокируем турнир: две записи одновременно не займут одно место
  select * into v_t from public.tournaments where league_id = p_league and id = p_tournament for update;
  if not found then raise exception 'no tournament'; end if;
  if not coalesce((v_t.settings->>'reg_open')::boolean, false) or v_t.status = 'played' then raise exception 'registration closed'; end if;
  v_pairs := coalesce((v_t.settings->>'pairs')::boolean, false);
  if p_partner is not null and not v_pairs then raise exception 'pairs only'; end if;
  if p_partner = v_pid then raise exception 'bad partner'; end if;
  v_ids := array[v_pid] || case when p_partner is not null then array[p_partner] else '{}'::text[] end;
  v_min := (v_t.settings->>'level_min')::numeric; v_max := (v_t.settings->>'level_max')::numeric;

  foreach v_x in array v_ids loop
    v_me := v_x = v_pid;
    select level, level_status into v_lv, v_ls from public.players where league_id = p_league and id = v_x and active;
    if not found then raise exception 'no partner'; end if;
    if v_ls <> 'ok' then raise exception '%', case when v_me then 'level pending' else 'partner level pending' end; end if;
    if v_min is not null and (v_lv is null or v_lv < v_min) then raise exception '%', case when v_me then 'level too low' else 'partner level too low' end; end if;
    if v_max is not null and (v_lv is null or v_lv > v_max) then raise exception '%', case when v_me then 'level too high' else 'partner level too high' end; end if;
    if exists (select 1 from public.registrations where league_id = p_league and tournament_id = p_tournament and player_id = v_x and status <> 'cancelled') then
      if v_me then return 'already'; else raise exception 'partner already registered'; end if;
    end if;
  end loop;

  -- админ записывает без подтверждения; остальные — ждут, если в турнире включено подтверждение
  v_appr := case when coalesce((v_t.settings->>'approval')::boolean, false) and not public.is_admin(p_league) then 'pending' else 'ok' end;
  v_n := coalesce((v_t.settings->>'slots')::int, 0);
  v_need := array_length(v_ids, 1);

  if v_pairs then
    if p_team is not null then
      if p_team < 1 or (v_n > 0 and p_team > v_n) then raise exception 'bad team'; end if;
      select count(*) into v_occ from public.registrations where league_id = p_league and tournament_id = p_tournament and team_no = p_team and status = 'main';
      if v_occ + v_need > 2 then raise exception 'team full'; end if;
      v_team := p_team; v_status := 'main';
    elsif v_n > 0 then
      -- первая полностью свободная пара; нет свободных — резерв
      select g into v_team from generate_series(1, v_n) g
        where not exists (select 1 from public.registrations r where r.league_id = p_league and r.tournament_id = p_tournament and r.team_no = g and r.status = 'main')
        order by g limit 1;
      v_status := case when v_team is null then 'reserve' else 'main' end;
    else
      select coalesce(max(team_no), 0) + 1 into v_team from public.registrations where league_id = p_league and tournament_id = p_tournament and status = 'main';
      v_status := 'main';
    end if;
  else
    select count(*) into v_main from public.registrations where league_id = p_league and tournament_id = p_tournament and status = 'main';
    v_status := case when v_n > 0 and v_main >= v_n then 'reserve' else 'main' end;
    v_team := null;
  end if;

  foreach v_x in array v_ids loop
    insert into public.registrations (league_id, tournament_id, player_id, status, paid, created_at, team_no, approval, added_by)
    values (p_league, p_tournament, v_x, v_status, false, now(), v_team, v_appr, v_pid)
    on conflict (league_id, tournament_id, player_id) do update
      set status = excluded.status, paid = false, created_at = now(), team_no = excluded.team_no, approval = excluded.approval, added_by = excluded.added_by;
  end loop;
  return v_status || case when v_appr = 'pending' then ':pending' else '' end;
end $$;

-- Первый из резерва → в основу (только для обычных турниров; в турнире парами резерв расставляет админ)
create or replace function public.promote_reserve(p_league text, p_tournament text) returns void
language plpgsql security definer set search_path = public as $$
declare v_t record; v_next text;
begin
  select * into v_t from public.tournaments where league_id = p_league and id = p_tournament;
  if v_t is null or coalesce((v_t.settings->>'pairs')::boolean, false) then return; end if;
  if coalesce((v_t.settings->>'slots')::int, 0) <= (select count(*) from public.registrations where league_id = p_league and tournament_id = p_tournament and status = 'main') then return; end if;
  select player_id into v_next from public.registrations where league_id = p_league and tournament_id = p_tournament and status = 'reserve' order by created_at limit 1;
  if v_next is not null then
    update public.registrations set status = 'main' where league_id = p_league and tournament_id = p_tournament and player_id = v_next;
  end if;
end $$;
-- вызывать её напрямую безопасно: она только применяет обычное правило «освободилось место → первый из резерва»

-- Снятие с турнира (или отзыв заявки)
create or replace function public.unregister_tournament(p_league text, p_tournament text) returns text
language plpgsql security definer set search_path = public as $$
declare v_pid text;
begin
  select player_id into v_pid from public.league_members where league_id = p_league and user_id = auth.uid();
  if v_pid is null then raise exception 'no player card'; end if;
  perform 1 from public.tournaments where league_id = p_league and id = p_tournament for update;
  delete from public.registrations where league_id = p_league and tournament_id = p_tournament and player_id = v_pid;
  perform public.promote_reserve(p_league, p_tournament);
  return 'ok';
end $$;

-- Админ: подтвердить или отклонить заявку
create or replace function public.review_registration(p_league text, p_tournament text, p_player text, p_action text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_league) then raise exception 'admins only'; end if;
  perform 1 from public.tournaments where league_id = p_league and id = p_tournament for update;
  if p_action = 'approve' then
    update public.registrations set approval = 'ok' where league_id = p_league and tournament_id = p_tournament and player_id = p_player and status <> 'cancelled';
    if not found then raise exception 'no registration'; end if;
  elsif p_action = 'reject' then
    update public.registrations set approval = 'rejected', status = 'cancelled', team_no = null where league_id = p_league and tournament_id = p_tournament and player_id = p_player;
    if not found then raise exception 'no registration'; end if;
    perform public.promote_reserve(p_league, p_tournament);
  else raise exception 'bad action'; end if;
  return 'ok';
end $$;

grant execute on function public.register_tournament(text, text, integer, text) to authenticated;
grant execute on function public.unregister_tournament(text, text) to authenticated;
grant execute on function public.review_registration(text, text, text, text) to authenticated;
