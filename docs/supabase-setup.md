# Настройка Supabase для PULSE

## Точная 2-шаговая инструкция для SQL Editor

**Шаг 1.** В панели Supabase откройте нужный проект, перейдите в **SQL Editor → New query**, вставьте содержимое файла [`supabase/schema.sql`](../supabase/schema.sql) целиком и нажмите **Run**. Скрипт идемпотентен для повторного запуска: он создаёт или обновляет таблицы `profiles` и `events`, индексы PostGIS, RLS-политики, триггер профиля, RPC `create_event()` с ограничением 5 событий за 10 минут и добавляет `events` в публикацию `supabase_realtime`.

**Шаг 2.** После успешного выполнения откройте **Table Editor** и убедитесь, что существуют `profiles` и `events`, а в **Database → Publications → supabase_realtime** присутствует таблица `events`. Если SQL Editor показывает ошибку, исправьте её до сообщения об успешном выполнении и только затем переходите к настройке авторизации.

## Настройка Email OTP

В **Authentication → Providers → Email** включите Email provider и разрешите регистрацию пользователей, если PULSE должен принимать новые аккаунты. Для текущего production PULSE в **Authentication → URL Configuration** задан Site URL `https://orskiyghost-png.github.io/Russia-s-Website-/` и добавлен такой же Redirect URL. Не используйте URL GitHub repository (`github.com/...`) как redirect. В **Authentication → Emails → Magic link or OTP** письмо должно содержать `{{ .Token }}`, поскольку PULSE использует одноразовый **6-значный код**, а не переход по Magic Link. Панель Supabase показывает, что редактирование текста шаблона доступно после настройки custom SMTP; до этого отправляются default templates. Поэтому при необходимости гарантировать отображение кода подключите SMTP/Resend и сохраните `{{ .Token }}` в шаблоне.

На стороне фронтенда используются `VITE_SUPABASE_URL` из **Project Settings → API → Project URL** и `VITE_SUPABASE_ANON_KEY` из **Project Settings → API → Publishable/anon key**. Service-role key нельзя помещать в браузер или в переменные `VITE_`.

PULSE вызывает `signInWithOtp()` для отправки кода и `verifyOtp({ email, token, type: 'email' })` для подтверждения. Если пользователь откроет старую ссылку с `token_hash`, AuthProvider дополнительно обработает её через `verifyOtp({ token_hash, type: 'email' })`, очистит query string и не оставит пользователя на мёртвом callback URL. После первого входа имя передаётся в metadata, а триггер `handle_new_user` создаёт профиль. Добавление событий выполняется через `create_event()`, а изменения `events` приходят через Supabase Realtime.

### О предупреждении `public.spatial_ref_sys`

PostGIS создаёт `public.spatial_ref_sys` как служебную таблицу расширения. В проекте PULSE она не используется фронтендом. Supabase владеет этой managed-таблицей, поэтому попытка выполнить `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY` возвращает `must be owner of table`. Это предупреждение Security Advisor относится к инфраструктурной таблице расширения, а не к данным PULSE; на таблицах приложения (`profiles` и `events`) RLS включён.


## Архитектура доступа PULSE

PULSE использует три уровня доступа. **Guest** не имеет Supabase session и может полностью смотреть карту, искать города, двигать карту, использовать zoom/geolocation и читать события. **Anonymous session** создаётся через `supabase.auth.signInAnonymously()` и является временной сессией на этом устройстве; она не считается постоянным аккаунтом и не обещает восстановление на другом устройстве. **Permanent account** создаётся через Google OAuth или Email OTP.

Google OAuth является первым визуальным действием в auth-модалке. В Supabase нужно включить Google provider и указать Client ID и Client Secret из Google Cloud Console. В Google Cloud OAuth client добавьте callback URL Supabase, который показывается в карточке Google provider. В Supabase Authentication → URL Configuration сохраните production URL `https://orskiyghost-png.github.io/Russia-s-Website-/`. Frontend передаёт этот URL через `redirectTo`, используя `import.meta.env.BASE_URL`, поэтому OAuth не должен возвращать пользователя в корень GitHub Pages или в repository URL.

Email OTP остаётся резервным способом входа: email → 6 цифр → `verifyOtp()`. При серверном rate limit интерфейс сообщает, что отправка писем временно недоступна, и предлагает Google. Frontend guard защищает от повторных кликов, но не снимает серверную квоту Supabase.

Для production рекомендуется Custom SMTP. SMTP credentials нельзя хранить в репозитории, в `.env` фронтенда или в `VITE_` переменных. Без Custom SMTP встроенный provider проекта может ограничивать отправку auth-писем примерно двумя письмами в час, а увеличение лимита в панели Supabase недоступно.

## Anonymous RLS и публикация сигналов

Anonymous users используют PostgreSQL role `authenticated`, поэтому одной проверки роли недостаточно. Функция `public.create_event()` дополнительно проверяет `auth.jwt() ->> 'is_anonymous'` и отклоняет anonymous session с ошибкой `PERMANENT_ACCOUNT_REQUIRED`. Публичное чтение `events` сохраняется. Постоянный сигнал может создать только permanent account с профилем.

После включения anonymous sign-ins в панели Supabase примените миграцию `supabase/migrations/20260820_anonymous_access.sql` в SQL Editor. Она идемпотентно обновляет только RPC `create_event()` и не заменяет таблицы, RLS или Realtime.


## UX и linking после auth-аудита

Anonymous session не рекламируется отдельным основным способом входа. Пользователь видит только Google, Email OTP и продолжение без аккаунта. Anonymous может быть создан технически через `signInAnonymously()` в сценариях, которым нужен authenticated JWT, но пользователь не должен выбирать между Guest и Anonymous.

Если уже существующая anonymous session выбирает Google, AuthContext использует `supabase.auth.linkIdentity({ provider: 'google' })`, чтобы сохранить тот же user ID и не создавать второй независимый аккаунт. Для обычного Guest без session используется `signInWithOAuth()`.

Полный аудит текущей схемы показал, что в базе есть только `profiles`, `events` и RPC `create_event()`: policies для `profiles` ограничены owner, `events` публично доступны только на чтение, прямой insert policy отсутствует, а persistent create проходит только через security-definer RPC. Anonymous claim дополнительно проверяется в RPC; новых notification/admin policies в текущем проекте нет.
