import { describe, expect, it } from "vitest";
import { adjustPlan } from "./engine";
import { exercises } from "./library";
import { fallbackExplanation } from "./llm";
import type { AdjustmentInput, TrainingSession } from "./domain";
const p = {
  exerciseId: "barbell-bench-press",
  sets: 5,
  reps: 8,
  weight: 20,
  targetRpe: 8,
};
const s = (id: string, date: string): TrainingSession => ({
  id,
  date,
  title: id,
  week: 1,
  status: "planned",
  exercises: [{ ...p }],
});
const base = (
  sessions: TrainingSession[],
  today = "2026-10-05",
): AdjustmentInput => ({
  sessions,
  today,
  library: exercises,
  checkIns: [],
  blockedDates: [],
  pausedAreas: [],
  equipment: "gym",
  events: [],
});
describe("persisted trigger regressions", () => {
  it("does not compound an 80% volume restart with a later 70% return", () => {
    const first = adjustPlan({
      ...base([
        s("a", "2026-10-01"),
        s("b", "2026-10-02"),
        s("c", "2026-10-05"),
      ]),
      events: [{ type: "missed", sessionIds: ["a", "b"] }],
    });
    const second = adjustPlan({
      ...base(first.sessions),
      events: [{ type: "resume", lastCompletedDate: "2026-09-10" }],
    });
    expect(
      second.sessions.find(
        (s) => s.id === second.changes[0].affected_sessions[0],
      )!.exercises[0].sets,
    ).toBe(4);
  });
  it("reschedules a previously moved missed session when it becomes overdue", () => {
    const moved = {
      ...s("a", "2026-10-01"),
      status: "moved" as const,
      missed: true,
      missedWeek: "2026-09-28",
    };
    const result = adjustPlan({
      ...base([moved]),
      events: [{ type: "missed", sessionIds: ["a"] }],
    });
    expect(result.sessions[0].date).toBe("2026-10-05");
  });
  it("detects a new miss on a travel-moved session", () => {
    const moved = { ...s("a", "2026-10-01"), status: "moved" as const };
    expect(
      adjustPlan({
        ...base([moved]),
        events: [{ type: "missed", sessionIds: ["a"] }],
      }).sessions[0].missed,
    ).toBe(true);
  });
  it("moves a future can’t-make-it session forward rather than back to today", () => {
    const result = adjustPlan({
      ...base([s("a", "2026-10-08")]),
      events: [{ type: "missed", sessionIds: ["a"] }],
    });
    expect(result.sessions[0].date).toBe("2026-10-09");
  });
  it("progresses from actual working weight instead of an old template load", () => {
    const performances = ["done1", "done2"].map((id, i) => ({
      sessionId: id,
      date: `2026-10-0${i + 1}`,
      exerciseId: p.exerciseId,
      prescribedReps: 8,
      prescribedSets: 1,
      targetRpe: 8,
      logs: [
        {
          exerciseId: p.exerciseId,
          setIndex: 0,
          weight: 40,
          reps: 8,
          status: "done" as const,
          rpe: 7,
        },
      ],
    }));
    const result = adjustPlan({
      ...base([s("next", "2026-10-05")]),
      events: [{ type: "progression", performances }],
    });
    expect(result.sessions[0].exercises[0].weight).toBe(42.5);
  });
  it.each([
    ["RESUME_WEIGHT_REDUCED", "85%"],
    ["RESUME_RESTART", "70%"],
    ["multiple_missed", "80%"],
    ["MILD_PAIN_EXERCISE_REMOVED", "no approved substitute"],
    ["AVAILABILITY_DATES_BLOCKED", "time away"],
  ])("maps %s to an accurate offline explanation", (reason, text) => {
    expect(
      fallbackExplanation({
        type: "x",
        reason_code: reason,
        affected_sessions: [],
        before: null,
        after: null,
      }),
    ).toContain(text);
  });
});
