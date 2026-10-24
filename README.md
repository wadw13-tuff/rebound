# Rebound

**Your strength-training plan moves with you.** Rebound is a mobile-first Next.js MVP for beginner-to-intermediate lifters whose schedules change. It generates a four-week plan, records sets and check-ins, then adapts upcoming workouts using a pure deterministic engine. Claude is optional and has no control over training quantities or safety decisions.

## Run locally

Requires Node.js 22 and pnpm 11.25.0. Install pnpm with `npm install -g pnpm@11.25.0`, then run:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# For local plain-HTTP development, set COOKIE_SECURE=false in .env.
pnpm setup
pnpm dev
```

Open `http://localhost:3000`. In HTTPS Manus Preview, keep `COOKIE_SECURE=true` (the supplied sandbox configuration). No Anthropic key is needed. The initial dashboard is explicitly an example plan, not real user activity. Select **Make it yours**, complete the four steps, then log the workout scheduled for today. Default prescriptions are pre-filled, so the first set needs one tap after setup.

```bash
pnpm test          # Unit and regression tests
pnpm typecheck    # Strict TypeScript check
pnpm build        # Production compilation and route generation
pnpm start        # Run the compiled app; PORT defaults to 3000
pnpm exec tsx scripts/smoke.ts # Reproducible end-to-end API test; requires running server
```

The smoke script creates isolated temporary browser identities and removes only those identities afterward. Do not run it against real production data without an isolated test environment. For reproducible smoke dates the script uses 2026-10-23; it does not alter your browser profile.

## Architecture

The App Router serves the dashboard and six secondary screens. `GET /api/state?today=YYYY-MM-DD` returns the cookie user’s active program and detects overdue workouts. `POST /api/state` validates a discriminated action payload with Zod, scopes the selected session to the current user, and serializes writes per user. The service invokes the engine, validates any Claude-chosen exercise ID, and persists sessions, check-ins, pauses, blocked dates, and explanations transactionally.

Prisma uses SQLite for local development. Library rows are seeded idempotently; no fake users or history are seeded. A fresh anonymous browser gets a cryptographically random HttpOnly identity cookie. Personal data is never selected using a client-supplied user ID. Sign-in and cross-device recovery are deliberately outside this MVP assumption.

The adjustment engine owns missed-session relocation, 80% restart volume, 85% return weights, 70% long-gap restart, low-energy volume changes, approved mild-pain swaps, persistent safety pauses, travel/sick relocation, and RPE-based progression. It is pure and immutable. Structured changes always have `type`, `reason_code`, `affected_sessions`, `before`, and `after`. Original miss-week markers survive relocation and refresh. Persisted volume baselines use the most conservative factor, rather than accidentally compounding simultaneous or sequential reductions on the same upcoming workout.

Claude is called **only** to rewrite an approved explanation as JSON or choose an ID from a filtered explicit swap whitelist. Malformed JSON, forbidden tone, altered numeric claims, unknown IDs, timeout, missing key, and API errors fall back safely. Invalid swaps retry once; after two rejected attempts, the first rule-based match is used. Safety referrals and no-approved-swap notices use fixed copy and never call Claude.

## File structure

```text
app/
  layout.tsx                 Metadata and application-owned PWA link
  page.tsx                   Today dashboard
  [screen]/page.tsx          Schedule/history/program/workout/check-in/onboarding/billing
  globals.css                Responsive brand and application styles
  api/state/route.ts         Validated identity-scoped API
  api/health/route.ts         Container health endpoint
  api/billing/*                Checkout, portal and billing summary
  api/lemonsqueezy/webhook     Signed Lemon Squeezy event fulfillment
components/
  ReboundApp.tsx             Shell, home, schedule, onboarding, program
  TrainingViews.tsx          Set logging, rest timer, check-in, lift history chart
  SafetyNotice.tsx           Persistent pause and clinician-reviewed return
  BillingView.tsx             Hosted checkout, entitlement and receipt history
  ThemeToggle.tsx             System/light/dark preference control
  training.css              Training-screen styles
  ui.tsx                    Shared view contracts and primitives
lib/
  domain.ts                  TypeScript domain contracts and calendar helpers
  library.ts                 44 tagged standard exercises and approved swaps
  templates.ts               Three starter templates; 2–5-day adaptations
  engine.ts                  Pure deterministic adjustment rules
  service.ts                 Persistence and event orchestration
  llm.ts                     Narrow Claude JSON adapter and fallbacks
  db.ts                      Prisma lifecycle and anonymous identity
  validation.ts              Strict action and date validation
  *.test.ts                  Rule, template, LLM, regression coverage
prisma/
  schema.prisma              Relational data model
  seed.ts                    Exercise-library upserts
scripts/smoke.ts              End-to-end API test
public/                      Icons, local fonts, manifest, service worker, photo
Dockerfile                   Self-hosted production container
plan.md / TODO.md            Implementation decisions and outcome tracking
SOURCES.md                   API documentation and asset provenance
```

## Environment variables

`DATABASE_URL` must be a PostgreSQL connection string from Neon, Supabase, or another hosted PostgreSQL provider. `ANTHROPIC_API_KEY` is optional and server-only. `ANTHROPIC_MODEL` defaults to `claude-haiku-4-5-20251001` and may be changed to an available Claude model. `ANTHROPIC_VERSION` defaults to the documented legacy `2023-06-01` Messages API version. `ANTHROPIC_WORKSPACE_ID` is optional for non-workspace-scoped keys. `COOKIE_SECURE=true` uses Secure/HttpOnly/SameSite=None for public HTTPS Preview; `false` uses non-Secure/SameSite=Lax only for plain-HTTP local development. `PORT` controls the production listener, not the fixed development port. Never expose the Anthropic key through a `NEXT_PUBLIC_` variable.

Lemon Squeezy runs on the **Next.js server**, not in the browser. The adapter calls the Lemon Squeezy API to create a hosted checkout for a store variant and verifies the raw webhook body with the `X-Signature` HMAC at `app/api/lemonsqueezy/webhook`. Configure `LEMONSQUEEZY_API_KEY`, numeric `LEMONSQUEEZY_STORE_ID`, numeric `LEMONSQUEEZY_VARIANT_ID`, and a 6–40 character `LEMONSQUEEZY_WEBHOOK_SECRET`. `APP_URL` is an optional public production fallback for Checkout return URLs. Lemon Squeezy handles the hosted payment form; never commit the API key or webhook secret.

The Claude integration is implemented and covered by injected-response tests, but a paid live-provider call was not run because no Anthropic key was provided.

## Screens and behavior

Four-step onboarding collects goal, 2–5 training days, equipment, experience, optional current limitations, name, and the one-time not-medical-advice acknowledgement. Plans use the 2-day minimal, 3-day full-body, or 4-day upper/lower library; 5-day users receive the upper/lower adaptation with an accessory day. The first workout is today.

Home shows the week, today’s workout, upcoming sessions, momentum, and a friendly change card. Schedule supports HTML drag-to-move, a touch/keyboard-friendly date dialog, trip and sick ranges, and **Can’t make it**. No move can occupy a blocked day, share a day, or create more than three consecutive training days. Unavailable workouts are shifted even if that extends beyond the original four-week horizon; historical completions never move. Billing adds an optional Rebound Plus subscription, hosted Lemon Squeezy Checkout, a provider customer portal link, durable entitlement state, webhook deduplication, and a minimal payment history screen. Checkout opens in a new tab; returning to `/billing` is not treated as proof of payment until the signed webhook is processed.

Workout saves each done/skipped set independently with weight, reps, and RPE. The 90-second timer can pause, reset, or add 30 seconds. Check-ins collect energy, pain, optional area and safety symptoms. History charts the actual maximum completed set weight by lift and shows recorded sessions. The example plan and example history remain clearly labeled and are never written as personal training data.

Sharp pain, numbness, recent injury/trauma, chest pain or dizziness trigger fixed clinician-referral messaging and a persistent area pause. Systemic symptoms or no specified area pause all training. Standalone safety check-ins do not mark an unrelated/future workout complete. A separate **Manage safety pause** flow requires the user’s explicit confirmation of clinician guidance before rebuilding a conservative 70%-of-starting-prescription return. Other pauses and limitations remain. This is self-attestation, not clinical verification. Rebound does not offer workarounds, diagnoses, or medication guidance.

## Assumptions and material limitations

This is a single-device, anonymous-user MVP rather than an authenticated commercial health service. Each browser is isolated; losing its cookie loses access to that identity. Weights are in kilograms. Client local calendar dates determine schedules; timezone/calendar helpers use date-only values rather than UTC midnights. The engine does not claim to automatically observe unreported illness or travel: those are user-marked. Overdue detection occurs on state refresh, with no unattended cron service required. Theme preference is saved locally immediately and, after onboarding, in the profile as `system`, `light`, or `dark`; the browser system preference is used by default.

Sets round to the nearest integer with a minimum of one, so an 80% reduction of two sets still rounds to two. Return weights retain two decimal places to preserve the specified percentages; equipment plate rounding is a follow-up. RPE targets are conservative (6 for beginners and 7 for intermediate starters). Bodyweight exercises do not receive load increases. The initial loads are modest template defaults, not individualized medical prescriptions. Core holds currently share the reps logger; explicit seconds/reps units are a next step.

The PWA is installable on supported HTTPS browsers. Its service worker caches the application shell and static assets; a local last-saved state and workout drafts tolerate temporary connectivity loss. **Offline-to-the-LLM works fully. Completely offline-to-the-server saving is not supported:** API responses are never cached, and failed mutations require retry after reconnection. No false ‘saved’ message is shown.

PostgreSQL is required for this Vercel-ready export. A production rollout must still use durable storage and real authentication, not rely on the anonymous cookie alone.

## Production and Postgres next steps

For a self-hosted evaluation, provide `DATABASE_URL` from a PostgreSQL provider before starting the container:

```bash
docker build -t rebound .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://...' \
  -e COOKIE_SECURE=true rebound
# Use true behind a correctly configured public HTTPS reverse proxy.
```

The Prisma datasource already targets `postgresql`; set a hosted `DATABASE_URL`, run `pnpm db:push` once against that database, and run `pnpm db:seed` if you want the exercise library seeded. Serialized prescription/change fields are plain strings and therefore portable, although native JSON columns would be preferable later. The data model should be migrated, not discarded; back up existing records before changing providers.

Prioritize durable Postgres, authenticated account recovery, CSRF/origin checks and rate limits, encrypted/retention-managed health data, and clinician review of all exercise tags and swaps before public use. Add equipment-specific load rounding, measurement units for time-based exercises, richer program continuation after week four, a true offline mutation queue with conflict handling, and automated browser/accessibility tests. Lock down the supported Next.js version and review current security advisories before deployment. This MVP intentionally excludes wearables, social features, nutrition, video form analysis, and native mobile apps. Payments are limited to the single optional Rebound Plus subscription; marketplace billing, taxes, invoices, refunds, and multi-seat plans remain out of scope.
