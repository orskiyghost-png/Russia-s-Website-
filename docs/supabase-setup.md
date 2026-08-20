# Supabase setup for PULSE

## 1. Create the project

Create a free Supabase project, then open **Project Settings → API** and copy:

- `Project URL` → `VITE_SUPABASE_URL`
- `anon public` key → `VITE_SUPABASE_ANON_KEY`

Add both keys in Freebuff **Settings → Environment**. Do not put the service-role key in the browser or in `VITE_` variables.

## 2. Create the database

Open **SQL Editor**, paste and run [`supabase/schema.sql`](../supabase/schema.sql). It creates:

- `profiles` linked to `auth.users`
- public realtime `events`
- RLS policies
- email-profile trigger
- `create_event()` RPC with a server-side limit of 5 events per user per 10 minutes
- PostGIS coordinates and a spatial index

## 3. Turn on email verification

In **Authentication → Providers → Email**:

- enable Email provider;
- keep **Confirm email** enabled;
- configure the Site URL and Redirect URLs for the Freebuff preview and production domain.

The app uses Supabase password auth with confirmation links. Registration succeeds only after the user follows the email link. Realtime event updates appear for every connected user after the SQL migration has enabled the `events` table in `supabase_realtime`.
