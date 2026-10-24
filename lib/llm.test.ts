import { describe, it, expect, vi } from "vitest";
import {
  chooseSwap,
  explainChange,
  fallbackExplanation,
  safeJson,
  REFERRAL,
} from "./llm";
import type { Exercise, PlanChange } from "./domain";
const e: Exercise = {
  id: "a",
  name: "A",
  pattern: "pull",
  loadedAreas: ["shoulder"],
  equipment: ["gym"],
  swapIds: ["b"],
  increment: 2.5,
  defaultWeight: 10,
};
const b = { ...e, id: "b", loadedAreas: ["elbow"] };
const change: PlanChange = {
  type: "volume",
  reason_code: "week_restart",
  affected_sessions: ["1"],
  before: {},
  after: {},
};
describe("narrow Claude safety and fallback", () => {
  it("works without API connectivity", async () => {
    expect(
      await explainChange(change, async () => {
        throw Error();
      }),
    ).toContain("80%");
  });
  it("never lets JSON failure interrupt planning", () => {
    expect(() => safeJson("```json {} ```")).toThrow();
  });
  it("rejects blame and forbidden word", async () => {
    expect(
      await explainChange(change, async () => ({
        sentence: "You failed your week.",
      })),
    ).toBe(fallbackExplanation(change));
  });
  it("rejects changed quantities", async () => {
    expect(
      await explainChange(change, async () => ({
        sentence: "We moved to 50% volume.",
      })),
    ).toBe(fallbackExplanation(change));
  });
  it("accepts a safe sentence", async () => {
    expect(
      await explainChange(change, async () => ({
        sentence:
          "We kept the weights and eased your week to 80% of your usual sets.",
      })),
    ).toContain("80%");
  });
  it("rejects invented exercise and retries exactly once", async () => {
    const mock = vi.fn().mockResolvedValue({ exercise_id: "invented" });
    expect(await chooseSwap(e, [b], mock)).toBe("b");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("uses valid retry ID", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ exercise_id: "wrong" })
      .mockResolvedValueOnce({ exercise_id: "b" });
    expect(await chooseSwap(e, [b], mock)).toBe("b");
  });
  it("falls back when API errors", async () => {
    expect(
      await chooseSwap(e, [b], async () => {
        throw Error();
      }),
    ).toBe("b");
  });
  it("cannot provide workaround on sharp pain", async () => {
    const mock = vi.fn();
    expect(
      await explainChange({ ...change, reason_code: "sharp_pain" }, mock),
    ).toBe(REFERRAL);
    expect(mock).not.toHaveBeenCalled();
  });
});
