import { describe, expect, it } from "vitest";
import type { Profile } from "./domain";
import {
  canonicalAreas,
  exercises,
  approvedCandidates,
  findExercise,
} from "./library";
import { generateProgram } from "./templates";

const baseProfile: Profile = {
  goal: "fitness",
  days: 3,
  equipment: "gym",
  experience: "beginner",
  limitations: [],
  pausedAreas: [],
  blockedDates: [],
};

function dateGap(first: string, second: string): number {
  return Math.round(
    (Date.parse(`${second}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) /
      86_400_000,
  );
}

describe("approved exercise library", () => {
  it("has unique standard IDs, canonical loaded areas, and hierarchical equipment", () => {
    expect(exercises.length).toBeGreaterThanOrEqual(40);
    expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(
      exercises.length,
    );

    for (const exercise of exercises) {
      expect(exercise.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(
        exercise.loadedAreas.every((area) =>
          canonicalAreas.includes(area as never),
        ),
      ).toBe(true);
      expect(exercise.equipment).toContain("gym");
      if (exercise.equipment.includes("bodyweight")) {
        expect(exercise.equipment).toEqual(["gym", "dumbbells", "bodyweight"]);
      }
      if (
        exercise.equipment.includes("dumbbells") &&
        !exercise.equipment.includes("bodyweight")
      ) {
        expect(exercise.equipment).toEqual(["gym", "dumbbells"]);
      }
    }
  });

  it("only returns explicit, same-pattern swaps that avoid every excluded area", () => {
    for (const source of exercises) {
      for (const swapId of source.swapIds) {
        const target = findExercise(swapId);
        expect(target).toBeDefined();
        expect(target?.pattern).toBe(source.pattern);
      }

      for (const area of canonicalAreas) {
        const candidates = approvedCandidates(source.id, area, "gym", [
          "shoulder",
        ]);
        for (const candidate of candidates) {
          expect(source.swapIds).toContain(candidate.id);
          expect(candidate.pattern).toBe(source.pattern);
          expect(candidate.equipment).toContain("gym");
          expect(candidate.loadedAreas).not.toContain(area);
          expect(candidate.loadedAreas).not.toContain("shoulder");
        }
      }
    }
  });
});

describe("starter templates", () => {
  it.each([2, 3, 4, 5])(
    "creates four weeks with %i sessions per week and no more than three consecutive days",
    (days) => {
      const program = generateProgram(
        { ...baseProfile, days },
        "2026-10-23",
        `days-${days}`,
      );
      expect(program.sessions).toHaveLength(days * 4);
      expect(program.sessions[0].date).toBe("2026-10-23");

      for (let week = 1; week <= 4; week += 1) {
        const weekSessions = program.sessions.filter(
          (session) => session.week === week,
        );
        expect(weekSessions).toHaveLength(days);
        expect(new Set(weekSessions.map((session) => session.date)).size).toBe(
          days,
        );

        const sorted = [...weekSessions].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        let run = 1;
        for (let index = 1; index < sorted.length; index += 1) {
          run =
            dateGap(sorted[index - 1].date, sorted[index].date) === 1
              ? run + 1
              : 1;
          expect(run).toBeLessThanOrEqual(3);
        }
      }
    },
  );

  it("changes prescription volume for goal and experience while retaining conservative starting loads", () => {
    const beginnerFitness = generateProgram(
      { ...baseProfile, goal: "fitness", experience: "beginner" },
      "2026-10-23",
    ).sessions[0].exercises[0];
    const intermediateStrength = generateProgram(
      { ...baseProfile, goal: "strength", experience: "intermediate" },
      "2026-10-23",
    ).sessions[0].exercises[0];

    expect(beginnerFitness.sets).toBeLessThan(intermediateStrength.sets);
    expect(beginnerFitness.reps).not.toBe(intermediateStrength.reps);
    expect(beginnerFitness.weight).toBeLessThanOrEqual(
      intermediateStrength.weight,
    );
  });

  it("uses an approved replacement or omits a movement when limitations affect it", () => {
    const lowerBackLimited = generateProgram(
      { ...baseProfile, limitations: ["lower back"] },
      "2026-10-23",
    );
    for (const prescription of lowerBackLimited.sessions.flatMap(
      (session) => session.exercises,
    )) {
      const exercise = findExercise(prescription.exerciseId);
      expect(exercise?.loadedAreas).not.toContain("lower back");
    }

    const shoulderLimited = generateProgram(
      { ...baseProfile, limitations: ["shoulder"], pausedAreas: ["shoulder"] },
      "2026-10-23",
    );
    for (const prescription of shoulderLimited.sessions.flatMap(
      (session) => session.exercises,
    )) {
      const exercise = findExercise(prescription.exerciseId);
      expect(exercise?.loadedAreas).not.toContain("shoulder");
    }
  });
});
