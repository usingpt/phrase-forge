# Phrase Forge

Phrase Forge is a flashcard web app for learning idioms and phrases with nuance-focused cards.

## What Changed

- Cards and language pairs can now be synced on the web with Supabase.
- Google sign-in is handled through Supabase Auth.
- OpenAI generation is moved to a Vercel Function, so the API key is no longer stored in the browser.
- Local mode still works when Supabase or Vercel environment variables are not configured yet.

## Architecture

- Frontend: static app in `src/`
- Card storage: Supabase table `public.user_workspaces`
- Auth: Supabase Auth with Google
- AI generation: `api/generate.js`
- Public runtime config: `api/config.js`
- Supabase SQL setup: `supabase/schema.sql`

## Required Vercel Environment Variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, default: `gpt-4.1-mini`)

## Supabase Setup

1. Create a Supabase project.
2. Enable Google login in Supabase Auth.
3. Add your app URL to the allowed redirect URLs in Supabase Auth.
4. Run the SQL in [supabase/schema.sql](./supabase/schema.sql).
5. Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` into Vercel environment variables.

## Vercel Setup

1. Add the environment variables listed above.
2. Redeploy the project after saving them.
3. Open the deployed app and sign in with Google.

## Local Development

- Opening `index.html` through a simple static server still works.
- Without `/api/config`, the app falls back to local-only mode.
- Shared OpenAI generation and web sync only work on Vercel after environment variables are configured.
