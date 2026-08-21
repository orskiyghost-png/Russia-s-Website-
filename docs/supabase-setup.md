# Настройка Supabase для PULSE

## Переменные окружения

Frontend-переменные (задаются в Freebuff Settings → Environment и в локальном `.env.local`):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
VITE_TURNSTILE_SITE_KEY=your-cloudflare-turnstile-site-key
```

- `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` берутся из **Project Settings → API**.
- `VITE_TURNSTILE_SITE_KEY` — публичный site key Cloudflare Turnstile. Без него формы входа, регистрации и публикации сигналов блокируются.
- Service-role key и Turnstile **Secret Key** нельзя помещать в браузер, в `.env.local` или в переменные `VITE_`. Secret Key хранится только в Supabase Dashboard (см. ниже).

## SQL за два шага

**Шаг 1.** **SQL Editor → New query**: вставьте содержимое [`supabase/schema.sql`](../supabase/schema.sql) целиком и нажмите **Run**. Скрипт идемпотентен: таблицы `profiles` и `events`, индексы PostGIS, RLS-политики, триггер профиля, RPC `create_event()` с антиспам-лимитом и добавление `events` в `supabase_realtime`.

**Шаг 2.** **SQL Editor → New query**: вставьте содержимое [`supabase/migrations/0001_social_features.sql`](../supabase/migrations/0001_social_features.sql) целиком и нажмите **Run**. Миграция добавляет:

- поля профиля `bio`, `neighborhood`, `role` (для расширенного профиля и админ-панели);
- поля события `address` и `moderation_status` (модерация сигналов);
- таблицы `event_reactions`, `comments`, `event_reports`, `direct_messages` с RLS;
- RPC `toggle_reaction()`, `add_comment()`, `create_event_report()`, `admin_list_open_reports()`, `admin_set_event_status()`, `send_direct_message()`, `list_direct_messages()`, `set_event_address()`.

Миграция идемпотентна — повторный запуск безопасен.

**Для уже существующих проектов** (если модерация показывает «Модерация недоступна» или `column reference "id" is ambiguous`): выполните [`supabase/migrations/20260821_fix_admin_list_open_reports.sql`](../supabase/migrations/20260821_fix_admin_list_open_reports.sql) — он пересоздаёт RPC `admin_list_open_reports()` с корректными алиасами колонок.

## Авторизация: Email + Password + Turnstile

PULSE использует классическую связку **Email + Password** (без OTP и Magic Link).

1. **Authentication → Providers → Email**: включите Email provider, разрешите регистрацию и **отключите Confirm email** (иначе после регистрации не будет создаваться сессия).
2. **Authentication → URL Configuration**: задайте Site URL и Redirect URL продакшена. Не используйте URL GitHub repository как redirect.
3. **Authentication → Bot and Abuse Protection**: включите **Cloudflare Turnstile** и вставьте **Secret Key** (сам key остаётся только здесь). Публичный site key передаётся фронтенду через `VITE_TURNSTILE_SITE_KEY` и отправляется в Supabase через `options.captchaToken` при `signInWithPassword()` / `signUp()`.

Поток авторизации:

1. Пользователь вводит email (и имя при регистрации) + пароль, проходит Turnstile.
2. `signInWithPassword()` / `signUp()` создаёт сессию.
3. `onAuthStateChange` / `getSession` обновляют React Auth Context.
4. `hydrateUser` загружает профиль из `public.profiles`.
5. Триггер `handle_new_user` автоматически создаёт профиль для нового пользователя.

## Роли и админ-панель

Поле `profiles.role` принимает значения `user` / `admin` (по умолчанию `user`). Чтобы открыть модерацию, назначьте роль вручную в **Table Editor** → `profiles` → строка нужного пользователя → `role = admin`. После этого в профиле появится кнопка «Открыть модерацию», где админ видит открытые жалобы (`event_reports`) и может скрыть / удалить / вернуть сигнал через `admin_set_event_status()`.

## Архитектура доступа

- **Гость** — без Supabase session: смотрит карту, ищет города, читает события.
- **Постоянный аккаунт** — Email + Password: публикует сигналы, ставит реакции, пишет комментарии и сообщения, заполняет профиль.
- Анонимные sign-in (`signInAnonymously`) в текущем UI не используются: публикация, реакции, комментарии и сообщения требуют постоянного аккаунта. RPC проверяют `auth.jwt() ->> 'is_anonymous'` и отклоняют анонимные сессии ошибкой `PERMANENT_ACCOUNT_REQUIRED`.

## Публикация сигналов и RLS

- Чтение `events` и `comments` — публичное (policy `using (true)`).
- Создание события — только через security-definer RPC `create_event()` (антиспам: максимум 5 событий за 10 минут; имя и аватар берутся из `profiles`, а не от браузера).
- Реакции и комментарии — только через RPC `toggle_reaction()` / `add_comment()` (реакции 10/5 мин не лимитированы, комментарии — максимум 10 за 5 минут).
- Жалобы и сообщения — только через соответствующие RPC. RLS-политики для прямого клиентского доступа к `event_reactions` (чтение своих), `comments` (чтение) настроены; остальное закрыто.

## Realtime

`public.events` добавлена в публикацию `supabase_realtime`. При любом изменении событий клиенты перезагружают список. Проверить публикацию можно в **Database → Publications → supabase_realtime**.

## Проверка

```bash
bun run typecheck
bun run build
```

Перед push: `git diff --check`. Не коммитьте `.env.local`, service-role key, Turnstile Secret Key и пользовательские данные.
