import { strict as assert } from "node:assert";
import { db } from "../lib/db";
import type { AppState } from "../lib/domain";
const origin = process.env.SMOKE_ORIGIN || "http://localhost:3000";
const today = "2026-10-23";
let cookie = "";
let token = "";
const extraTokens: string[] = [];
async function request(
  body?: unknown,
  otherIdentity = false,
): Promise<AppState> {
  const response = await fetch(
    `${origin}/api/state${body ? "" : `?today=${today}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(cookie && !otherIdentity ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!cookie) {
    cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
    token = cookie.split("=")[1] || "";
  } else if (otherIdentity) {
    const other = response.headers
      .get("set-cookie")
      ?.split(";")[0]
      ?.split("=")[1];
    if (other) extraTokens.push(other);
  }
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
async function action(body: Record<string, unknown>) {
  return request({ ...body, today });
}
async function main() {
  try {
    console.log("Smoke: anonymous identity and example state");
    assert.equal((await request()).demo, true);
    console.log("Smoke: four-step setup API and four-week program");
    let state = await action({
      action: "onboard",
      name: "Smoke test",
      goal: "muscle",
      days: 3,
      equipment: "gym",
      experience: "intermediate",
      limitations: [],
      disclaimerAccepted: true,
    });
    assert.equal(state.demo, false);
    assert.equal(state.sessions.length, 12);
    const first = state.sessions.find((s) => s.date === today)!;
    assert(first);
    console.log("Smoke: prepare, log every set, finish check-in");
    state = await action({ action: "resume", sessionId: first.id });
    for (const p of first.exercises)
      for (let index = 0; index < p.sets; index++)
        state = await action({
          action: "log",
          sessionId: first.id,
          entry: {
            exerciseId: p.exerciseId,
            setIndex: index,
            weight: p.weight,
            reps: p.reps,
            rpe: p.targetRpe,
            status: "done",
          },
        });
    state = await action({
      action: "finish",
      sessionId: first.id,
      energy: 4,
      pain: "none",
      symptoms: [],
    });
    assert.equal(state.sessions.find((s) => s.id === first.id)?.status, "done");
    assert.equal(state.checkIns.length, 1);
    const duplicate = await action({
      action: "finish",
      sessionId: first.id,
      energy: 4,
      pain: "none",
      symptoms: [],
    });
    assert.equal(duplicate.checkIns.length, 1);
    console.log(
      "Smoke: two independent missed sessions persist as 80% restart",
    );
    const missed = state.sessions.filter((s) => s.week === 2).slice(0, 2);
    const setsBefore = new Map(
      state.sessions.map((s) => [
        s.id,
        s.exercises.map((p) => ({ sets: p.sets, weight: p.weight })),
      ]),
    );
    state = await action({ action: "miss", sessionIds: [missed[0].id] });
    state = await action({ action: "miss", sessionIds: [missed[1].id] });
    const change = state.changes.find(
      (c) => c.reason_code === "multiple_missed",
    );
    assert(change);
    assert.match(change.explanation!, /80%/);
    for (const id of change.affected_sessions) {
      const s = state.sessions.find((s) => s.id === id)!;
      const before = setsBefore.get(id)!;
      s.exercises.forEach((p, i) => {
        assert.equal(p.sets, Math.max(1, Math.round(before[i].sets * 0.8)));
        assert.equal(p.weight, before[i].weight);
      });
    }
    console.log(
      "Smoke: overlapping trip dates relocate sessions and stay blocked",
    );
    const trip = state.sessions.find(
      (s) => s.status !== "done" && s.date > today,
    )!;
    state = await action({
      action: "availability",
      start: trip.date,
      end: trip.date,
      kind: "trip",
    });
    assert(state.profile?.blockedDates.includes(trip.date));
    assert(
      !state.sessions.some(
        (s) =>
          (s.status === "planned" || s.status === "moved") &&
          s.date === trip.date,
      ),
    );
    console.log("Smoke: sharp pain pauses area with no swap/workaround");
    const target = state.sessions.find(
      (s) => s.status === "planned" || s.status === "moved",
    )!;
    state = await action({
      action: "safety",
      energy: 2,
      pain: "sharp",
      area: "shoulder",
      symptoms: [],
    });
    assert.notEqual(
      state.sessions.find((s) => s.id === target.id)?.status,
      "done",
    );
    assert(state.profile?.pausedAreas.includes("shoulder"));
    const safety = state.changes.find(
      (c) => c.reason_code === "SAFETY_AREA_PAUSED",
    );
    assert(safety);
    assert.match(safety.explanation!, /clinician/);
    for (const s of state.sessions.filter(
      (s) => s.status === "planned" || s.status === "moved",
    ))
      for (const p of s.exercises)
        assert(
          !state.library
            .find((e) => e.id === p.exerciseId)
            ?.loadedAreas.includes("shoulder"),
        );
    console.log(
      "Smoke: clinician-reviewed pause clearance is explicit and restores conservative work",
    );
    state = await action({
      action: "clear-pause",
      area: "shoulder",
      clinicianReviewed: true,
    });
    assert(!state.profile?.pausedAreas.includes("shoulder"));
    assert(
      state.changes.some((c) => c.reason_code === "CLINICIAN_REVIEW_RESTART"),
    );
    console.log("Smoke: second browser cannot see personal program");
    const other = await request(undefined, true);
    assert.equal(other.demo, true);
    assert.notEqual(other.name, "Smoke test");
    console.log(
      "PASS: onboarding, first workout, persistence, 80% restart, trip, safety, identity isolation",
    );
  } finally {
    await db.user.deleteMany({
      where: { token: { in: [token, ...extraTokens].filter(Boolean) } },
    });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
