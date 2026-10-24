import { prescriptionForSwap } from "./swaps";
import {
  addDays,
  dayGap,
  isUpcoming,
  monday,
  type AdjustmentEvent,
  type AdjustmentInput,
  type AdjustmentResult,
  type CheckIn,
  type Exercise,
  type Performance,
  type PlanChange,
  type Prescription,
  type TrainingSession,
} from "./domain";

/** Stable reason codes consumed by the explanation and activity-feed layers. */
export const ADJUSTMENT_REASON = {
  MISSED_SESSION_MOVED: "MISSED_SESSION_MOVED",
  MISSED_WEEK_RESTART: "multiple_missed",
  LOW_ENERGY_VOLUME_REDUCED: "LOW_ENERGY_VOLUME_REDUCED",
  MILD_PAIN_EXERCISE_SWAPPED: "MILD_PAIN_EXERCISE_SWAPPED",
  MILD_PAIN_EXERCISE_REMOVED: "MILD_PAIN_EXERCISE_REMOVED",
  SAFETY_AREA_PAUSED: "SAFETY_AREA_PAUSED",
  AVAILABILITY_DATES_BLOCKED: "AVAILABILITY_DATES_BLOCKED",
  SESSION_MOVED: "SESSION_MOVED",
  RESUME_WEIGHT_REDUCED: "RESUME_WEIGHT_REDUCED",
  RESUME_RESTART: "RESUME_RESTART",
  PROGRESSION_APPLIED: "PROGRESSION_APPLIED",
} as const;

const MAX_SCHEDULE_LOOKAHEAD_DAYS = 730;
const SYSTEMIC_SYMPTOM = /chest\s*pain|dizziness/i;
const SAFETY_SYMPTOM =
  /numbness|chest\s*pain|dizziness|recent\s+injury|trauma/i;

type ReductionBaseline = {
  sets: number;
  weight: number;
  volumeFactor: number;
  weightFactor: number;
};

// These fields are intentionally structural until persistence adds them to the
// fixed domain contract. `missedWeek` preserves the original calendar week if
// a missed workout has to move into the following week.
type SessionWithMissHistory = TrainingSession & {
  missed?: boolean;
  missedWeek?: string;
};

/**
 * Deterministically applies plan adjustments without mutating input objects.
 * Event ordering is respected except that safety check-ins always run first.
 */
export function adjustPlan(input: AdjustmentInput): AdjustmentResult {
  assertIsoDate(input.today, "today");

  const sessions = input.sessions.map(cloneSession);
  const changes: PlanChange[] = [];
  const libraryById = new Map(
    input.library.map((exercise) => [exercise.id, exercise]),
  );
  const reductions = new WeakMap<Prescription, ReductionBaseline>();

  // An availability block is global to this adjustment, irrespective of where
  // its event sits in the batch. This prevents a preceding move from choosing a
  // date that the same batch subsequently declares unavailable.
  const blockedDates = uniqueStrings([
    ...input.blockedDates.map((date) => validatedDate(date, "blocked date")),
    ...input.events
      .filter(
        (event): event is Extract<AdjustmentEvent, { type: "availability" }> =>
          event.type === "availability",
      )
      .flatMap((event) =>
        event.dates.map((date) => validatedDate(date, "availability date")),
      ),
  ]);
  const pausedAreas = uniqueStrings(
    input.pausedAreas.map(normaliseArea).filter(Boolean),
  );

  const safetyEvents = input.events.filter(
    (event): event is Extract<AdjustmentEvent, { type: "checkin" }> =>
      event.type === "checkin" && isSafetyCheckIn(event.checkIn),
  );
  for (const event of safetyEvents) {
    applySafetyPause(
      event.checkIn,
      sessions,
      pausedAreas,
      libraryById,
      changes,
    );
  }

  const allCheckIns = mergeCheckIns(input.checkIns, input.events);

  for (const event of input.events) {
    switch (event.type) {
      case "checkin":
        if (!isSafetyCheckIn(event.checkIn)) {
          applyMildPain(
            event.checkIn,
            sessions,
            pausedAreas,
            input.equipment,
            libraryById,
            changes,
          );
          applyLowEnergy(
            event.checkIn,
            allCheckIns,
            sessions,
            input.today,
            reductions,
            changes,
          );
        }
        break;
      case "missed":
        applyMissedSessions(
          event.sessionIds,
          sessions,
          input.today,
          blockedDates,
          reductions,
          changes,
        );
        break;
      case "availability":
        // All availability dates were persisted above, so processing any one
        // event can safely reschedule sessions against the complete block list.
        applyAvailability(sessions, input.today, blockedDates, changes);
        break;
      case "move":
        applyExplicitMove(
          event.sessionId,
          event.date,
          sessions,
          input.today,
          blockedDates,
          changes,
        );
        break;
      case "resume":
        applyResume(
          event.lastCompletedDate,
          event.lastWorkingWeights,
          sessions,
          input.today,
          reductions,
          changes,
        );
        break;
      case "progression":
        applyProgression(
          event.performances,
          sessions,
          input.today,
          pausedAreas,
          libraryById,
          changes,
        );
        break;
    }
  }

  return {
    sessions,
    changes,
    pausedAreas,
    blockedDates,
  };
}

function cloneSession(session: TrainingSession): TrainingSession {
  return {
    ...session,
    exercises: session.exercises.map((prescription) => ({ ...prescription })),
  };
}

function clonePrescription(prescription: Prescription): Prescription {
  return { ...prescription };
}

function makeChange(
  type: string,
  reasonCode: string,
  affectedSessions: string[],
  before: unknown,
  after: unknown,
): PlanChange {
  // Deliberately only emit the fixed public fields. Natural-language copy is
  // generated by the separate explanation layer.
  return {
    type,
    reason_code: reasonCode,
    affected_sessions: affectedSessions,
    before,
    after,
  };
}

function isSafetyCheckIn(checkIn: CheckIn): boolean {
  return (
    checkIn.pain === "sharp" ||
    checkIn.symptoms.some((symptom) => SAFETY_SYMPTOM.test(symptom))
  );
}

function isSystemicCheckIn(checkIn: CheckIn): boolean {
  return (
    !normaliseArea(checkIn.area) ||
    checkIn.symptoms.some((symptom) => SYSTEMIC_SYMPTOM.test(symptom))
  );
}

function applySafetyPause(
  checkIn: CheckIn,
  sessions: TrainingSession[],
  pausedAreas: string[],
  libraryById: Map<string, Exercise>,
  changes: PlanChange[],
): void {
  const area = isSystemicCheckIn(checkIn) ? "all" : normaliseArea(checkIn.area);
  if (!area) return;
  if (!pausedAreas.includes(area)) pausedAreas.push(area);

  const affected: string[] = [];
  const before: Array<{ sessionId: string; exercises: Prescription[] }> = [];
  const after: Array<{ sessionId: string; exercises: Prescription[] }> = [];

  for (const session of sessions) {
    if (!isUpcoming(session)) continue;
    const oldExercises = session.exercises;
    const newExercises = oldExercises.filter((prescription) => {
      const exercise = libraryById.get(prescription.exerciseId);
      return !loadsArea(exercise, area);
    });
    if (newExercises.length === oldExercises.length) continue;

    affected.push(session.id);
    before.push({
      sessionId: session.id,
      exercises: oldExercises.map(clonePrescription),
    });
    session.exercises = newExercises;
    after.push({
      sessionId: session.id,
      exercises: newExercises.map(clonePrescription),
    });
  }

  changes.push(
    makeChange(
      "safety_pause",
      ADJUSTMENT_REASON.SAFETY_AREA_PAUSED,
      affected,
      { area, sessions: before },
      { area, sessions: after },
    ),
  );
}

function applyMildPain(
  checkIn: CheckIn,
  sessions: TrainingSession[],
  pausedAreas: string[],
  equipment: AdjustmentInput["equipment"],
  libraryById: Map<string, Exercise>,
  changes: PlanChange[],
): void {
  if (checkIn.pain !== "mild") return;
  const area = normaliseArea(checkIn.area);
  if (!area) return;

  const swaps: Array<{
    sessionId: string;
    before: Prescription;
    after: Prescription;
  }> = [];
  const removals: Array<{ sessionId: string; before: Prescription }> = [];

  for (const session of sessions) {
    if (!isUpcoming(session)) continue;
    const nextExercises: Prescription[] = [];

    for (const prescription of session.exercises) {
      const source = libraryById.get(prescription.exerciseId);
      if (!loadsArea(source, area)) {
        nextExercises.push(prescription);
        continue;
      }

      // An already-paused area is never given a workaround. This also makes a
      // safety event in the same batch take precedence over a mild-pain event.
      if (isPausedArea(area, pausedAreas)) {
        removals.push({
          sessionId: session.id,
          before: clonePrescription(prescription),
        });
        continue;
      }

      const alternative = source?.swapIds
        .map((id) => libraryById.get(id))
        .find(
          (candidate): candidate is Exercise =>
            candidate !== undefined &&
            candidate.pattern === source?.pattern &&
            candidate.equipment.includes(equipment) &&
            !loadsArea(candidate, area) &&
            !candidate.loadedAreas.some((loadedArea) =>
              isPausedArea(normaliseArea(loadedArea), pausedAreas),
            ),
        );

      if (!alternative) {
        removals.push({
          sessionId: session.id,
          before: clonePrescription(prescription),
        });
        continue;
      }

      const replacement = prescriptionForSwap(prescription, alternative);
      swaps.push({
        sessionId: session.id,
        before: clonePrescription(prescription),
        after: clonePrescription(replacement),
      });
      nextExercises.push(replacement);
    }

    session.exercises = nextExercises;
  }

  if (swaps.length > 0) {
    changes.push(
      makeChange(
        "exercise_swap",
        ADJUSTMENT_REASON.MILD_PAIN_EXERCISE_SWAPPED,
        uniqueStrings(swaps.map((swap) => swap.sessionId)),
        swaps.map(({ sessionId, before }) => ({
          sessionId,
          prescription: before,
        })),
        swaps.map(({ sessionId, after }) => ({
          sessionId,
          prescription: after,
        })),
      ),
    );
  }
  if (removals.length > 0) {
    changes.push(
      makeChange(
        "exercise_removed",
        ADJUSTMENT_REASON.MILD_PAIN_EXERCISE_REMOVED,
        uniqueStrings(removals.map((removal) => removal.sessionId)),
        removals.map(({ sessionId, before }) => ({
          sessionId,
          prescription: before,
        })),
        removals.map(({ sessionId }) => ({ sessionId, prescription: null })),
      ),
    );
  }
}

function applyLowEnergy(
  checkIn: CheckIn,
  allCheckIns: CheckIn[],
  sessions: TrainingSession[],
  today: string,
  reductions: WeakMap<Prescription, ReductionBaseline>,
  changes: PlanChange[],
): void {
  if (checkIn.energy > 2) return;
  const sorted = [...allCheckIns].sort(compareCheckIns);
  const mostRecent = sorted.slice(-2);
  if (
    mostRecent.length !== 2 ||
    mostRecent[1].sessionId !== checkIn.sessionId ||
    mostRecent[1].date !== checkIn.date ||
    mostRecent.some((entry) => entry.energy > 2)
  ) {
    return;
  }

  const nextSession = nextUpcomingSession(
    sessions,
    maxDate(today, checkIn.date),
  );
  if (!nextSession) return;
  const before = prescriptionSnapshot(nextSession);
  applyFactors(nextSession, 0.8, 1, reductions);
  const after = prescriptionSnapshot(nextSession);
  changes.push(
    makeChange(
      "volume_reduction",
      ADJUSTMENT_REASON.LOW_ENERGY_VOLUME_REDUCED,
      [nextSession.id],
      before,
      after,
    ),
  );
}

function applyMissedSessions(
  requestedIds: string[],
  sessions: TrainingSession[],
  today: string,
  blockedDates: string[],
  reductions: WeakMap<Prescription, ReductionBaseline>,
  changes: PlanChange[],
): void {
  const requested = new Set(requestedIds);
  const newlyMissed = sessions.filter(
    (session) =>
      requested.has(session.id) &&
      isUpcoming(session) &&
      (!hasMissed(session) || session.date < today),
  );
  if (newlyMissed.length === 0) return;

  const byWeek = new Map<string, TrainingSession[]>();
  for (const session of newlyMissed) {
    const weekStart = missedWeekOf(session);
    markMissed(session, weekStart);
    const group = byWeek.get(weekStart) ?? [];
    group.push(session);
    byWeek.set(weekStart, group);
  }

  for (const [weekStart, newlySkippedThisWeek] of byWeek) {
    // Keep `status === skipped` for backwards-compatible records that were
    // persisted before the explicit missed flag was introduced.
    const skippedCount = sessions.filter(
      (session) =>
        (session.status === "skipped" || hasMissed(session)) &&
        missedWeekOf(session) === weekStart,
    ).length;
    const hasRestartedWeek = sessions.some(
      (session) =>
        session.restart === true &&
        (missedWeekOf(session) === weekStart ||
          (isUpcoming(session) && monday(session.date) === weekStart)),
    );

    if (skippedCount >= 2) {
      if (!hasRestartedWeek) {
        restartMissedWeek(
          weekStart,
          newlySkippedThisWeek,
          sessions,
          today,
          blockedDates,
          reductions,
          changes,
        );
        continue;
      }
    }

    for (const missed of newlySkippedThisWeek) {
      const before = {
        id: missed.id,
        date: missed.date,
        status: "planned",
        exercises: prescriptionSnapshot(missed),
      };
      const nextDate = findNextSchedulableDate(
        maxDate(today, addDays(missed.date, 1)),
        sessions,
        blockedDates,
        missed.id,
        "Missed-session move",
      );
      missed.date = nextDate;
      missed.status = "moved";
      const after = {
        id: missed.id,
        date: missed.date,
        status: missed.status,
        exercises: prescriptionSnapshot(missed),
      };
      changes.push(
        makeChange(
          "session_moved",
          ADJUSTMENT_REASON.MISSED_SESSION_MOVED,
          [missed.id],
          before,
          after,
        ),
      );
    }
  }
}

function restartMissedWeek(
  weekStart: string,
  newlySkipped: TrainingSession[],
  sessions: TrainingSession[],
  today: string,
  blockedDates: string[],
  reductions: WeakMap<Prescription, ReductionBaseline>,
  changes: PlanChange[],
): void {
  const remaining = sessions.filter(
    (session) =>
      isUpcoming(session) &&
      session.date >= today &&
      missedWeekOf(session) === weekStart &&
      !newlySkipped.includes(session),
  );
  const restartTargets = [...remaining, ...newlySkipped];
  const before = restartTargets.map((session) => ({
    id: session.id,
    date: session.date,
    exercises: prescriptionSnapshot(session),
    restart: session.restart ?? false,
  }));

  // Reuse the original session records for missed workout replacements. Their
  // persistent missed markers preserve cumulative-miss history while their IDs
  // remain safe for the persistence service's update-by-ID behavior.
  for (const missed of newlySkipped) {
    missed.date = findNextSchedulableDate(
      today,
      sessions,
      blockedDates,
      missed.id,
      "Restart-week reschedule",
    );
    missed.status = "moved";
  }

  for (const session of restartTargets) {
    applyFactors(session, 0.8, 1, reductions);
    session.restart = true;
  }

  const after = restartTargets.map((session) => ({
    id: session.id,
    date: session.date,
    exercises: prescriptionSnapshot(session),
    restart: session.restart ?? false,
  }));

  changes.push(
    makeChange(
      "week_restart",
      ADJUSTMENT_REASON.MISSED_WEEK_RESTART,
      restartTargets.map((session) => session.id),
      before,
      after,
    ),
  );
}

function applyAvailability(
  sessions: TrainingSession[],
  today: string,
  blockedDates: string[],
  changes: PlanChange[],
): void {
  const affected = sessions
    .filter(
      (session) => isUpcoming(session) && blockedDates.includes(session.date),
    )
    .sort(compareSessions);
  if (affected.length === 0) return;

  const before = affected.map((session) => ({
    id: session.id,
    date: session.date,
    status: session.status,
  }));
  for (const session of affected) {
    const nextDate = findNextSchedulableDate(
      today,
      sessions,
      blockedDates,
      session.id,
      "Availability reschedule",
    );
    session.date = nextDate;
    session.status = "moved";
  }
  const after = affected.map((session) => ({
    id: session.id,
    date: session.date,
    status: session.status,
  }));
  changes.push(
    makeChange(
      "availability_reschedule",
      ADJUSTMENT_REASON.AVAILABILITY_DATES_BLOCKED,
      affected.map((session) => session.id),
      before,
      after,
    ),
  );
}

function applyExplicitMove(
  sessionId: string,
  requestedDate: string,
  sessions: TrainingSession[],
  today: string,
  blockedDates: string[],
  changes: PlanChange[],
): void {
  const date = validatedDate(requestedDate, "move date");
  if (date < today)
    throw new Error(
      `Cannot move session ${sessionId} to a past date (${date}).`,
    );
  if (blockedDates.includes(date))
    throw new Error(`Cannot move session ${sessionId}: ${date} is blocked.`);

  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session)
    throw new Error(`Cannot move session ${sessionId}: session was not found.`);
  if (!isUpcoming(session))
    throw new Error(
      `Cannot move session ${sessionId}: only upcoming sessions can be moved.`,
    );

  const conflicting = sessions.find(
    (candidate) =>
      candidate.id !== session.id &&
      candidate.status !== "skipped" &&
      candidate.date === date,
  );
  if (conflicting) {
    throw new Error(
      `Cannot move session ${sessionId}: ${date} already has session ${conflicting.id}.`,
    );
  }
  if (!canTrainOn(date, sessions, blockedDates, session.id)) {
    throw new Error(
      `Cannot move session ${sessionId}: ${date} would create more than 3 consecutive training days.`,
    );
  }

  const before = {
    id: session.id,
    date: session.date,
    status: session.status,
    exercises: prescriptionSnapshot(session),
  };
  session.date = date;
  session.status = "moved";
  const after = {
    id: session.id,
    date: session.date,
    status: session.status,
    exercises: prescriptionSnapshot(session),
  };
  changes.push(
    makeChange(
      "session_moved",
      ADJUSTMENT_REASON.SESSION_MOVED,
      [session.id],
      before,
      after,
    ),
  );
}

function applyResume(
  lastCompletedDate: string,
  lastWorkingWeights: Record<string, number> | undefined,
  sessions: TrainingSession[],
  today: string,
  reductions: WeakMap<Prescription, ReductionBaseline>,
  changes: PlanChange[],
): void {
  const completed = validatedDate(lastCompletedDate, "last completed date");
  const gap = dayGap(completed, today);
  if (gap < 7) return;

  const nextSession = nextUpcomingSession(sessions, today);
  if (!nextSession) return;
  const before = prescriptionSnapshot(nextSession);

  if (gap >= 14) {
    setWorkingWeightBaselines(nextSession, lastWorkingWeights, reductions);
    applyFactors(nextSession, 0.7, 0.7, reductions);
    nextSession.restart = true;
    changes.push(
      makeChange(
        "resume_restart",
        ADJUSTMENT_REASON.RESUME_RESTART,
        [nextSession.id],
        before,
        { exercises: prescriptionSnapshot(nextSession), restart: true },
      ),
    );
    return;
  }

  setWorkingWeightBaselines(nextSession, lastWorkingWeights, reductions);
  applyFactors(nextSession, 1, 0.85, reductions);
  changes.push(
    makeChange(
      "resume_weight_reduction",
      ADJUSTMENT_REASON.RESUME_WEIGHT_REDUCED,
      [nextSession.id],
      before,
      prescriptionSnapshot(nextSession),
    ),
  );
}

function setWorkingWeightBaselines(
  session: TrainingSession,
  weights: Record<string, number> | undefined,
  reductions: WeakMap<Prescription, ReductionBaseline>,
): void {
  if (!weights) return;
  for (const prescription of session.exercises) {
    const supplied = weights[prescription.exerciseId];
    if (typeof supplied !== "number" || !Number.isFinite(supplied)) continue;
    const baseline = baselineFor(prescription, reductions);
    baseline.weight = supplied;
    prescription.weight = roundWeight(supplied * baseline.weightFactor);
  }
}

function applyProgression(
  performances: Performance[],
  sessions: TrainingSession[],
  today: string,
  pausedAreas: string[],
  libraryById: Map<string, Exercise>,
  changes: PlanChange[],
): void {
  const byExercise = new Map<string, Performance[]>();
  for (const performance of performances) {
    const performancesForExercise =
      byExercise.get(performance.exerciseId) ?? [];
    performancesForExercise.push(performance);
    byExercise.set(performance.exerciseId, performancesForExercise);
  }

  for (const [exerciseId, exercisePerformances] of byExercise) {
    const latest = [...exercisePerformances]
      .sort(comparePerformances)
      .slice(-2);
    const exercise = libraryById.get(exerciseId);
    if (
      !exercise ||
      latest.length !== 2 ||
      latest[0].sessionId === latest[1].sessionId
    )
      continue;
    if (!latest.every(isQualifyingPerformance) || !sameWorkingWeight(latest))
      continue;
    if (exercise.increment <= 0 || latest[0].logs[0]?.weight === 0) continue;
    if (
      exercise.loadedAreas.some((area) =>
        isPausedArea(normaliseArea(area), pausedAreas),
      )
    )
      continue;

    const nextSession = [...sessions]
      .filter(
        (session) =>
          isUpcoming(session) &&
          session.date >= today &&
          session.exercises.some((p) => p.exerciseId === exerciseId),
      )
      .sort(compareSessions)[0];
    if (!nextSession) continue;

    const prescription = nextSession.exercises.find(
      (candidate) => candidate.exerciseId === exerciseId,
    );
    if (!prescription || prescription.weight === 0) continue;

    const before = {
      sessionId: nextSession.id,
      prescription: clonePrescription(prescription),
    };
    prescription.weight = roundWeight(
      latest[1].logs[0].weight + exercise.increment,
    );
    const after = {
      sessionId: nextSession.id,
      prescription: clonePrescription(prescription),
    };
    changes.push(
      makeChange(
        "progression",
        ADJUSTMENT_REASON.PROGRESSION_APPLIED,
        [nextSession.id],
        before,
        after,
      ),
    );
  }
}

function isQualifyingPerformance(performance: Performance): boolean {
  if (
    performance.prescribedSets < 1 ||
    performance.logs.length !== performance.prescribedSets
  )
    return false;
  const uniqueSetIndices = new Set(
    performance.logs.map((entry) => entry.setIndex),
  );
  return (
    uniqueSetIndices.size === performance.prescribedSets &&
    performance.logs.every(
      (entry) =>
        entry.status === "done" &&
        entry.reps >= performance.prescribedReps &&
        entry.rpe <= performance.targetRpe,
    )
  );
}

function sameWorkingWeight(performances: Performance[]): boolean {
  const weights = performances.flatMap((performance) =>
    performance.logs.map((entry) => entry.weight),
  );
  return weights.length > 0 && new Set(weights).size === 1;
}

function applyFactors(
  session: TrainingSession,
  volumeFactor: number,
  weightFactor: number,
  reductions: WeakMap<Prescription, ReductionBaseline>,
): void {
  for (const prescription of session.exercises) {
    const baseline = baselineFor(prescription, reductions);
    baseline.volumeFactor = Math.min(baseline.volumeFactor, volumeFactor);
    baseline.weightFactor = Math.min(baseline.weightFactor, weightFactor);
    prescription.baseSets = baseline.sets;
    prescription.volumeFactor = baseline.volumeFactor;
    prescription.sets = Math.max(
      1,
      Math.round(baseline.sets * baseline.volumeFactor),
    );
    prescription.weight = roundWeight(baseline.weight * baseline.weightFactor);
  }
}

function baselineFor(
  prescription: Prescription,
  reductions: WeakMap<Prescription, ReductionBaseline>,
): ReductionBaseline {
  let baseline = reductions.get(prescription);
  if (!baseline) {
    baseline = {
      sets: prescription.baseSets ?? prescription.sets,
      weight: prescription.weight,
      volumeFactor: prescription.volumeFactor ?? 1,
      weightFactor: 1,
    };
    reductions.set(prescription, baseline);
  }
  return baseline;
}

function findNextSchedulableDate(
  start: string,
  sessions: TrainingSession[],
  blockedDates: string[],
  excludeSessionId: string | undefined,
  context: string,
  end?: string,
): string {
  const lowerBound = validatedDate(start, "schedule start date");
  const maximum = end ?? addDays(lowerBound, MAX_SCHEDULE_LOOKAHEAD_DAYS);
  for (
    let offset = 0, date = lowerBound;
    date <= maximum;
    offset += 1, date = addDays(lowerBound, offset)
  ) {
    if (canTrainOn(date, sessions, blockedDates, excludeSessionId)) return date;
  }
  throw new Error(
    `${context}: no free valid training date is available before ${maximum}.`,
  );
}

function canTrainOn(
  date: string,
  sessions: TrainingSession[],
  blockedDates: string[],
  excludeSessionId?: string,
): boolean {
  if (blockedDates.includes(date)) return false;
  const occupied = new Set(
    sessions
      // Upcoming sessions on blocked dates are transient: availability
      // processing will relocate every one of them, so they must not make a
      // valid replacement day appear to violate the training-day cap.
      .filter(
        (session) =>
          session.id !== excludeSessionId &&
          session.status !== "skipped" &&
          // A completed workout is historical/fixed even when a trip or sick
          // range overlaps it; only future movable sessions on blocked dates
          // are transient and therefore excluded from occupancy.
          (session.status === "done" || !blockedDates.includes(session.date)),
      )
      .map((session) => session.date),
  );
  if (occupied.has(date)) return false;

  let before = 0;
  for (
    let probe = addDays(date, -1);
    occupied.has(probe);
    probe = addDays(probe, -1)
  )
    before += 1;
  let after = 0;
  for (
    let probe = addDays(date, 1);
    occupied.has(probe);
    probe = addDays(probe, 1)
  )
    after += 1;
  return before + 1 + after <= 3;
}

function nextUpcomingSession(
  sessions: TrainingSession[],
  onOrAfter: string,
): TrainingSession | undefined {
  return [...sessions]
    .filter((session) => isUpcoming(session) && session.date >= onOrAfter)
    .sort(compareSessions)[0];
}

function mergeCheckIns(
  checkIns: CheckIn[],
  events: AdjustmentEvent[],
): CheckIn[] {
  const merged = new Map<string, CheckIn>();
  for (const checkIn of checkIns)
    merged.set(checkInKey(checkIn), {
      ...checkIn,
      symptoms: [...checkIn.symptoms],
    });
  for (const event of events) {
    if (event.type === "checkin")
      merged.set(checkInKey(event.checkIn), {
        ...event.checkIn,
        symptoms: [...event.checkIn.symptoms],
      });
  }
  return [...merged.values()];
}

function checkInKey(checkIn: CheckIn): string {
  return `${checkIn.sessionId}\u0000${checkIn.date}`;
}

function loadsArea(exercise: Exercise | undefined, area: string): boolean {
  if (area === "all") return true;
  return (
    exercise?.loadedAreas.some(
      (loadedArea) => normaliseArea(loadedArea) === area,
    ) ?? false
  );
}

function isPausedArea(area: string, pausedAreas: string[]): boolean {
  return pausedAreas.includes("all") || pausedAreas.includes(area);
}

function normaliseArea(area: string | undefined): string {
  return area?.trim().toLowerCase() ?? "";
}

function hasMissed(session: TrainingSession): boolean {
  return (session as SessionWithMissHistory).missed === true;
}

function missedWeekOf(session: TrainingSession): string {
  return (session as SessionWithMissHistory).missedWeek ?? monday(session.date);
}

function markMissed(session: TrainingSession, weekStart: string): void {
  const withHistory = session as SessionWithMissHistory;
  withHistory.missed = true;
  withHistory.missedWeek = weekStart;
}

function prescriptionSnapshot(session: TrainingSession): Prescription[] {
  return session.exercises.map(clonePrescription);
}

function compareSessions(a: TrainingSession, b: TrainingSession): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

function compareCheckIns(a: CheckIn, b: CheckIn): number {
  return a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId);
}

function comparePerformances(a: Performance, b: Performance): number {
  return a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId);
}

function roundWeight(weight: number): number {
  return Number(weight.toFixed(2));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function validatedDate(date: string, label: string): string {
  assertIsoDate(date, label);
  return date;
}

function assertIsoDate(date: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
}
