# Padel Platform

Одно приложение, несколько лиг. Лига «friends» (Padel Club, 8–10 человек) и лига «048» (048 Padel Community) живут в одной базе, но изолированы друг от друга и используют разные интерфейсы.

```
supabase/migrations/      схема базы (таблицы, права, realtime)
supabase/functions/       серверные функции (вход через Telegram, позже — бот)
scripts/                  перенос данных из артефакта, резервные копии
apps/friends/             интерфейс для лиги друзей (текущее приложение)
apps/community/           интерфейс для 048 (этап 2)
packages/core/            общие движки: Эло, Американо, SwissCourt, факты
data/friends-state.json   выгрузка данных из артефакта на момент переноса
```

## Шаг A. Аккаунты (один раз, ~20 минут)

1. **GitHub** — github.com → Sign up (email + пароль). Это дом для кода.
2. **Supabase** — supabase.com → Start your project → «Continue with GitHub».
   - New project: имя `padel`, регион `Frankfurt (eu-central-1)`, пароль базы — сгенерируй и сохрани в менеджере паролей.
   - Подожди 1–2 минуты, пока проект создаётся.
3. **Netlify** — netlify.com → Sign up → «GitHub». Пока больше ничего не делай.

## Шаг B. Код в GitHub

1. На GitHub: New repository → имя `padel-platform`, Private → Create.
2. Загрузи содержимое этой папки: на странице репозитория «uploading an existing file» → перетащи все файлы и папки → Commit.
   (Если удобнее через git: `git init && git add . && git commit -m init && git remote add origin <url> && git push -u origin main`.)

## Шаг C. База

1. Supabase → твой проект → слева **SQL Editor** → New query → вставь целиком содержимое `supabase/migrations/0001_init.sql` → Run. Внизу должно быть «Success».
2. **Project Settings → API**: скопируй `Project URL`, `anon public` ключ и `service_role` ключ (последний — секретный, никому и никуда, кроме мест ниже).

## Шаг D. Перенос данных из артефакта

На своём компьютере (нужен Node.js 20+; если нет — nodejs.org, LTS):
```
cd padel-platform
npm install
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/import-friends.mjs data/friends-state.json
```
Ожидаемый вывод: `imported: 11 players, 9 tournaments, 124 games, ...`.
(Windows PowerShell: `$env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/import-friends.mjs data/friends-state.json`)

## Шаг E. Вход через Telegram

1. Установи Supabase CLI (один раз): `npm install -g supabase`.
2. `supabase login` → откроется браузер → подтверди.
3. `supabase link --project-ref <ref>` (ref — часть адреса проекта до `.supabase.co`).
4. Секреты: `supabase secrets set BOT_TOKEN_FRIENDS=<токен бота @padelinfoodessa_bot> AUTH_PEPPER=<любая длинная случайная строка>`
   Для коммьюнити позже: `BOT_TOKEN_048=<токен второго бота>`.
5. `supabase functions deploy telegram-auth --no-verify-jwt`

## Шаг F. Вход через Google и email (для браузера)

Supabase → **Authentication → Providers**:
- **Email**: включён по умолчанию (вход по ссылке на почту). Для начала достаточно.
- **Google**: включить, вставить Client ID / Secret из Google Cloud Console (OAuth consent screen → Credentials → OAuth client, тип Web, Authorized redirect URI — показан в Supabase на той же странице). Можно сделать позже.

**Authentication → URL Configuration**: Site URL — адрес сайта из шага G; в Redirect URLs добавить его же.

## Шаг G. Сайт

Netlify → Add new site → Import from Git → GitHub → `padel-platform`.
- Base directory: `apps/friends`  ·  Publish directory: `apps/friends`  ·  Build command: пусто.
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon, не service_role!).
- Deploy. Адрес вида `https://<имя>.netlify.app` → Site configuration → Change site name → например `padel-club-odesa`.

Для коммьюнити позже добавляется второй сайт из того же репозитория с Base directory `apps/community`.

## Шаг H. Telegram

BotFather → `/mybots` → бот → Bot Settings → Menu Button (или Web App) → URL сайта из шага G. В группе Mini App открывается тем же способом, что и раньше.

## Шаг I. Себя — владельцем лиги

После первого входа в приложение (любым способом) Supabase → Table Editor → `league_members` → найди свою строку (league_id = friends) → role → `owner`. С этого момента ты редактор; остальные входящие через бота получают роль `player`.

## Резервные копии и «не засыпать»

GitHub → репозиторий → Settings → Secrets and variables → Actions → добавь `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`.
Workflow `keepalive-and-backup` раз в сутки делает выгрузку всех таблиц в `backups/` и этим же не даёт бесплатному проекту уснуть. Проверить вручную: Actions → keepalive-and-backup → Run workflow.
