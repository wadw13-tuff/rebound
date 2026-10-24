import { describe, expect, it } from "vitest";
import {
  addDays,
  type AdjustmentInput,
  type CheckIn,
  type Exercise,
  type Performance,
  type TrainingSession,
} from "./domain";
import { ADJUSTMENT_REASON, adjustPlan } from "./engine";
import { exercises as approvedExercises } from "./library";

const TODAY = "2026-10-05"; // Monday

const exercises: Exercise[] = [
  {
    id: "squat",
    name: "Back squat",
    pattern: "squat",
    loadedAreas: ["knee", "hips"],
    equipment: ["gym"],
    swapIds: ["hinge-safe", "squat-bad-equipment", "squat-unsafe"],
    increment: 2.5,
    defaultWeight: 100,
  },
  {
    id: "hinge-safe",
    name: "Hip hinge",
    pattern: "hinge",
    loadedAreas: ["hips"],
    equipment: ["dumbbells"],
    swapIds: [],
    increment: 2.5,
    defaultWeight: 30,
  },
  {
    id: "squat-bad-equipment",
    name: "Machine hinge",
    pattern: "hinge",
    loadedAreas: ["hips"],
    equipment: ["gym"],
    swapIds: [],
    increment: 5,
    defaultWeight: 40,
  },
  {
    id: "squat-unsafe",
    name: "Knee lunge",
    pattern: "lunge",
    loadedAreas: ["knee"],
    equipment: ["dumbbells"],
    swapIds: [],
    increment: 2.5,
    defaultWeight: 20,
  },
  {
    id: "bench",
    name: "Bench press",
    pattern: "push",
    loadedAreas: ["chest", "shoulder"],
    equipment: ["gym"],
    swapIds: ["row"],
    increment: 2.5,
    defaultWeight: 100,
  },
  {
    id: "row",
    name: "Cable row",
    pattern: "pull",
    loadedAreas: ["back"],
    equipment: ["gym", "dumbbells"],
    swapIds: [],
    increment: 2.5,
    defaultWeight: 70,
  },
  {
    id: "plank",
    name: "Plank",
    pattern: "core",
    loadedAreas: ["core"],
    equipment: ["bodyweight"],
    swapIds: [],
    increment: 0,
    defaultWeight: 0,
  },
];

function session(
  id: string,
  date: string,
  exerciseId = "bench",
  overrides: Partial<TrainingSession> = {},
): TrainingSession {
  return {
    id,
    date,
    title: id,
    week: 1,
    status: "planned",
    exercises: [
      {
        exerciseId,
        sets: 5,
        reps: 8,
        weight: exerciseId === "plank" ? 0 : 100,
        targetRpe: 8,
      },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return {
    today: TODAY,
    sessions: [session("next", TODAY)],
    library: exercises,
    checkIns: [],
    blockedDates: [],
    pausedAreas: [],
    equipment: "gym",
    events: [],
    ...overrides,
  };
}

function checkIn(
  sessionId: string,
  date: string,
  energy: number,
  pain: CheckIn["pain"] = "none",
  area?: string,
  symptoms: string[] = [],
): CheckIn {
  return { sessionId, date, energy, pain, area, symptoms };
}

function performance(
  sessionId: string,
  date: string,
  exerciseId = "bench",
  weight = 100,
  overrides: Partial<Performance> = {},
): Performance {
  return {
    sessionId,
    date,
    exerciseId,
    prescribedReps: 8,
    prescribedSets: 2,
    targetRpe: 8,
    logs: [
      { exerciseId, setIndex: 1, weight, reps: 8, status: "done", rpe: 8 },
      { exerciseId, setIndex: 2, weight, reps: 9, status: "done", rpe: 7 },
    ],
    ...overrides,
  };
}

function byId(
  result: ReturnType<typeof adjustPlan>,
  id: string,
): TrainingSession {
  const found = result.sessions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing test session ${id}`);
  return found;
}

function trainingStreakIsSafe(sessions: TrainingSession[]): boolean {
  const occupied = new Set(
    sessions.filter((s) => s.status !== "skipped").map((s) => s.date),
  );
  for (const date of occupied) {
    let run = 1;
    for (
      let next = addDays(date, 1);
      occupied.has(next);
      next = addDays(next, 1)
    )
      run += 1;
    if (run > 3) return false;
  }
  return true;
}

describe("adjustPlan – immutable result and structured changes", () => {
  it("does not mutate input, including nested prescriptions, and emits only fixed change fields", () => {
    const source = input({
      sessions: [session("missed", "2026-10-04")],
      events: [{ type: "missed", sessionIds: ["missed"] }],
    });
    const original = structuredClone(source);

    const result = adjustPlan(source);

    expect(source).toEqual(original);
    expect(result.sessions).not.toBe(source.sessions);
    expect(result.sessions[0]).not.toBe(source.sessions[0]);
    expect(result.sessions[0].exercises[0]).not.toBe(
      source.sessions[0].exercises[0],
    );
    for (const change of result.changes) {
      expect(Object.keys(change).sort()).toEqual([
        "affected_sessions",
        "after",
        "before",
        "reason_code",
        "type",
      ]);
    }
  });
});

describe("missed sessions", () => {
  it("moves one newly missed session to the next free allowed day and preserves its load", () => {
    const missed = session("missed", "2026-10-04", "bench");
    const result = adjustPlan(
      input({
        sessions: [
          missed,
          session("fixed-today", TODAY, "row", { status: "done" }),
          session("occupied-tomorrow", "2026-10-06", "row"),
          session("occupied", "2026-10-08", "row"),
        ],
        blockedDates: ["2026-10-07"],
        events: [{ type: "missed", sessionIds: ["missed"] }],
      }),
    );

    const moved = byId(result, "missed");
    expect(moved).toMatchObject({ date: "2026-10-09", status: "moved" });
    expect(moved.exercises).toEqual(missed.exercises);
    expect(result.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.MISSED_SESSION_MOVED,
    );
  });

  it("uses cumulative skipped sessions in a calendar week, restarts the remaining week at 80%, and keeps weights", () => {
    const result = adjustPlan(
      input({
        sessions: [
          session("already-skipped", "2026-10-05", "bench", {
            status: "skipped",
          }),
          session("newly-skipped", "2026-10-06", "row"),
          {
            ...session("remaining", "2026-10-07", "bench"),
            exercises: [
              {
                exerciseId: "bench",
                sets: 5,
                reps: 8,
                weight: 100,
                targetRpe: 8,
              },
              {
                exerciseId: "row",
                sets: 1,
                reps: 10,
                weight: 70,
                targetRpe: 8,
              },
            ],
          },
        ],
        events: [{ type: "missed", sessionIds: ["newly-skipped"] }],
      }),
    );

    expect(byId(result, "newly-skipped")).toMatchObject({
      status: "moved",
      restart: true,
      missed: true,
    });
    expect(byId(result, "remaining")).toMatchObject({ restart: true });
    expect(byId(result, "remaining").exercises).toMatchObject([
      { sets: 4, weight: 100 },
      { sets: 1, weight: 70 },
    ]);
    expect(result.changes.map((change) => change.reason_code)).toContain(
      ADJUSTMENT_REASON.MISSED_WEEK_RESTART,
    );
  });

  it("restarts after two misses in an event by reusing the original session IDs as moved restart sessions", () => {
    const result = adjustPlan(
      input({
        sessions: [session("a", TODAY), session("b", "2026-10-06")],
        events: [{ type: "missed", sessionIds: ["a", "b"] }],
      }),
    );

    expect(result.sessions).toHaveLength(2);
    expect(byId(result, "a")).toMatchObject({
      id: "a",
      date: TODAY,
      status: "moved",
      restart: true,
      missed: true,
    });
    expect(byId(result, "b")).toMatchObject({
      id: "b",
      date: "2026-10-06",
      status: "moved",
      restart: true,
      missed: true,
    });
    expect(byId(result, "a").exercises[0]).toMatchObject({
      sets: 4,
      weight: 100,
    });
    expect(byId(result, "b").exercises[0]).toMatchObject({
      sets: 4,
      weight: 100,
    });
  });

  it("counts a prior moved single miss toward a later miss in the same original calendar week", () => {
    const first = adjustPlan(
      input({
        sessions: [session("first", TODAY), session("second", "2026-10-06")],
        events: [{ type: "missed", sessionIds: ["first"] }],
      }),
    );
    expect(byId(first, "first")).toMatchObject({
      status: "moved",
      missed: true,
      missedWeek: TODAY,
    });

    const second = adjustPlan(
      input({
        sessions: first.sessions,
        events: [{ type: "missed", sessionIds: ["second"] }],
      }),
    );
    expect(byId(second, "first")).toMatchObject({
      restart: true,
      exercises: [{ sets: 4 }],
    });
    expect(byId(second, "second")).toMatchObject({
      status: "moved",
      restart: true,
      missed: true,
    });
    expect(second.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.MISSED_WEEK_RESTART,
    );
  });

  it("does not reprocess or compound an already restarted missed week", () => {
    const firstInput = input({
      sessions: [
        session("a", TODAY),
        session("b", "2026-10-06"),
        session("remaining", "2026-10-07"),
      ],
      events: [{ type: "missed", sessionIds: ["a", "b"] }],
    });
    const once = adjustPlan(firstInput);
    const twice = adjustPlan({ ...firstInput, sessions: once.sessions });

    expect(twice.sessions).toEqual(once.sessions);
    expect(twice.changes).toEqual([]);
    expect(byId(twice, "remaining").exercises[0].sets).toBe(4);
  });
});

describe("resume and energy reductions", () => {
  it("does nothing below a seven-day gap, reduces working weight by 15% at 7–13 days, and leaves sets unchanged", () => {
    const belowThreshold = adjustPlan(
      input({
        events: [
          {
            type: "resume",
            lastCompletedDate: "2026-09-29",
            lastWorkingWeights: { bench: 120 },
          },
        ],
      }),
    );
    expect(byId(belowThreshold, "next").exercises[0]).toMatchObject({
      sets: 5,
      weight: 100,
    });
    expect(belowThreshold.changes).toEqual([]);

    const atSevenDays = adjustPlan(
      input({
        events: [
          {
            type: "resume",
            lastCompletedDate: "2026-09-28",
            lastWorkingWeights: { bench: 120 },
          },
        ],
      }),
    );
    expect(byId(atSevenDays, "next").exercises[0]).toMatchObject({
      sets: 5,
      weight: 102,
    });
    expect(atSevenDays.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.RESUME_WEIGHT_REDUCED,
    );

    const atThirteenDays = adjustPlan(
      input({
        events: [
          {
            type: "resume",
            lastCompletedDate: "2026-09-22",
            lastWorkingWeights: { bench: 100 },
          },
        ],
      }),
    );
    expect(byId(atThirteenDays, "next").exercises[0]).toMatchObject({
      sets: 5,
      weight: 85,
    });
  });

  it("applies 70% weights and volume with restart flag at a fourteen-day gap", () => {
    const result = adjustPlan(
      input({
        events: [
          {
            type: "resume",
            lastCompletedDate: "2026-09-21",
            lastWorkingWeights: { bench: 120 },
          },
        ],
      }),
    );

    expect(byId(result, "next")).toMatchObject({ restart: true });
    expect(byId(result, "next").exercises[0]).toMatchObject({
      sets: 4,
      weight: 84,
    });
    expect(result.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.RESUME_RESTART,
    );
  });

  it("requires the two most-recent check-ins to be low energy before reducing the next workout by 20%", () => {
    const result = adjustPlan(
      input({
        checkIns: [checkIn("done-1", "2026-10-03", 2)],
        sessions: [session("next", TODAY, "bench")],
        events: [
          { type: "checkin", checkIn: checkIn("done-2", "2026-10-04", 1) },
        ],
      }),
    );
    expect(byId(result, "next").exercises[0]).toMatchObject({
      sets: 4,
      weight: 100,
    });
    expect(result.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.LOW_ENERGY_VOLUME_REDUCED,
    );

    const interrupted = adjustPlan(
      input({
        checkIns: [
          checkIn("low", "2026-10-02", 1),
          checkIn("normal", "2026-10-03", 3),
        ],
        events: [
          { type: "checkin", checkIn: checkIn("new-low", "2026-10-04", 1) },
        ],
      }),
    );
    expect(byId(interrupted, "next").exercises[0].sets).toBe(5);
    expect(interrupted.changes).toEqual([]);
  });

  it("uses the minimum simultaneous volume factor instead of compounding reductions", () => {
    const result = adjustPlan(
      input({
        checkIns: [checkIn("previous-low", "2026-10-03", 1)],
        sessions: [session("next", "2026-10-06")],
        events: [
          {
            type: "resume",
            lastCompletedDate: "2026-09-21",
            lastWorkingWeights: { bench: 100 },
          },
          { type: "checkin", checkIn: checkIn("current-low", "2026-10-04", 2) },
        ],
      }),
    );

    // 5 × min(70%, 80%) rounds to 4; compounding would round to 3.
    expect(byId(result, "next").exercises[0]).toMatchObject({
      sets: 4,
      weight: 70,
    });
    expect(byId(result, "next").restart).toBe(true);
  });
});

describe("safety and mild pain", () => {
  it("safety takes precedence: sharp pain pauses its area and removes affected upcoming prescriptions without swaps", () => {
    const result = adjustPlan(
      input({
        equipment: "dumbbells",
        sessions: [
          {
            ...session("upcoming", TODAY, "squat"),
            exercises: [
              {
                exerciseId: "squat",
                sets: 5,
                reps: 8,
                weight: 100,
                targetRpe: 8,
              },
              {
                exerciseId: "row",
                sets: 4,
                reps: 10,
                weight: 70,
                targetRpe: 8,
              },
            ],
          },
          session("already-done", "2026-10-04", "squat", { status: "done" }),
        ],
        events: [
          {
            type: "checkin",
            checkIn: checkIn("upcoming", TODAY, 3, "mild", "knee"),
          },
          {
            type: "checkin",
            checkIn: checkIn("upcoming", TODAY, 3, "sharp", "knee"),
          },
        ],
      }),
    );

    expect(result.pausedAreas).toContain("knee");
    expect(byId(result, "upcoming").exercises.map((p) => p.exerciseId)).toEqual(
      ["row"],
    );
    expect(
      byId(result, "already-done").exercises.map((p) => p.exerciseId),
    ).toEqual(["squat"]);
    expect(result.changes.map((change) => change.reason_code)).toEqual([
      ADJUSTMENT_REASON.SAFETY_AREA_PAUSED,
    ]);
  });

  it.each([
    ["numbness", ["numbness in hand"], "knee"],
    ["chest pain", ["chest pain"], "shoulder"],
    ["dizziness", ["dizziness"], undefined],
    ["recent injury", ["recent injury"], "knee"],
    ["trauma", ["trauma"], "knee"],
  ])(
    "recognises %s as safety signal and uses all for systemic reports",
    (_name, symptoms, area) => {
      const result = adjustPlan(
        input({
          sessions: [
            {
              ...session("next", TODAY, "squat"),
              exercises: [
                {
                  exerciseId: "squat",
                  sets: 5,
                  reps: 8,
                  weight: 100,
                  targetRpe: 8,
                },
                {
                  exerciseId: "bench",
                  sets: 5,
                  reps: 8,
                  weight: 100,
                  targetRpe: 8,
                },
              ],
            },
          ],
          events: [
            {
              type: "checkin",
              checkIn: checkIn("signal", TODAY, 3, "none", area, symptoms),
            },
          ],
        }),
      );

      const isSystemic =
        symptoms[0] === "chest pain" ||
        symptoms[0] === "dizziness" ||
        area === undefined;
      expect(result.pausedAreas).toContain(isSystemic ? "all" : area);
      expect(byId(result, "next").exercises).toHaveLength(isSystemic ? 0 : 1);
    },
  );

  it("uses only explicit, compatible, non-loading swap IDs for mild pain", () => {
    const result = adjustPlan(
      input({
        equipment: "dumbbells",
        library: approvedExercises,
        sessions: [session("next", TODAY, "barbell-bent-over-row")],
        events: [
          {
            type: "checkin",
            checkIn: checkIn("next", TODAY, 3, "mild", "lower back"),
          },
        ],
      }),
    );

    expect(byId(result, "next").exercises[0]).toMatchObject({
      exerciseId: "dumbbell-one-arm-row",
      sets: 5,
      weight: 8,
    });
    expect(result.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.MILD_PAIN_EXERCISE_SWAPPED,
    );
  });

  it("removes an affected exercise with a structured change when no permitted mild-pain alternative exists", () => {
    const result = adjustPlan(
      input({
        equipment: "bodyweight",
        sessions: [session("next", TODAY, "squat")],
        events: [
          {
            type: "checkin",
            checkIn: checkIn("next", TODAY, 3, "mild", "knee"),
          },
        ],
      }),
    );

    expect(byId(result, "next").exercises).toEqual([]);
    expect(result.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.MILD_PAIN_EXERCISE_REMOVED,
    );
  });
});

describe("availability and explicit movement", () => {
  it("reschedules travel/sick conflicts without moving completed sessions, conflicts, or more than three consecutive training days", () => {
    const result = adjustPlan(
      input({
        sessions: [
          session("trip-a", "2026-10-05"),
          session("trip-b", "2026-10-06"),
          session("completed-fixed", "2026-10-07", "row", { status: "done" }),
          session("unblocked", "2026-10-09", "row"),
        ],
        events: [
          {
            type: "availability",
            kind: "trip",
            dates: ["2026-10-05", "2026-10-06", "2026-10-07"],
          },
        ],
      }),
    );

    expect(result.blockedDates).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(byId(result, "completed-fixed")).toMatchObject({
      date: "2026-10-07",
      status: "done",
    });
    expect(byId(result, "trip-a")).toMatchObject({
      date: "2026-10-08",
      status: "moved",
    });
    expect(byId(result, "trip-b")).toMatchObject({
      date: "2026-10-11",
      status: "moved",
    });
    expect(trainingStreakIsSafe(result.sessions)).toBe(true);
    const activeDates = result.sessions
      .filter((s) => s.status !== "skipped")
      .map((s) => s.date);
    expect(new Set(activeDates).size).toBe(activeDates.length);
  });

  it("finds a free day after more than forty consecutive blocked travel dates", () => {
    const dates = Array.from({ length: 41 }, (_, index) =>
      addDays(TODAY, index),
    );
    const result = adjustPlan(
      input({
        sessions: [session("blocked-workout", TODAY)],
        events: [{ type: "availability", kind: "sick", dates }],
      }),
    );

    expect(byId(result, "blocked-workout")).toMatchObject({
      date: addDays(TODAY, 41),
      status: "moved",
    });
  });

  it("throws clear errors for invalid, blocked, or conflicting explicit moves", () => {
    const common = {
      sessions: [
        session("to-move", TODAY),
        session("occupied", "2026-10-08", "row"),
      ],
    };
    expect(() =>
      adjustPlan(
        input({
          ...common,
          events: [{ type: "move", sessionId: "to-move", date: "2026-02-30" }],
        }),
      ),
    ).toThrow(/valid YYYY-MM-DD/i);
    expect(() =>
      adjustPlan(
        input({
          ...common,
          blockedDates: ["2026-10-09"],
          events: [{ type: "move", sessionId: "to-move", date: "2026-10-09" }],
        }),
      ),
    ).toThrow(/blocked/i);
    expect(() =>
      adjustPlan(
        input({
          ...common,
          events: [{ type: "move", sessionId: "to-move", date: "2026-10-08" }],
        }),
      ),
    ).toThrow(/already has session/i);
  });

  it("accepts a valid explicit move, preserves load, and marks the session moved", () => {
    const original = session("to-move", TODAY, "bench");
    const result = adjustPlan(
      input({
        sessions: [original],
        events: [{ type: "move", sessionId: "to-move", date: "2026-10-08" }],
      }),
    );

    expect(byId(result, "to-move")).toMatchObject({
      date: "2026-10-08",
      status: "moved",
      exercises: original.exercises,
    });
    expect(result.changes[0].reason_code).toBe(ADJUSTMENT_REASON.SESSION_MOVED);
  });
});

describe("progression", () => {
  it("progresses only the next upcoming prescription after the latest two qualifying same-weight performances", () => {
    const result = adjustPlan(
      input({
        sessions: [
          session("next", "2026-10-06"),
          session("later", "2026-10-08"),
        ],
        events: [
          {
            type: "progression",
            performances: [
              performance("old-invalid", "2026-09-20", "bench", 90, {
                logs: [],
              }),
              performance("done-1", "2026-09-28"),
              performance("done-2", "2026-10-03"),
            ],
          },
        ],
      }),
    );

    expect(byId(result, "next").exercises[0].weight).toBe(102.5);
    expect(byId(result, "later").exercises[0].weight).toBe(100);
    expect(result.changes[0].reason_code).toBe(
      ADJUSTMENT_REASON.PROGRESSION_APPLIED,
    );
  });

  it("does not progress skipped/incomplete, over-RPE, different-weight, bodyweight, or paused-area work", () => {
    const invalidCases: Array<{
      name: string;
      exerciseId?: string;
      performances: Performance[];
      paused?: string[];
    }> = [
      {
        name: "skipped set",
        performances: [
          performance("a", "2026-09-28"),
          performance("b", "2026-10-03", "bench", 100, {
            logs: [
              {
                exerciseId: "bench",
                setIndex: 1,
                weight: 100,
                reps: 8,
                status: "done",
                rpe: 8,
              },
              {
                exerciseId: "bench",
                setIndex: 2,
                weight: 100,
                reps: 8,
                status: "skipped",
                rpe: 8,
              },
            ],
          }),
        ],
      },
      {
        name: "above target RPE",
        performances: [
          performance("a", "2026-09-28"),
          performance("b", "2026-10-03", "bench", 100, {
            logs: [
              {
                exerciseId: "bench",
                setIndex: 1,
                weight: 100,
                reps: 8,
                status: "done",
                rpe: 9,
              },
              {
                exerciseId: "bench",
                setIndex: 2,
                weight: 100,
                reps: 8,
                status: "done",
                rpe: 8,
              },
            ],
          }),
        ],
      },
      {
        name: "different working weights",
        performances: [
          performance("a", "2026-09-28", "bench", 95),
          performance("b", "2026-10-03", "bench", 100),
        ],
      },
      {
        name: "bodyweight",
        exerciseId: "plank",
        performances: [
          performance("a", "2026-09-28", "plank", 0),
          performance("b", "2026-10-03", "plank", 0),
        ],
      },
      {
        name: "paused area",
        paused: ["chest"],
        performances: [
          performance("a", "2026-09-28"),
          performance("b", "2026-10-03"),
        ],
      },
    ];

    for (const invalid of invalidCases) {
      const exerciseId = invalid.exerciseId ?? "bench";
      const result = adjustPlan(
        input({
          pausedAreas: invalid.paused ?? [],
          sessions: [session("next", "2026-10-06", exerciseId)],
          events: [{ type: "progression", performances: invalid.performances }],
        }),
      );
      expect(byId(result, "next").exercises[0].weight, invalid.name).toBe(
        exerciseId === "plank" ? 0 : 100,
      );
      expect(result.changes, invalid.name).toEqual([]);
    }
  });
});
