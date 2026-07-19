# Bakers Theory — Next.js

A mobile-first bakery management **PWA**: inventory (with expiry batches),
billing, thermal receipts, a customer directory, an analytics dashboard, and
Excel report export. Built on **Next.js 14 (App Router) + TypeScript + Tailwind
+ Zustand**, backed by **Supabase** (Postgres, Auth, RLS, RPCs, and Storage).

## Documentation

The detail lives in [`docs/`](docs/) — start there:

- **[Onboarding](docs/ONBOARDING.md)** — clone → running → confidently making
  changes, including Supabase setup, environment variables, and login. **Start here.**
- **[Architecture](docs/ARCHITECTURE.md)** — how each subsystem is built and,
  more importantly, *why*.
- **[Database schema reference](docs/supabase-schema-plan.md)** — every table,
  view, and RPC, plus the privacy model, merged from the SQL in
  `supabase/migrations/`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

The app needs a Supabase project and an `.env.local` before it will run — see
[Onboarding](docs/ONBOARDING.md) for the full setup (schema, env vars, seeding
the Owner, and login).

Other scripts:

```bash
npm run build && npm start   # production
npm test                     # Vitest logic-layer suite
npm run typecheck
npm run lint
```
