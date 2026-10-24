import { prescriptionForSwap } from "./swaps";
import { db } from "./db";
import { adjustPlan } from "./engine";
import { exercises, approvedCandidates } from "./library";
import { generateProgram, demoState } from "./templates";
import { explainChange, chooseSwap } from "./llm";
import { addDays, dayGap, isUpcoming } from "./domain";
import type {
  AppState,
  Profile,
  TrainingSession,
  CheckIn,
  SetEntry,
  AdjustmentEvent,
  Performance,
  ThemePreference,
} from "@/lib/domain";
import type { Action } from "./validation";

const queues = new Map<string, Promise<unknown>>();
export async function withUserLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(id, next);
  try {
    return await next;
  } finally {
    if (queues.get(id) === next) queues.delete(id);
  }
}
const parse = <T>(value: string): T => JSON.parse(value) as T;
async function load(userId: string, today: string): Promise<AppState> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      checkIns: { where: { sessionId: null }, orderBy: { date: "asc" } },
      profile: true,
      programs: {
        where: { active: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sessions: {
            orderBy: { date: "asc" },
            include: { setLogs: true, checkIn: true },
          },
          changes: { orderBy: { createdAt: "desc" }, take: 40 },
        },
      },
    },
  });
  const p = user.profile,
    program = user.programs[0];
  if (!p || !program)
    return { ...demoState(today), disclaimerAccepted: user.disclaimerAccepted };
  return {
    name: user.name,
    demo: false,
    disclaimerAccepted: user.disclaimerAccepted,
    profile: {
      goal: p.goal,
      days: p.days,
      equipment: p.equipment,
      experience: p.experience,
      limitations: parse(p.limitations),
      pausedAreas: parse(p.pausedAreas),
      blockedDates: parse(p.blockedDates),
      themePreference: (p.themePreference || "system") as ThemePreference,
    } as Profile,
    program: {
      id: program.id,
      title: program.title,
      startDate: program.startDate,
    },
    library: exercises,
    sessions: program.sessions.map((s) => ({
      id: s.id,
      date: s.date,
      title: s.title,
      week: s.week,
      status: s.status,
      exercises: parse(s.prescriptions),
      restart: s.restart,
      missed: s.missed,
      missedWeek: s.missedWeek ?? undefined,
    })) as TrainingSession[],
    changes: program.changes.map((c) => ({
      id: c.id,
      type: c.type,
      reason_code: c.reasonCode,
      affected_sessions: parse(c.affectedSessions),
      before: parse(c.before),
      after: parse(c.after),
      explanation: c.explanation,
      createdAt: c.createdAt.toISOString(),
    })),
    checkIns: [
      ...program.sessions.flatMap((s) =>
        s.checkIn
          ? [
              {
                sessionId: s.id,
                date: s.checkIn.date,
                energy: s.checkIn.energy,
                pain: s.checkIn.pain,
                area: s.checkIn.area ?? undefined,
                symptoms: parse(s.checkIn.symptoms),
              },
            ]
          : [],
      ),
      ...user.checkIns.map((c) => ({
        sessionId: c.id,
        date: c.date,
        energy: c.energy,
        pain: c.pain,
        area: c.area ?? undefined,
        symptoms: parse(c.symptoms),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date)) as CheckIn[],
    logs: program.sessions.flatMap((s) =>
      s.setLogs.map((l) => ({
        sessionId: s.id,
        exerciseId: l.exerciseId,
        setIndex: l.setIndex,
        weight: l.weight,
        reps: l.reps,
        status: l.status,
        rpe: l.rpe,
      })),
    ) as AppState["logs"],
    themePreference: (p.themePreference || "system") as ThemePreference,
  };
}

async function apply(
  state: AppState,
  today: string,
  events: AdjustmentEvent[],
  completedCheckIn?: CheckIn,
) {
  if (!state.profile) return;
  const result = adjustPlan({
    today,
    sessions: state.sessions,
    library: exercises,
    checkIns: state.checkIns,
    blockedDates: state.profile.blockedDates,
    pausedAreas: state.profile.pausedAreas,
    equipment: state.profile.equipment,
    events,
  });
  // Claude sees only already-approved substitutes; quantities always remain engine-owned.
  const choices = new Map<string, Promise<string>>();
  for (const event of events) {
    if (
      event.type !== "checkin" ||
      event.checkIn.pain !== "mild" ||
      !event.checkIn.area ||
      event.checkIn.symptoms.length ||
      result.pausedAreas.includes("all") ||
      result.pausedAreas.includes(event.checkIn.area)
    )
      continue;
    const area = event.checkIn.area;
    for (const oldSession of state.sessions.filter(isUpcoming)) {
      const next = result.sessions.find((s) => s.id === oldSession.id);
      if (!next) continue;
      for (const oldPrescription of oldSession.exercises) {
        const original = exercises.find(
          (e) => e.id === oldPrescription.exerciseId,
        );
        if (!original?.loadedAreas.includes(area)) continue;
        const whitelist = approvedCandidates(
          original.id,
          area,
          state.profile.equipment,
          result.pausedAreas,
        );
        if (!whitelist.length) continue;
        const key = `${original.id}:${area}`;
        if (!choices.has(key))
          choices.set(key, chooseSwap(original, whitelist));
        const selected = await choices.get(key)!;
        const ruleSlot = next.exercises.find((p) =>
          whitelist.some((e) => e.id === p.exerciseId),
        );
        if (ruleSlot)
          Object.assign(
            ruleSlot,
            prescriptionForSwap(
              ruleSlot,
              whitelist.find((e) => e.id === selected)!,
            ),
          );
      }
    }
  }
  for (const change of result.changes) {
    // Refresh snapshots after a validated whitelist choice without exposing planning to Claude.
    if (/swap|pain_mild|mild_pain/i.test(change.reason_code)) {
      change.after = result.sessions.filter((s) =>
        change.affected_sessions.includes(s.id),
      );
    }
    change.explanation = await explainChange(change);
  }
  await db.$transaction(async (tx) => {
    for (const s of result.sessions) {
      await tx.session.update({
        where: { id: s.id },
        data: {
          date: s.date,
          status: s.status,
          restart: !!s.restart,
          missed: !!s.missed,
          missedWeek: s.missedWeek ?? null,
          prescriptions: JSON.stringify(s.exercises),
        },
      });
    }
    const userId = await ownerOf(state.program.id);
    await tx.profile.update({
      where: { userId },
      data: {
        pausedAreas: JSON.stringify(result.pausedAreas),
        blockedDates: JSON.stringify(result.blockedDates),
      },
    });
    for (const c of result.changes)
      await tx.planChange.create({
        data: {
          programId: state.program.id,
          type: c.type,
          reasonCode: c.reason_code,
          affectedSessions: JSON.stringify(c.affected_sessions),
          before: JSON.stringify(c.before ?? null),
          after: JSON.stringify(c.after ?? null),
          explanation:
            c.explanation ?? "Your plan has been adjusted to fit your week.",
        },
      });
    if (completedCheckIn)
      await tx.checkIn.create({
        data: {
          userId,
          sessionId: completedCheckIn.sessionId,
          date: completedCheckIn.date,
          energy: completedCheckIn.energy,
          pain: completedCheckIn.pain,
          area: completedCheckIn.area,
          symptoms: JSON.stringify(completedCheckIn.symptoms),
        },
      });
    for (const event of events)
      if (
        event.type === "checkin" &&
        event.checkIn.sessionId.startsWith("safety-")
      ) {
        const c = event.checkIn;
        await tx.checkIn.create({
          data: {
            userId,
            date: c.date,
            energy: c.energy,
            pain: c.pain,
            area: c.area,
            symptoms: JSON.stringify(c.symptoms),
          },
        });
      }
  });
}
async function ownerOf(programId: string) {
  return (
    await db.program.findUniqueOrThrow({
      where: { id: programId },
      select: { userId: true },
    })
  ).userId;
}
export async function getState(
  userId: string,
  today: string,
  detectOverdue = false,
) {
  const state = await load(userId, today);
  if (detectOverdue && !state.demo) {
    const missed = state.sessions.filter(
      (s) => isUpcoming(s) && s.date < today,
    );
    if (missed.length) {
      await apply(state, today, [
        { type: "missed", sessionIds: missed.map((s) => s.id) },
      ]);
      return load(userId, today);
    }
  }
  return state;
}
export async function runAction(
  userId: string,
  input: Action,
): Promise<AppState> {
  const today = input.today;
  if (input.action === "disclaimer") {
    await db.user.update({
      where: { id: userId },
      data: { disclaimerAccepted: true },
    });
    return load(userId, today);
  }
  if (input.action === "theme") {
    if (await db.profile.findUnique({ where: { userId } })) {
      await db.profile.update({
        where: { userId },
        data: { themePreference: input.preference },
      });
    }
    return load(userId, today);
  }
  if (input.action === "onboard") {
    const previousProfile = await db.profile.findUnique({ where: { userId } });
    const pausedAreas = previousProfile
      ? parse<string[]>(previousProfile.pausedAreas)
      : [];
    const profile: Profile = {
      goal: input.goal,
      days: input.days,
      equipment: input.equipment,
      experience: input.experience,
      limitations: input.limitations,
      pausedAreas,
      blockedDates: [],
      themePreference: (previousProfile?.themePreference ||
        "system") as ThemePreference,
    };
    const generated = generateProgram(profile, today, crypto.randomUUID());
    for (const s of generated.sessions)
      s.exercises = s.exercises.filter((p) => {
        const e = exercises.find((x) => x.id === p.exerciseId)!;
        return (
          !pausedAreas.includes("all") &&
          !e.loadedAreas.some((a) => pausedAreas.includes(a))
        );
      });
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { name: input.name, disclaimerAccepted: true },
      });
      await tx.program.updateMany({
        where: { userId, active: true },
        data: { active: false },
      });
      const fields = {
        goal: profile.goal,
        days: profile.days,
        equipment: profile.equipment,
        experience: profile.experience,
        limitations: JSON.stringify(profile.limitations),
        pausedAreas: JSON.stringify(pausedAreas),
        blockedDates: "[]",
        themePreference: profile.themePreference || "system",
      };
      await tx.profile.upsert({
        where: { userId },
        create: { userId, ...fields },
        update: fields,
      });
      await tx.program.create({
        data: {
          userId,
          title: generated.title,
          startDate: today,
          sessions: {
            create: generated.sessions.map((s) => ({
              id: s.id,
              date: s.date,
              title: s.title,
              week: s.week,
              status: s.status,
              prescriptions: JSON.stringify(s.exercises),
            })),
          },
        },
      });
    });
    return load(userId, today);
  }
  let state = await getState(userId, today, true);
  if (state.demo)
    throw new Error("Make the plan yours with the quick setup first.");
  if (input.action === "safety") {
    if (input.pain !== "sharp" && !input.symptoms.length)
      throw new Error("Choose the symptom you want to report.");
    await apply(state, today, [
      {
        type: "checkin",
        checkIn: {
          sessionId: `safety-${crypto.randomUUID()}`,
          date: today,
          energy: input.energy,
          pain: input.pain,
          area: input.area,
          symptoms: input.symptoms,
        },
      },
    ]);
    return load(userId, today);
  }
  if (input.action === "clear-pause") {
    const profile = state.profile!;
    if (!profile.pausedAreas.includes(input.area))
      throw new Error("This area is not paused.");
    const pausedAreas = profile.pausedAreas.filter((a) => a !== input.area);
    const template = generateProgram(
      { ...profile, pausedAreas },
      state.program.startDate,
      "reviewed",
    );
    const before = state.sessions.filter(isUpcoming);
    const restored = before.map((s) => {
      const slot = /-d(\d+)$/.exec(s.id);
      const generated = slot
        ? template.sessions.find(
            (t) => t.week === s.week && t.id.endsWith(`-d${slot[1]}`),
          )
        : template.sessions.find(
            (t) => t.week === s.week && t.title === s.title,
          );
      return {
        ...s,
        restart: true,
        exercises: (generated?.exercises ?? s.exercises).map((p) => ({
          ...p,
          baseSets: p.sets,
          volumeFactor: 0.7,
          sets: Math.max(1, Math.round(p.sets * 0.7)),
          weight: Math.round(p.weight * 0.7 * 100) / 100,
        })),
      };
    });
    await db.$transaction(async (tx) => {
      await tx.profile.update({
        where: { userId },
        data: { pausedAreas: JSON.stringify(pausedAreas) },
      });
      for (const s of restored)
        await tx.session.update({
          where: { id: s.id },
          data: {
            prescriptions: JSON.stringify(s.exercises),
            restart: true,
            prepared: true,
          },
        });
      await tx.planChange.create({
        data: {
          programId: state.program.id,
          type: "reviewed_return",
          reasonCode: "CLINICIAN_REVIEW_RESTART",
          affectedSessions: JSON.stringify(restored.map((s) => s.id)),
          before: JSON.stringify({
            pausedAreas: profile.pausedAreas,
            sessions: before,
          }),
          after: JSON.stringify({
            pausedAreas,
            sessions: restored,
            clinicianReviewed: true,
          }),
          explanation:
            "You confirmed clinician guidance for returning, so your upcoming workouts restart at 70% of the starting sets and weights.",
        },
      });
    });
    return load(userId, today);
  }
  const sessionId = "sessionId" in input ? input.sessionId : undefined;
  const session = sessionId
    ? state.sessions.find((s) => s.id === sessionId)
    : undefined;
  if (sessionId && !session)
    throw new Error("That session is not part of your active plan.");
  if (input.action === "log") {
    if (!session || !isUpcoming(session))
      throw new Error("Only upcoming workouts can be logged.");
    if (session.date > today)
      throw new Error("Move this workout to today before logging it.");
    const p = session.exercises.find(
      (p) => p.exerciseId === input.entry.exerciseId,
    );
    if (!p || input.entry.setIndex >= p.sets)
      throw new Error("This set is not prescribed in your current workout.");
    const exercise = exercises.find((e) => e.id === p.exerciseId)!;
    if (
      state.profile?.pausedAreas.includes("all") ||
      exercise.loadedAreas.some((a) => state.profile?.pausedAreas.includes(a))
    )
      throw new Error(
        "Planning is paused for this area; please seek clinician advice.",
      );
    const { entry } = input;
    await db.setLog.upsert({
      where: {
        sessionId_exerciseId_setIndex: {
          sessionId: session.id,
          exerciseId: entry.exerciseId,
          setIndex: entry.setIndex,
        },
      },
      create: { sessionId: session.id, ...entry },
      update: entry,
    });
  } else if (input.action === "finish") {
    if (!session) throw new Error("Choose a workout first.");
    if (session.status === "done") return state;
    if (!isUpcoming(session) || session.date !== today)
      throw new Error(
        "Only today’s upcoming workout can be completed; report symptoms separately.",
      );
    const hasSafety = input.pain === "sharp" || input.symptoms.length > 0;
    const prescribed = session.exercises.reduce((n, p) => n + p.sets, 0);
    const logged = state.logs.filter((l) => l.sessionId === session.id).length;
    if (!hasSafety && (!logged || logged < prescribed))
      throw new Error("Log or skip each set before finishing your workout.");
    if (hasSafety) {
      await apply(state, today, [
        {
          type: "checkin",
          checkIn: {
            sessionId: `safety-${crypto.randomUUID()}`,
            date: today,
            energy: input.energy,
            pain: input.pain,
            area: input.area,
            symptoms: input.symptoms,
          },
        },
      ]);
      return load(userId, today);
    }
    const checkIn: CheckIn = {
      sessionId: session.id,
      date: today,
      energy: input.energy,
      pain: input.pain,
      area: input.area,
      symptoms: input.symptoms,
    };
    const events: AdjustmentEvent[] = [{ type: "checkin", checkIn }];
    const performances: Performance[] = state.sessions
      .filter((s) => s.status === "done" || s.id === session.id)
      .flatMap((s) =>
        s.exercises.map((p) => ({
          sessionId: s.id,
          date: s.id === session.id ? today : s.date,
          exerciseId: p.exerciseId,
          prescribedReps: p.reps,
          prescribedSets: p.sets,
          targetRpe: p.targetRpe,
          logs: state.logs.filter(
            (l) => l.sessionId === s.id && l.exerciseId === p.exerciseId,
          ),
        })),
      );
    if (!hasSafety)
      events.push({
        type: "progression",
        performances: performances.filter((p) =>
          session.exercises.some((e) => e.exerciseId === p.exerciseId),
        ),
      });
    // Engine receives completed status so it only adapts remaining sessions.
    state = {
      ...state,
      sessions: state.sessions.map((s) =>
        s.id === session.id ? { ...s, status: "done" } : s,
      ),
    };
    await apply(state, today, events, checkIn);
  } else if (input.action === "miss") {
    for (const id of input.sessionIds)
      if (!state.sessions.some((s) => s.id === id && isUpcoming(s)))
        throw new Error("Choose an upcoming session.");
    await apply(state, today, [
      { type: "missed", sessionIds: input.sessionIds },
    ]);
  } else if (input.action === "availability") {
    const gap = dayGap(input.start, input.end);
    if (input.start < today || gap < 0 || gap > 90)
      throw new Error("Choose a future range of at most 91 days.");
    const dates = Array.from({ length: gap + 1 }, (_, i) =>
      addDays(input.start, i),
    );
    await apply(state, today, [
      { type: "availability", dates, kind: input.kind },
    ]);
  } else if (input.action === "move") {
    if (!session || !isUpcoming(session) || input.date < today)
      throw new Error("Only upcoming sessions can move to today or later.");
    await apply(state, today, [
      { type: "move", sessionId: session.id, date: input.date },
    ]);
  } else if (input.action === "resume") {
    if (!session || !isUpcoming(session) || session.date > today)
      throw new Error("Choose today’s upcoming workout.");
    const row = await db.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    if (!row.prepared) {
      const completed = state.sessions
        .filter((s) => s.status === "done")
        .sort((a, b) => b.date.localeCompare(a.date));
      if (completed[0]) {
        const working: Record<string, number> = {};
        for (const s of [...completed].reverse())
          for (const l of state.logs.filter(
            (l) => l.sessionId === s.id && l.status === "done",
          ))
            working[l.exerciseId] = l.weight;
        await apply(state, today, [
          {
            type: "resume",
            lastCompletedDate: completed[0].date,
            lastWorkingWeights: working,
          },
        ]);
      }
      await db.session.update({
        where: { id: session.id },
        data: { prepared: true },
      });
    }
  }
  return load(userId, today);
}
