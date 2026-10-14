-- ============================================================
-- Padel Platform · схема базы · миграция 0001
-- Одна база, несколько лиг (сообществ). Все данные привязаны к league_id.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- лиги ----------
create table public.leagues (
  id          text primary key,                 -- 'friends', '048'
  name        text not null,
  ui          text not null default 'friends',  -- какой интерфейс: 'friends' | 'community'
  settings    jsonb not null default '{}'::jsonb, -- язык, цвета, правила отмены, бот и т.п.
  created_at  timestamptz not null default now()
);

-- ---------- профили пользователей (1 строка на аккаунт) ----------
-- telegram_id и прочие идентификаторы наружу не отдаются (см. view public_profiles)
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  lang         text not null default 'uk',
  telegram_id  bigint unique,
  telegram_username text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- ---------- участие в лиге и роль ----------
create table public.league_members (
  league_id   text not null references public.leagues(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'player' check (role in ('owner','admin','editor','player','viewer')),
  player_id   text,                               -- к какому игроку привязан аккаунт (может быть null)
  joined_at   timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- ---------- игроки лиги ----------
create table public.players (
  id            text not null,
  league_id     text not null references public.leagues(id) on delete cascade,
  name          text not null,
  active        boolean not null default true,
  user_id       uuid references auth.users(id) on delete set null,
  level         numeric(3,1),                     -- уровень 0..7 (Playtomic-шкала), null = не задан
  elo_start     integer not null default 1500,    -- стартовый Эло (из опроса/вручную)
  elo_confirmed boolean not null default false,   -- подтверждён после N турниров (или админом)
  contacts      jsonb not null default '{}'::jsonb, -- то, что игрок сам внёс (instagram и т.п.)
  bio           text,
  created_at    timestamptz not null default now(),
  primary key (league_id, id)
);

-- ---------- клубы ----------
create table public.clubs (
  league_id text not null references public.leagues(id) on delete cascade,
  name      text not null,
  sort      integer not null default 0,
  primary key (league_id, name)
);

-- ---------- брони ----------
create table public.bookings (
  id         text not null,
  league_id  text not null references public.leagues(id) on delete cascade,
  date       date not null,
  time_start text,
  time_end   text,
  club       text,
  courts     text,
  court_type text,
  primary key (league_id, id)
);

-- ---------- турниры ----------
create table public.tournaments (
  id              text not null,
  league_id       text not null references public.leagues(id) on delete cascade,
  seq             integer not null default 0,
  name            text not null,
  date            date,
  status          text not null default 'scheduled',
  format          text not null,                  -- americano | roundrobin | swiss | playoff
  courts          integer,
  participant_ids text[] not null default '{}',
  teams           jsonb not null default '[]'::jsonb,
  scoring         jsonb not null default '{}'::jsonb, -- {type, mode, target, minutes}
  rounds          integer,
  swiss_cap       integer,
  linked_to       text,                           -- этап 2 → id этапа 1
  money           jsonb not null default '{}'::jsonb, -- финансы: только админам (см. политики)
  settings        jsonb not null default '{}'::jsonb, -- уровень допуска, слоты, дедлайн и т.п.
  created_at      timestamptz not null default now(),
  primary key (league_id, id)
);

-- ---------- игры ----------
create table public.games (
  id            text not null,
  league_id     text not null references public.leagues(id) on delete cascade,
  tournament_id text not null,
  round         integer not null,
  court         integer,
  team_a        text[] not null,
  team_b        text[] not null,
  score_a       integer,
  score_b       integer,
  label         text,
  primary key (league_id, id),
  foreign key (league_id, tournament_id) references public.tournaments(league_id, id) on delete cascade
);
create index games_tournament_idx on public.games(league_id, tournament_id);

-- ---------- журнал ----------
create table public.logs (
  id        bigserial primary key,
  league_id text not null references public.leagues(id) on delete cascade,
  at        timestamptz not null default now(),
  user_id   uuid,
  action    text not null
);
create index logs_league_idx on public.logs(league_id, at desc);

-- ---------- записи на турниры (коммьюнити, этап 3; таблица создаётся сразу) ----------
create table public.registrations (
  league_id     text not null,
  tournament_id text not null,
  player_id     text not null,
  status        text not null default 'main' check (status in ('main','reserve','cancelled')),
  paid          boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (league_id, tournament_id, player_id),
  foreign key (league_id, tournament_id) references public.tournaments(league_id, id) on delete cascade
);

-- ---------- очередь сообщений бота (этап 4): ничего не уходит без одобрения ----------
create table public.bot_outbox (
  id         bigserial primary key,
  league_id  text not null references public.leagues(id) on delete cascade,
  kind       text not null,                       -- 'announce' | 'round' | 'results' | 'reminder'
  text       text not null,
  status     text not null default 'draft' check (status in ('draft','approved','sent','cancelled')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

-- ============================================================
-- Вспомогательные функции для политик
-- ============================================================
create or replace function public.my_role(p_league text) returns text
language sql stable security definer set search_path = public as $$
  select role from public.league_members where league_id = p_league and user_id = auth.uid()
$$;

create or replace function public.is_member(p_league text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.league_members where league_id = p_league and user_id = auth.uid())
$$;

create or replace function public.can_edit(p_league text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_league) in ('owner','admin','editor'), false)
$$;

create or replace function public.is_admin(p_league text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_league) in ('owner','admin'), false)
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.leagues        enable row level security;
alter table public.profiles       enable row level security;
alter table public.league_members enable row level security;
alter table public.players        enable row level security;
alter table public.clubs          enable row level security;
alter table public.bookings       enable row level security;
alter table public.tournaments    enable row level security;
alter table public.games          enable row level security;
alter table public.logs           enable row level security;
alter table public.registrations  enable row level security;
alter table public.bot_outbox     enable row level security;

-- лиги: видят участники; менять — владелец/админ
create policy leagues_read   on public.leagues for select using (public.is_member(id));
create policy leagues_update on public.leagues for update using (public.is_admin(id));

-- профиль: свой читает/правит сам; чужие — только через view public_profiles (без telegram_id)
create policy profiles_self_read   on public.profiles for select using (user_id = auth.uid());
create policy profiles_self_update on public.profiles for update using (user_id = auth.uid());
create policy profiles_self_insert on public.profiles for insert with check (user_id = auth.uid());

-- участники лиги: список видят участники; управляют админы; сам себя добавить может по приглашению (функция join_league)
create policy members_read   on public.league_members for select using (public.is_member(league_id));
create policy members_admin  on public.league_members for all using (public.is_admin(league_id)) with check (public.is_admin(league_id));

-- игроки, клубы, брони, турниры, игры: читают участники; пишут редакторы
create policy players_read   on public.players for select using (public.is_member(league_id));
create policy players_write  on public.players for all using (public.can_edit(league_id)) with check (public.can_edit(league_id));
create policy players_self   on public.players for update using (user_id = auth.uid()) with check (user_id = auth.uid()); -- свой профиль игрока (контакты, имя)

create policy clubs_read     on public.clubs for select using (public.is_member(league_id));
create policy clubs_write    on public.clubs for all using (public.can_edit(league_id)) with check (public.can_edit(league_id));

create policy bookings_read  on public.bookings for select using (public.is_member(league_id));
create policy bookings_write on public.bookings for all using (public.can_edit(league_id)) with check (public.can_edit(league_id));

create policy tournaments_read  on public.tournaments for select using (public.is_member(league_id));
create policy tournaments_write on public.tournaments for all using (public.can_edit(league_id)) with check (public.can_edit(league_id));

create policy games_read     on public.games for select using (public.is_member(league_id));
create policy games_write    on public.games for all using (public.can_edit(league_id)) with check (public.can_edit(league_id));

-- журнал: читают только редакторы+ (там имена редакторов), пишут редакторы+
create policy logs_read      on public.logs for select using (public.can_edit(league_id));
create policy logs_write     on public.logs for insert with check (public.can_edit(league_id));

-- записи: участники видят; игрок управляет своей записью; админ — всеми
create policy regs_read      on public.registrations for select using (public.is_member(league_id));
create policy regs_self      on public.registrations for all
  using (public.is_member(league_id) and player_id = (select player_id from public.league_members where league_id = registrations.league_id and user_id = auth.uid()))
  with check (public.is_member(league_id) and player_id = (select player_id from public.league_members where league_id = registrations.league_id and user_id = auth.uid()));
create policy regs_admin     on public.registrations for all using (public.is_admin(league_id)) with check (public.is_admin(league_id));

-- очередь бота: только админы
create policy outbox_admin   on public.bot_outbox for all using (public.is_admin(league_id)) with check (public.is_admin(league_id));

-- ============================================================
-- Финансы турнира — только админам: остальным отдаём турниры без поля money через view
-- ============================================================
create view public.tournaments_public with (security_invoker = true) as
  select id, league_id, seq, name, date, status, format, courts, participant_ids, teams, scoring, rounds, swiss_cap, linked_to, settings, created_at,
         case when public.is_admin(league_id) then money else '{}'::jsonb end as money
  from public.tournaments;

-- Публичные профили (без telegram_id/username) — для карточек игроков
create view public.public_profiles with (security_invoker = true) as
  select p.user_id, p.display_name, p.avatar_url
  from public.profiles p
  where exists (select 1 from public.league_members m1
                join public.league_members m2 on m1.league_id = m2.league_id
                where m1.user_id = auth.uid() and m2.user_id = p.user_id);

-- ============================================================
-- Вступление в лигу по коду-приглашению (settings.invite_code)
-- ============================================================
create or replace function public.join_league(p_league text, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select settings->>'invite_code' into v_code from public.leagues where id = p_league;
  if v_code is null or v_code <> p_code then raise exception 'bad invite code'; end if;
  insert into public.league_members (league_id, user_id, role) values (p_league, auth.uid(), 'player')
    on conflict do nothing;
  return 'ok';
end $$;

-- ============================================================
-- Realtime: включаем трансляцию изменений для таблиц, которые смотрит интерфейс
-- ============================================================
alter publication supabase_realtime add table public.players, public.clubs, public.bookings, public.tournaments, public.games, public.registrations;
