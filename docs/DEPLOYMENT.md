# Deployment

Two environments, two Vercel projects, two Supabase projects.

| | `develop` | `main` |
|---|---|---|
| Role | staging / integration | a record of what is live |
| Vercel project | `bt-store-management-staging` | `bt-store-management` |
| Supabase project | the older project | the newer project |
| Tag | `v0.8.1-rc` (prerelease) | `v0.8.1` (release) |
| Deploy | automatic on push | manual dispatch |
| PRs | all feature work targets this | none |

## Day-to-day

1. Branch off `develop`, open a PR into `develop`. `ci.yml` runs lint,
   typecheck, and tests.
2. Squash-merge. The PR title becomes the commit subject and drives the
   version bump: `feat` → minor, `fix`/`chore`/anything else → patch, `!` or
   `BREAKING CHANGE:` → minor while we are on `0.x`.
3. `staging.yml` tags the merge (`v0.8.1-rc`), cuts a GitHub prerelease, and
   deploys to staging.

Every merge produces exactly one new version, so the minor climbs once per
`feat` merge. That is intentional: each rc maps 1:1 to a single merge.

## Promoting to production

Actions → **Production** → *Run workflow*. Leave `rc_tag` blank to ship the
newest rc, or type an older one (e.g. `v0.9.0-rc`) to ship that instead.

The workflow refuses to run if the tag does not exist, is not an rc, its
stable tag already exists, is already live, or is **not a descendant of `main`**
— you cannot ship backwards.
On success it deploys, tags the stable version (`v0.9.0-rc` → `v0.9.0`) with
release notes covering everything since the last production release, and
fast-forwards `main`.

A rollback is a re-deploy of an earlier stable release, not a promotion.

## Migrations

Manual in both environments, by choice. CI never touches either database.
Apply new files in `supabase/migrations/` in numeric order via `supabase db push`
or the SQL editor — to staging when you merge, to production before you promote.

## Repo settings

- Default branch: `develop`.
- Ruleset on `main`: block direct pushes, **with a bypass for GitHub Actions**
  so `production.yml` can move the pointer.
- Ruleset on `develop`: require the `checks` job from `ci.yml`.

## Secrets

GitHub Environments `staging` and `production` hold the same six names with
different values: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

## One-time production bootstrap

The new Supabase project starts empty:

1. Apply all migrations in `supabase/migrations/` in numeric order.
2. Create the `product-images` storage bucket and its policies
   (`0022_product_images.sql`).
3. Run `node scripts/seed-owner.mjs` against it.
4. Move over any data worth keeping from the old project (now staging).
5. Put the new project's URL and keys in the `production` environment; the old
   project's in `staging`.
6. Repoint local `.env.local` at the staging project.
