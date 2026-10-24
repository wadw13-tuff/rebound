# Rebound validation

The pure adjustment engine, template library, Claude fallback adapter and persisted-trigger regressions have **51 passing Vitest tests** across four files. `pnpm typecheck` succeeds under strict TypeScript. Next.js production compilation, type checking and route generation have completed successfully for all seven application screens and both APIs.

Coverage includes every requested deterministic rule, thresholds at 7/13/14 days, cumulative moved-session miss history, idempotent weekly restart, persisted minimum-volume factors, overlapping availability, long blocked-date ranges, one-session-per-day and three-consecutive-day limits, approved swaps, no-approved-swap removal, safety precedence and systemic pauses, and RPE/rep/weight progression edges. Claude tests cover malformed JSON, missing connectivity, forbidden tone, altered numeric claims, whitelist rejection/retry and fixed sharp-pain referrals.

A read-only implementation review traced the screens through validation, service orchestration, engine and Prisma persistence. Confirmed issues were corrected: miss-week markers now persist, completion and check-in writes are atomic, standalone acute-symptom reports cannot falsely complete future sessions, and explicit clinician-reviewed pause management enables a conservative return without silently clearing other pauses. Workout preparation no longer cancels its own result during state refresh or React Strict Mode. Substitute load selection remains deterministic and never exceeds the selected movement’s starter load.

The end-to-end API smoke test is included as `scripts/smoke.ts`. It creates only isolated temporary identities and removes only those records. It checks example-state isolation, onboarding, a complete logged workout and duplicate completion, two independent missed sessions and the exact 80% restart, overlapping trip relocation, sharp-pain area filtering, explicit reviewed pause clearance, and isolation from a second browser. Its latest execution result is recorded below after running against the delivered server.

Live Anthropic billing/provider access was not tested because no API key was supplied. Claude response handling is tested using injected transports. Manual onboarding timing and a formal accessibility/browser regression suite have not been measured; the UI uses four steps, pre-filled sets, responsive layouts and keyboard/touch move alternatives to support the requested quick first-workout flow. This is a local/Preview MVP, not a clinically validated or hardened public health product.

## Final API execution

`pnpm exec tsx scripts/smoke.ts` completed successfully against the compiled Next.js server on 2026-10-23. The final output was:

```text
Smoke: anonymous identity and example state
Smoke: four-step setup API and four-week program
Smoke: prepare, log every set, finish check-in
Smoke: two independent missed sessions persist as 80% restart
Smoke: overlapping trip dates relocate sessions and stay blocked
Smoke: sharp pain pauses area with no swap/workaround
Smoke: clinician-reviewed pause clearance is explicit and restores conservative work
Smoke: second browser cannot see personal program
PASS: onboarding, first workout, persistence, 80% restart, trip, safety, identity isolation
```

All seven page routes, `/api/health`, the exact `/manus-routes.json`, the application manifest, icons and service worker returned HTTP 200 from the compiled server. No public publication was performed. Temporary smoke-test users and their related records were removed after execution.
