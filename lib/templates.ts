import type {
  AppState,
  Exercise,
  Goal,
  Prescription,
  Profile,
  TrainingSession,
} from "./domain";
import { addDays } from "./domain";
import { approvedCandidates, exercises, findExercise } from "./library";

type StarterDay = {
  title: string;
  slots: string[][];
};

type StarterTemplate = {
  title: string;
  offsets: number[];
  days: StarterDay[];
};

// Each slot lists equipment-appropriate standard options in gym, dumbbell,
// bodyweight order. This selection is for initial equipment fit; limitations
// are handled afterwards and only through approved explicit swaps.
const starterTemplates: Record<number, StarterTemplate> = {
  2: {
    title: "2-day minimal",
    offsets: [0, 3],
    days: [
      {
        title: "Minimal full body A",
        slots: [
          [
            "barbell-back-squat",
            "dumbbell-goblet-squat",
            "bodyweight-split-squat",
          ],
          ["barbell-bench-press", "dumbbell-bench-press", "push-up"],
          ["barbell-bent-over-row", "dumbbell-one-arm-row", "inverted-row"],
          [
            "barbell-romanian-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          ["plank", "dead-bug"],
        ],
      },
      {
        title: "Minimal full body B",
        slots: [
          ["leg-press", "dumbbell-reverse-lunge", "bodyweight-split-squat"],
          ["barbell-overhead-press", "dumbbell-overhead-press", "pike-push-up"],
          ["lat-pulldown", "dumbbell-one-arm-row", "inverted-row"],
          [
            "barbell-hip-thrust",
            "dumbbell-glute-bridge",
            "bodyweight-glute-bridge",
          ],
          ["dead-bug", "bodyweight-crunch"],
        ],
      },
    ],
  },
  3: {
    title: "3-day full-body",
    offsets: [0, 2, 4],
    days: [
      {
        title: "Full body A",
        slots: [
          [
            "barbell-back-squat",
            "dumbbell-goblet-squat",
            "bodyweight-split-squat",
          ],
          ["barbell-bench-press", "dumbbell-bench-press", "push-up"],
          ["barbell-bent-over-row", "dumbbell-one-arm-row", "inverted-row"],
          [
            "barbell-romanian-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          ["plank", "dead-bug"],
        ],
      },
      {
        title: "Full body B",
        slots: [
          ["leg-press", "dumbbell-reverse-lunge", "bodyweight-split-squat"],
          ["barbell-overhead-press", "dumbbell-overhead-press", "pike-push-up"],
          ["lat-pulldown", "dumbbell-one-arm-row", "inverted-row"],
          [
            "barbell-hip-thrust",
            "dumbbell-glute-bridge",
            "bodyweight-glute-bridge",
          ],
          ["hanging-knee-raise", "bodyweight-crunch"],
        ],
      },
      {
        title: "Full body C",
        slots: [
          [
            "barbell-front-squat",
            "dumbbell-goblet-squat",
            "bodyweight-split-squat",
          ],
          ["machine-chest-press", "incline-dumbbell-bench-press", "push-up"],
          ["seated-cable-row", "dumbbell-one-arm-row", "inverted-row"],
          [
            "barbell-conventional-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          ["cable-pallof-press", "side-plank", "dead-bug"],
        ],
      },
    ],
  },
  4: {
    title: "4-day upper/lower",
    offsets: [0, 1, 3, 4],
    days: [
      {
        title: "Upper A",
        slots: [
          ["barbell-bench-press", "dumbbell-bench-press", "push-up"],
          ["barbell-bent-over-row", "dumbbell-one-arm-row", "inverted-row"],
          ["barbell-overhead-press", "dumbbell-overhead-press", "pike-push-up"],
          ["lat-pulldown", "dumbbell-one-arm-row", "inverted-row"],
          [
            "cable-triceps-pushdown",
            "dumbbell-overhead-triceps-extension",
            "push-up",
          ],
        ],
      },
      {
        title: "Lower A",
        slots: [
          [
            "barbell-back-squat",
            "dumbbell-goblet-squat",
            "bodyweight-split-squat",
          ],
          [
            "barbell-romanian-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          [
            "dumbbell-step-up",
            "dumbbell-reverse-lunge",
            "bodyweight-split-squat",
          ],
          ["lying-leg-curl", "bodyweight-standing-calf-raise"],
          ["plank", "dead-bug"],
        ],
      },
      {
        title: "Upper B",
        slots: [
          ["machine-chest-press", "incline-dumbbell-bench-press", "push-up"],
          ["chest-supported-row", "dumbbell-one-arm-row", "inverted-row"],
          ["machine-shoulder-press", "dumbbell-overhead-press", "pike-push-up"],
          ["pull-up"],
          ["cable-biceps-curl", "dumbbell-biceps-curl"],
        ],
      },
      {
        title: "Lower B",
        slots: [
          ["leg-press", "dumbbell-goblet-squat", "bodyweight-split-squat"],
          [
            "barbell-conventional-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          [
            "barbell-hip-thrust",
            "dumbbell-glute-bridge",
            "bodyweight-glute-bridge",
          ],
          ["bodyweight-standing-calf-raise"],
          ["cable-pallof-press", "side-plank", "dead-bug"],
        ],
      },
    ],
  },
  5: {
    title: "5-day adapted upper/lower",
    offsets: [0, 1, 2, 4, 5],
    days: [
      {
        title: "Upper A",
        slots: [
          ["barbell-bench-press", "dumbbell-bench-press", "push-up"],
          ["barbell-bent-over-row", "dumbbell-one-arm-row", "inverted-row"],
          ["barbell-overhead-press", "dumbbell-overhead-press", "pike-push-up"],
          ["lat-pulldown", "dumbbell-one-arm-row", "inverted-row"],
        ],
      },
      {
        title: "Lower A",
        slots: [
          [
            "barbell-back-squat",
            "dumbbell-goblet-squat",
            "bodyweight-split-squat",
          ],
          [
            "barbell-romanian-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          [
            "dumbbell-step-up",
            "dumbbell-reverse-lunge",
            "bodyweight-split-squat",
          ],
          ["plank", "dead-bug"],
        ],
      },
      {
        title: "Upper B",
        slots: [
          ["machine-chest-press", "incline-dumbbell-bench-press", "push-up"],
          ["chest-supported-row", "dumbbell-one-arm-row", "inverted-row"],
          ["machine-shoulder-press", "dumbbell-overhead-press", "pike-push-up"],
          ["pull-up"],
        ],
      },
      {
        title: "Lower B",
        slots: [
          ["leg-press", "dumbbell-goblet-squat", "bodyweight-split-squat"],
          [
            "barbell-conventional-deadlift",
            "dumbbell-romanian-deadlift",
            "bodyweight-glute-bridge",
          ],
          [
            "barbell-hip-thrust",
            "dumbbell-glute-bridge",
            "bodyweight-glute-bridge",
          ],
          ["cable-pallof-press", "side-plank", "dead-bug"],
        ],
      },
      {
        title: "Accessory",
        slots: [
          [
            "cable-triceps-pushdown",
            "dumbbell-overhead-triceps-extension",
            "push-up",
          ],
          ["cable-biceps-curl", "dumbbell-biceps-curl"],
          ["bodyweight-standing-calf-raise"],
          ["cable-pallof-press", "side-plank", "dead-bug"],
        ],
      },
    ],
  },
};

function planDays(days: number): 2 | 3 | 4 | 5 {
  if (!Number.isFinite(days)) return 3;
  return Math.max(2, Math.min(5, Math.round(days))) as 2 | 3 | 4 | 5;
}

function availableFromSlot(
  slot: string[],
  equipment: Profile["equipment"],
): Exercise | undefined {
  return slot
    .map((exerciseId) => findExercise(exerciseId))
    .find(
      (exercise): exercise is Exercise =>
        exercise !== undefined && exercise.equipment.includes(equipment),
    );
}

function restrictedAreas(profile: Profile): Set<string> {
  return new Set([...profile.limitations, ...profile.pausedAreas]);
}

/**
 * Use a whitelist substitution for an affected movement, or omit it when no
 * approved movement has the same pattern and avoids every restricted area.
 */
function applyRestrictions(
  exercise: Exercise,
  profile: Profile,
  restricted: Set<string>,
): Exercise | undefined {
  const affected = exercise.loadedAreas.filter((area) => restricted.has(area));
  if (affected.length === 0) return exercise;

  for (const area of affected) {
    const replacement = approvedCandidates(
      exercise.id,
      area,
      profile.equipment,
      [...restricted],
    )[0];
    if (replacement) return replacement;
  }
  return undefined;
}

function prescriptionFor(exercise: Exercise, profile: Profile): Prescription {
  const beginner = profile.experience === "beginner";
  const setsByGoal: Record<Goal, number> = {
    strength: 3,
    muscle: 3,
    fitness: 2,
  };
  const repsByGoal: Record<Goal, number> = beginner
    ? { strength: 6, muscle: 10, fitness: 10 }
    : { strength: 5, muscle: 8, fitness: 12 };
  const sets = beginner
    ? Math.max(2, setsByGoal[profile.goal] - 1)
    : setsByGoal[profile.goal];

  // Base weights in the library are deliberately modest. Beginners start at a
  // further rounded-down 75% when a load is used; bodyweight remains zero.
  const rawWeight = beginner
    ? exercise.defaultWeight * 0.75
    : exercise.defaultWeight;
  const weight =
    exercise.increment > 0
      ? Math.max(
          exercise.increment,
          Math.floor(rawWeight / exercise.increment) * exercise.increment,
        )
      : 0;

  return {
    exerciseId: exercise.id,
    sets,
    reps: repsByGoal[profile.goal],
    weight,
    targetRpe: beginner ? 6 : 7,
  };
}

function prescriptionsFor(day: StarterDay, profile: Profile): Prescription[] {
  const restricted = restrictedAreas(profile);
  const used = new Set<string>();
  const prescriptions: Prescription[] = [];

  for (const slot of day.slots) {
    const selected = availableFromSlot(slot, profile.equipment);
    if (!selected) continue;
    const permitted = applyRestrictions(selected, profile, restricted);
    if (!permitted || used.has(permitted.id)) continue;
    used.add(permitted.id);
    prescriptions.push(prescriptionFor(permitted, profile));
  }

  return prescriptions;
}

/** Generate a deterministic four-week starter program whose first session is immediate. */
export function generateProgram(
  profile: Profile,
  startDate: string,
  idPrefix = "program",
): { title: string; sessions: TrainingSession[] } {
  const days = planDays(profile.days);
  const template = starterTemplates[days];
  const sessions: TrainingSession[] = [];

  for (let week = 1; week <= 4; week += 1) {
    template.days.forEach((day, index) => {
      sessions.push({
        id: `${idPrefix}-w${week}-d${index + 1}`,
        date: addDays(startDate, (week - 1) * 7 + template.offsets[index]),
        title: day.title,
        week,
        status: "planned",
        exercises: prescriptionsFor(day, profile),
      });
    });
  }

  return { title: template.title, sessions };
}

/**
 * A pure, explicitly labelled preview. It contains no persistence work and is
 * safe to render before a visitor accepts the product disclaimer.
 */
export function demoState(today: string): AppState {
  const profile: Profile = {
    goal: "fitness",
    days: 3,
    equipment: "dumbbells",
    experience: "beginner",
    limitations: [],
    pausedAreas: [],
    blockedDates: [],
  };
  const startDate = addDays(today, -4);
  const generated = generateProgram(profile, startDate, "demo");
  const sessions = generated.sessions.map((session) => ({
    ...session,
    title: `Demo · ${session.title}`,
  }));
  const completed = sessions
    .slice(0, 2)
    .map((session) => ({ ...session, status: "done" as const }));
  sessions.splice(0, completed.length, ...completed);

  const logs = completed.flatMap((session) =>
    session.exercises.slice(0, 1).map((prescription) => ({
      sessionId: session.id,
      exerciseId: prescription.exerciseId,
      setIndex: 1,
      weight: prescription.weight,
      reps: prescription.reps,
      status: "done" as const,
      rpe: 6,
    })),
  );

  return {
    name: "Alex",
    demo: true,
    disclaimerAccepted: false,
    profile,
    program: {
      id: "demo-program",
      title: "Example plan (demo only)",
      startDate,
    },
    sessions,
    changes: [
      {
        id: "demo-change-1",
        type: "schedule",
        reason_code: "DEMO_FRIENDLY_SCHEDULE_ADJUSTMENT",
        affected_sessions: [sessions[2].id],
        before: { date: sessions[2].date },
        after: { date: today },
        explanation:
          "Example adjustment: your plan moved with you, and today is a good place to continue.",
        createdAt: today,
      },
    ],
    checkIns: completed.map((session) => ({
      sessionId: session.id,
      date: session.date,
      energy: 4,
      pain: "none" as const,
      symptoms: [],
    })),
    logs,
    library: exercises,
  };
}
