-- 0011: анкета в открытой лиге сама делает человека участником (раньше могла упасть с «not a member»).
create or replace function public.create_my_player(p_league text, p_name text, p_level numeric, p_source text, p_contacts jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_id text; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- в открытую лигу (коммьюнити) анкета сама добавляет в участники, если вход по какой-то причине этого не сделал
  if not public.is_member(p_league) then
    if coalesce((select (settings->>'open_join')::boolean from public.leagues where id = p_league), false) then
      insert into public.league_members (league_id, user_id, role) values (p_league, auth.uid(), 'player') on conflict (league_id, user_id) do nothing;
    else raise exception 'not a member'; end if;
  end if;
  if exists (select 1 from public.players where league_id = p_league and user_id = auth.uid()) then raise exception 'already has player'; end if;
  if length(v_name) < 2 or length(v_name) > 40 then raise exception 'bad name'; end if;
  if p_level is null or p_level < 0 or p_level > 7 then raise exception 'bad level'; end if;
  -- по тесту уровень считает сервер из баллов, а не берёт с телефона
  if p_source = 'quiz' then
    -- уровень по тесту считает сервер из ответов, а не берёт с телефона
    p_level := round(public.quiz_elo(p_contacts->'quiz') / 1000.0, 3);
    p_contacts := p_contacts || jsonb_build_object('quiz_elo', public.quiz_elo(p_contacts->'quiz'));
  elsif p_source in ('playtomic','pado','raketo') then
    -- рейтинг из приложения — только заявка: админ сверит по нику в этом приложении
    if coalesce(trim(p_contacts->>p_source), '') = '' then raise exception 'app nick required'; end if;
  else raise exception 'bad source'; end if;
  v_id := 'p_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into public.players (id, league_id, name, active, user_id, level, elo_start, elo_confirmed, contacts, level_status, level_claim)
  values (v_id, p_league, v_name, true, auth.uid(),
          case when p_source = 'quiz' then p_level end, public.level_elo(case when p_source = 'quiz' then p_level end), false,
          coalesce(p_contacts, '{}'::jsonb) || jsonb_build_object('level_source', p_source),
          case when p_source = 'quiz' then 'ok' else 'pending' end, case when p_source = 'quiz' then null else round(p_level, 3) end);
  update public.league_members set player_id = v_id where league_id = p_league and user_id = auth.uid();
  insert into public.logs(league_id, user_id, action) values (p_league, auth.uid(), 'Анкета: ' || v_name || ' · уровень ' || p_level || ' (' || coalesce(p_source,'?') || ')');
  return v_id;
end $$;
