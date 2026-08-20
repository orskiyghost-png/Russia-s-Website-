# Настройка Supabase для PULSE

## Шаг 1. Применить SQL-схему

В панели Supabase откройте **SQL Editor → New query**, вставьте весь файл [`supabase/schema.sql`](../supabase/schema.sql) и нажмите **Run**. Скрипт создаёт `profiles` и `events`, включает RLS, добавляет триггер профиля, RPC `create_event()` с лимитом 5 событий за 10 минут, PostGIS-координаты и подключение `events` к `supabase_realtime`.

## Шаг 2. Включить Email OTP и задать URL

Откройте **Authentication → Providers → Email**, включите Email provider и сохраните настройки. В **Authentication → URL Configuration** укажите Site URL и Redirect URLs для preview/production-доменов приложения. На стороне фронтенда задайте `VITE_SUPABASE_URL` из **Project Settings → API → Project URL** и `VITE_SUPABASE_ANON_KEY` из **Project Settings → API → Publishable/anon key**. Service-role key нельзя помещать в браузер или в переменные `VITE_`.

PULSE использует `signInWithOtp`: пользователь вводит email, получает одноразовую ссылку, а Supabase восстанавливает сессию после перехода по ссылке. При первом входе имя передаётся в metadata и сохраняется триггером `handle_new_user`. Публикация событий идёт через `create_event()`, а новые события синхронизируются через Supabase Realtime.
