# PULSE — живой радар города

PULSE — гиперлокальная карта городских сигналов: коммунальные события, городской вайб, стрит-культура и соседский бартер.

## Уже реализовано

- Полноэкранная интерактивная Leaflet-карта с OpenStreetMap tiles.
- Перемещение, zoom, popups, кастомные pulse-маркеры и клики по карте.
- Поиск городов через Nominatim с плавным перелётом карты.
- Browser Geolocation API.
- Supabase Auth: email/password, подтверждение email, session refresh и logout.
- Supabase Postgres: общие события для всех пользователей.
- Supabase Realtime: новые события синхронизируются между открытыми клиентами.
- Database-side anti-spam: максимум 5 событий за 10 минут на пользователя.
- RLS: чтение событий публичное, создание только через защищённый RPC.
- Framer Motion spring-анимации, skeleton loading, glass UI и responsive layout.
- Radix Dialog для доступных модальных окон.

## Stack

- Vite + React 19 + TypeScript
- Leaflet + react-leaflet + OpenStreetMap
- Nominatim geocoding
- Supabase Auth / Postgres / Realtime / PostGIS
- Framer Motion + Radix Dialog + Lucide React
- Freebuff Preview / Deploy

## Supabase за 3 шага

Полная инструкция: [`docs/supabase-setup.md`](docs/supabase-setup.md).

1. Создайте Supabase project и добавьте в Freebuff Settings → Environment:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Выполните `supabase/schema.sql` в Supabase SQL Editor.
3. Включите **Authentication → Providers → Email → Confirm email** и настройте Site URL / Redirect URLs.

Service-role key не нужен фронтенду и не должен добавляться в `VITE_` переменные.

До добавления ключей preview остаётся доступным в read-only режиме с seed-картой. Авторизация и публикация событий активируются автоматически после добавления Supabase env vars.

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
