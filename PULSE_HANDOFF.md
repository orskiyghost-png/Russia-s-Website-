# Технический handoff проекта PULSE для другой нейросети

Скопируй весь текст этого документа в новую нейросеть перед продолжением разработки. Документ описывает текущий продукт, архитектуру, backend, уже выполненные изменения, рабочие ограничения и правила безопасной дальнейшей работы.

---

## 1. Контекст и цель проекта

Ты принимаешь в работу веб-проект **PULSE** — гиперлокальную интерактивную карту городских сигналов в реальном времени. Приложение показывает, что происходит рядом с пользователем, и позволяет жителям добавлять собственные сигналы.

PULSE объединяет четыре смысловых слоя данных:

| Слой | Назначение |
|---|---|
| Город | Коммунальные события, отключения воды и света, ДТП, перекрытия и другие городские проблемы |
| Вайб | Микрособытия, локальные статусы, мемы, настроение районов и ИИ-патруль |
| Стрит | Спортплощадки, скейт-споты, граффити, стритвир-фотозоны и уличная культура |
| Бартер | Фудшеринг, соседская помощь, микроуслуги и обмен на районе |

Визуальная концепция — премиальный dark-first интерфейс в эстетике Linear/Vercel/Apple: тёмная палитра, glassmorphism, аккуратные границы, мягкие spring-анимации, выразительный lime-акцент и мобильный UX без лишних элементов.

---

## 2. Репозиторий и текущее состояние

GitHub-репозиторий проекта:

`orskiyghost-png/Russia-s-Website-`

Основная ветка — `main`. Последний опубликованный коммит:

`47419cf fix: repair mobile menu and auth modal alignment`

Предыдущий важный коммит:

`3bcca9c feat: connect PULSE to Supabase and refine mobile UX`

На момент handoff локальное рабочее дерево чистое и синхронизировано с `origin/main`.

Основные файлы:

| Файл | Назначение |
|---|---|
| `src/App.tsx` | Главный компонент приложения, layout, фильтры, панели, модальные окна и взаимодействия |
| `src/CityMap.tsx` | Leaflet-карта, маркеры, popups, геолокация и обработка кликов по карте |
| `src/auth.tsx` | React Auth Context, Supabase session, Email + Password, профиль и logout |
| `src/data.ts` | Конфигурация слоёв, загрузка событий, Realtime-подписка и RPC `create_event` |
| `src/lib/supabase.ts` | Создание Supabase client и проверка env-переменных |
| `src/theme.tsx` | Переключение светлой/тёмной темы |
| `src/index.css` | Глобальные стили, responsive layout, glass UI, mobile overrides и animation styles |
| `src/types.ts` | Типы `RadarEvent`, `AuthUser`, `EventKind`, `Layer` |
| `supabase/schema.sql` | Production SQL-схема таблиц, RLS, trigger, RPC и Realtime |
| `docs/supabase-setup.md` | Инструкция настройки Supabase, Email + Password и Turnstile |
| `.env.example` | Шаблон переменных окружения без секретов |

Стек из `package.json`:

- Vite.
- React 19.
- TypeScript.
- Leaflet 1.9 и `react-leaflet` 5.
- Supabase JS 2.
- Framer Motion.
- Radix Dialog.
- Lucide React.

Скрипты проекта:

```bash
bun install
bun run dev
bun run typecheck
bun run build
```

В sandbox, где проводилась последняя проверка, исполняемый файл `bun` отсутствовал, поэтому зависимости были установлены через `pnpm`, а проверки запускались эквивалентными командами `pnpm run typecheck` и `pnpm run build`. Обе проверки прошли успешно. В обычном проектном окружении следует использовать Bun, как указано в README.

---

## 3. Переменные окружения и Supabase

Приложение использует следующие frontend-переменные:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Фактический Supabase project URL настроен как:

`https://vavixbintoqoivnswdwe.supabase.co`

Реальные значения находятся локально в `.env.local`, который игнорируется Git и не должен коммититься. В репозитории опубликован только `.env.example`.

Service-role key не используется фронтендом и ни при каких обстоятельствах не должен попадать в `VITE_`-переменные или браузерный код.

Файл `src/lib/supabase.ts` работает так:

1. Читает `import.meta.env.VITE_SUPABASE_URL` и `import.meta.env.VITE_SUPABASE_ANON_KEY`.
2. Вычисляет `isSupabaseConfigured`.
3. Если ключи отсутствуют, создаёт placeholder client, но операции данных и авторизации блокируются guard-проверками.
4. Если ключи присутствуют, приложение работает с реальным Supabase.

В текущем проекте backend был применён в панели Supabase вручную. SQL был выполнен тремя компактными блоками из-за ограничения браузерного ввода длинного текста. Все три блока завершились сообщением `Success. No rows returned`.

После применения схемы REST endpoints обеих таблиц отвечали HTTP 200:

```text
profiles REST status: 200 response: []
events REST status: 200 response: []
```

Пустые массивы нормальны: таблицы созданы, но новых пользовательских данных пока нет.

---

## 4. Схема базы данных

`supabase/schema.sql` создаёт расширения:

```sql
create extension if not exists pgcrypto;
create extension if not exists postgis;
```

### Таблица `public.profiles`

Профиль пользователя связан с `auth.users` через `id`. Поля:

- `id uuid primary key references auth.users(id) on delete cascade`.
- `name text`, от 2 до 80 символов.
- `city text`, по умолчанию `Орск`.
- `avatar_url text`.
- `notifications boolean`, по умолчанию `true`.
- `created_at timestamptz`.

### Таблица `public.events`

Событие содержит:

- `id uuid`, автоматически создаётся через `gen_random_uuid()`.
- `kind`, только одно из значений: `city`, `vibe`, `street`, `help`.
- `category`.
- `title`, от 3 до 80 символов.
- `description`, от 3 до 500 символов.
- `lat` и `lng` с ограничениями географического диапазона.
- `location geography(point, 4326)`, generated column для PostGIS.
- `user_id`, внешний ключ на `auth.users`.
- `user_name` и `avatar_url`, сохранённые snapshot-поля автора.
- `reactions` и `comments`, неотрицательные integer-счётчики.
- `created_at`.

Созданы индексы:

```sql
create index if not exists events_location_idx
  on public.events using gist (location);

create index if not exists events_created_at_idx
  on public.events (created_at desc);
```

---

## 5. RLS и безопасность

RLS включён на `profiles` и `events`.

Для `profiles` разрешено:

- читать только собственный профиль через `auth.uid() = id`;
- обновлять только собственный профиль через `auth.uid() = id`.

Для `events` разрешено публичное чтение:

```sql
create policy "Events are public"
  on public.events for select using (true);
```

Прямой публичный insert в `events` не используется. Добавление события происходит только через security-definer RPC `public.create_event`, что не позволяет обойти антиспам-лимит обычным REST insert.

---

## 6. Авторизация Email + Password

Актуальная реализация использует классическую связку **Email + Password** с защитой Cloudflare Turnstile. OTP и Magic Link не используются.

В `src/auth.tsx` реализованы методы:

```ts
supabase.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined })
```

для входа и:

```ts
supabase.auth.signUp({
  email,
  password,
  options: { ...(captchaToken ? { captchaToken } : {}), data: { name } },
})
```

для регистрации.

Жизненный цикл авторизации:

1. Пользователь открывает форму входа или регистрации и вводит email (а при регистрации также имя) и пароль.
2. `signInWithPassword` / `signUp` создаёт сессию (в Supabase должен быть отключён Confirm email, иначе после регистрации сессия не создаётся).
3. `onAuthStateChange` и `getSession` обновляют React Auth Context.
4. `hydrateUser` загружает профиль из `public.profiles`.
5. После первого пользователя trigger `handle_new_user` автоматически создаёт профиль.

Turnstile: публичный site key передаётся через `VITE_TURNSTILE_SITE_KEY` и отправляется в Supabase через `options.captchaToken`. Secret Key хранится только в Supabase Dashboard (Bot and Abuse Protection). На клиенте капча не блокирует отправку: если виджет не выдал токен, сервер сам решает, принимать ли запрос.

---

## 7. Создание события и антиспам

Пользователь может создать сигнал:

- через кнопку `Создать сигнал`;
- через слой `Добавить метку`;
- кликом по карте.

Если пользователь не авторизован, открывается auth modal. Если авторизован, сохраняются координаты выбранной точки и открывается `ReportModal`.

`ReportModal` собирает:

- тип события;
- заголовок;
- описание;
- координаты.

В `src/data.ts` вызывается:

```ts
supabase.rpc('create_event', {
  p_kind: payload.kind,
  p_category: payload.category,
  p_title: payload.title,
  p_description: payload.description,
  p_lat: payload.lat,
  p_lng: payload.lng,
})
```

RPC проверяет:

- наличие авторизованного пользователя, иначе `AUTH_REQUIRED`;
- не более 5 событий этого пользователя за последние 10 минут, иначе `RATE_LIMIT`;
- минимальную длину заголовка и описания, иначе `INVALID_CONTENT`.

Имя и avatar автора берутся из `profiles`, а не принимаются напрямую от браузера.

---

## 8. Realtime-синхронизация

В `src/data.ts` функция `subscribeToEvents` создаёт канал:

```ts
supabase
  .channel('pulse-events')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'events' },
    onChange,
  )
  .subscribe()
```

При любом изменении `events` приложение повторно вызывает `fetchEvents()` и обновляет карту. При размонтировании компонента канал удаляется через `supabase.removeChannel(channel)`.

В SQL-схеме таблица `public.events` условно добавляется в публикацию `supabase_realtime` через `pg_publication_tables`, чтобы повторный запуск схемы был безопасным.

---

## 9. Карта и геоданные

`src/CityMap.tsx` использует:

- `MapContainer` из `react-leaflet`;
- CartoDB tiles на базе OpenStreetMap;
- `dark_all` для тёмной темы;
- `light_all` для светлой темы;
- кастомные `divIcon`-маркеры;
- popup с заголовком, автором и координатным местоположением;
- `MapClickCapture` для добавления сигнала на карту;
- `MapViewport` с плавным `flyTo`;
- `LocateMeButton` через Browser Geolocation API.

Поиск города выполняется в `App.tsx` через Nominatim:

```text
https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=...
```

После результата карта перелетает к найденным координатам. Необходимо соблюдать публичные правила использования Nominatim и не превращать поиск в высокочастотный bulk-запрос.

В CSS исправлен старый чрезмерный фильтр `.real-map .leaflet-tile-pane`, который делал тёмную карту плохо читаемой. Сейчас tile pane не затемняется глобальным `brightness/opacity` overlay. Верхнее наложение карты использует мягкую CSS mask вместо жёсткой тёмной области.

---

## 10. Интерфейс и UX

Главный экран содержит:

- фиксированный header с логотипом PULSE;
- поиск города/события;
- индикатор live;
- уведомления;
- переключатель темы;
- кнопку входа или user chip;
- мобильную кнопку меню;
- боковой список слоёв радара;
- карту;
- title block с городом и количеством сигналов;
- controls геолокации и возврата к Орску;
- PULSE AI panel;
- нижнюю ленту последних событий;
- кнопку создания сигнала;
- auth, report, profile, notification и AI модальные панели.

Слои радара визуально разделены отдельными карточками с gap, padding, rounded corners, мягким фоном и границами. Для кнопок добавлены `whileTap={{ scale: 0.97 }}` и CSS active-state.

Все input, textarea и select имеют размер шрифта не менее 16 px для устранения iOS Safari auto-zoom.

### Критическое исправление мобильного меню

Ранее боковая панель была обёрнута в `AnimatePresence`, но `motion.aside` всегда получал `{ x: 0, opacity: 1 }`. Из-за этого CSS-класс закрытого состояния не мог скрыть меню.

Актуальная логика:

```tsx
animate={{
  x: isMenuOpen ? 0 : '-125%',
  opacity: isMenuOpen ? 1 : 0,
}}
```

Также применяются spring-параметры:

```tsx
transition={{
  type: 'spring',
  damping: 25,
  stiffness: 200,
}}
```

Когда меню закрыто, оно уходит за левую границу и получает `aria-hidden`. На desktop добавлено отдельное CSS-правило, принудительно оставляющее rail видимым независимо от mobile drawer state.

### Критическое исправление auth modal

Внутри auth modal применены:

- `width: min(100%, 28rem)`;
- `max-width: 28rem`;
- `margin-inline: auto`;
- `box-sizing: border-box`;
- симметричные мобильные отступы;
- modal card шириной `calc(100vw - 24px)` на мобильных экранах;
- безопасные left/right границы.

Это устраняет горизонтальный сдвиг формы вправо и сохраняет центрирование на узких экранах.

---

## 11. Темы и стили

В проекте есть светлая и тёмная темы. CSS-переменные задаются в `.pulse-app` и переопределяются для `html[data-theme='light']`.

Основные визуальные параметры:

- базовый dark canvas около `#07090d`;
- акцентный lime около `#d8ff73`;
- glass background с alpha-прозрачностью;
- `backdrop-filter: blur(20px) saturate(...)`;
- мягкие borders вместо тяжёлых теней;
- responsive safe-area overrides через `env(safe-area-inset-*)`;
- `prefers-reduced-motion` для отключения лишней анимации.

Не добавляй глобальные чёрные overlay поверх карты и не возвращай сильный `brightness(.55)` к tile pane: это ломает читаемость CartoDB Dark Matter.

---

## 12. Проверки и текущий результат

Последняя проверка после исправления меню и auth modal:

```text
pnpm run typecheck — успешно
pnpm run build — успешно
 git diff --check — успешно
```

Production build создаётся корректно. Vite выдаёт только предупреждение о размере JavaScript chunk больше 500 kB, но это не ошибка сборки.

Последний UX-фикс опубликован в GitHub:

```text
47419cf fix: repair mobile menu and auth modal alignment
```

---

## 13. Известные ограничения и места для улучшения

1. Уведомления сейчас демонстрационные и не загружаются из отдельной таблицы.
2. Реакции и комментарии отображаются в модели события, но полноценная запись реакций/комментариев ещё не реализована.
3. PULSE AI пока является UI-панелью с локальным summary по событиям. Полноценный LLM backend ещё не подключён.
4. Поиск использует публичный Nominatim endpoint и не имеет собственного proxy/rate limiter.
5. Документация приведена к единой терминологии: авторизация — Email + Password с Turnstile, OTP и Magic Link не используются.
6. Trigger `handle_new_user` использует local-part email как fallback имени. При дальнейшем улучшении стоит гарантировать, что fallback всегда удовлетворяет check constraint имени от 2 символов.
7. Нужно отдельно проверить production preview визуально на реальном мобильном viewport после публикации.
8. Не коммить `.env.local`, service-role key, session tokens или пользовательские данные.

---

## 14. Правила дальнейшей разработки

Перед изменением кода сначала проверь существующую реализацию, чтобы не создать дублирующую логику. Для Supabase не обходи RLS через прямые клиентские insert-операции, если действие должно проходить через `create_event()`.

Для новых UI-компонентов сохраняй текущую визуальную систему: тёмная палитра, glass panels, отдельные карточки слоёв, симметричные отступы, 16 px inputs на мобильных, visible focus states, Lucide icons и Framer Motion только для transform/opacity.

После каждого существенного изменения выполни:

```bash
bun run typecheck
bun run build
```

Если Bun недоступен, используй эквивалентный package manager только для локальной проверки, но не добавляй сгенерированные lock/workspace-файлы в Git без необходимости.

Перед push проверь:

```bash
git diff --check
git status --short --branch
git log -1 --oneline
```

Не меняй Supabase production schema без явного понимания последствий. Повторный запуск текущего `schema.sql` рассчитан на идемпотентное применение, но destructive warnings панели Supabase всегда следует осмысливать перед подтверждением.

---

## 15. Короткая задача для следующей нейросети

> Продолжи разработку PULSE как Senior Full-Stack Engineer. Сначала прочитай этот handoff и проверь фактический код в репозитории. Не переписывай уже работающие Supabase Auth, RPC и Realtime без необходимости. Главные инварианты: Email + Password с Turnstile, события создаются только через `create_event()`, RLS включён, `public.events` синхронизируется через Realtime, карта Leaflet читаема в обеих темах, мобильное меню действительно закрывается, auth modal центрирован, все поля имеют минимум 16 px. Перед любым push выполни typecheck, production build и `git diff --check`.

---

## 16. Быстрый сценарий запуска

```bash
git clone https://github.com/orskiyghost-png/Russia-s-Website-.git
cd Russia-s-Website-
bun install
cp .env.example .env.local
# Заполни .env.local значениями Supabase
bun run dev
```

Проверка backend через REST выполняется по адресу:

```text
https://vavixbintoqoivnswdwe.supabase.co/rest/v1/events?select=id&limit=1
```

Для production deployment сначала проверь environment variables, затем выполни `bun run typecheck` и `bun run build`.
