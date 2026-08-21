# PULSE — живой радар города

PULSE — гиперлокальная карта городских сигналов: коммунальные события, городской вайб, стрит-культура и соседский бартер.

## Уже реализовано

- Полноэкранная интерактивная Leaflet-карта с OpenStreetMap tiles, кластеризацией и pulse-маркерами.
- Перемещение, zoom, popups, клики по карте и создание сигнала в точке.
- Поиск городов через Nominatim с плавным перелётом карты и Browser Geolocation API.
- Supabase Auth: Email + Password, Cloudflare Turnstile, session refresh и logout.
- Расширенный профиль: имя, город, район, био, аватар (загрузка из галереи), уведомления.
- Supabase Postgres: общие события для всех пользователей.
- Реакции и комментарии с optimistic UI и синхронизацией с базой.
- Сообщения между пользователями (личная переписка с автором сигнала).
- Модерация: жалобы на сигналы и админ-панель (скрыть / удалить / вернуть).
- Database-side anti-spam: максимум 5 событий за 10 минут, 10 комментариев за 5 минут.
- RLS: чтение событий и комментариев публичное, запись только через защищённые RPC.
- Supabase Realtime: новые события и изменения синхронизируются между открытыми клиентами.
- Framer Motion spring-анимации, skeleton loading, glass UI и responsive layout.
- Radix Dialog для доступных модальных окон.

## Stack

- Vite + React 19 + TypeScript
- Leaflet + react-leaflet + OpenStreetMap
- Nominatim geocoding
- Supabase Auth / Postgres / Realtime / PostGIS
- Cloudflare Turnstile (CAPTCHA)
- Framer Motion + Radix Dialog + Lucide React
- Freebuff Preview / Deploy

## Supabase за 3 шага

Полная инструкция: [`docs/supabase-setup.md`](docs/supabase-setup.md).

1. Создайте Supabase project и добавьте в Freebuff Settings → Environment:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TURNSTILE_SITE_KEY`
2. Выполните в Supabase SQL Editor: `supabase/schema.sql`, затем `supabase/migrations/0001_social_features.sql`.
3. Настройте авторизацию: **Authentication → Providers → Email** (включить, разрешить регистрацию, отключить Confirm email), **URL Configuration** (Site URL / Redirect URL продакшена). **Bot and Abuse Protection** — опционально: включённая Turnstile-капча **блокирует вход**, если виджет недоступен в регионе пользователя (например, в РФ `challenges.cloudflare.com` не открывается). Если виджет не работает — оставьте защиту выключенной, антиспам уже есть в RPC-функциях.

Service-role key и Turnstile Secret Key не нужны фронтенду и не должны попадать в `VITE_` переменные.

До добавления ключей preview остаётся доступным в read-only режиме с seed-картой. Авторизация, публикация и социальные функции активируются автоматически после добавления Supabase env vars.

## Запуск и проверка

```bash
bun install
bun run dev
bun run typecheck
bun run build
```

Freebuff commands:

- install: `bun install`
- preview: `bun run dev` на порту `5173`
- build: `bun run build`

Перед деплоем:

```bash
freebuff-deploy check
```
