# Настройка Supabase для PULSE

## Точная 2-шаговая инструкция для SQL Editor

**Шаг 1.** В панели Supabase откройте нужный проект, перейдите в **SQL Editor → New query**, вставьте содержимое файла [`supabase/schema.sql`](../supabase/schema.sql) целиком и нажмите **Run**. Скрипт идемпотентен для повторного запуска: он создаёт или обновляет таблицы `profiles` и `events`, индексы PostGIS, RLS-политики, триггер профиля, RPC `create_event()` с ограничением 5 событий за 10 минут и добавляет `events` в публикацию `supabase_realtime`.

**Шаг 2.** После успешного выполнения откройте **Table Editor** и убедитесь, что существуют `profiles` и `events`, а в **Database → Publications → supabase_realtime** присутствует таблица `events`. Если SQL Editor показывает ошибку, исправьте её до сообщения об успешном выполнении и только затем переходите к настройке авторизации.

## Настройка Email OTP

В **Authentication → Providers → Email** включите Email provider и разрешите регистрацию пользователей, если PULSE должен принимать новые аккаунты. Для текущего production PULSE в **Authentication → URL Configuration** задан Site URL `https://orskiyghost-png.github.io/Russia-s-Website` и добавлен такой же Redirect URL. Не используйте URL GitHub repository (`github.com/...`) как redirect. В **Authentication → Emails → Magic link or OTP** письмо должно содержать `{{ .Token }}`, поскольку PULSE использует одноразовый **6-значный код**, а не переход по Magic Link. Панель Supabase показывает, что редактирование текста шаблона доступно после настройки custom SMTP; до этого отправляются default templates. Поэтому при необходимости гарантировать отображение кода подключите SMTP/Resend и сохраните `{{ .Token }}` в шаблоне.

На стороне фронтенда используются `VITE_SUPABASE_URL` из **Project Settings → API → Project URL** и `VITE_SUPABASE_ANON_KEY` из **Project Settings → API → Publishable/anon key**. Service-role key нельзя помещать в браузер или в переменные `VITE_`.

PULSE вызывает `signInWithOtp()` для отправки кода и `verifyOtp({ email, token, type: 'email' })` для подтверждения. Если пользователь откроет старую ссылку с `token_hash`, AuthProvider дополнительно обработает её через `verifyOtp({ token_hash, type: 'email' })`, очистит query string и не оставит пользователя на мёртвом callback URL. После первого входа имя передаётся в metadata, а триггер `handle_new_user` создаёт профиль. Добавление событий выполняется через `create_event()`, а изменения `events` приходят через Supabase Realtime.

### О предупреждении `public.spatial_ref_sys`

PostGIS создаёт `public.spatial_ref_sys` как служебную таблицу расширения. В проекте PULSE она не используется фронтендом. Supabase владеет этой managed-таблицей, поэтому попытка выполнить `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY` возвращает `must be owner of table`. Это предупреждение Security Advisor относится к инфраструктурной таблице расширения, а не к данным PULSE; на таблицах приложения (`profiles` и `events`) RLS включён.
