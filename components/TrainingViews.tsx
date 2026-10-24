"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Dumbbell,
  HeartPulse,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import type { Exercise, SetEntry, TrainingSession } from "@/lib/domain";
import { areas } from "@/lib/validation";
import { PageHeading, Pill, type ViewProps } from "./ui";

const DRAFT_STORAGE_KEY = "rebound:training-drafts:v1";
const DEMO_LOG_STORAGE_KEY = "rebound:demo-set-logs:v1";
const REFERRAL_MESSAGE =
  "Please stop exercising and contact a qualified clinician promptly. If you have chest pain, dizziness, severe symptoms, or feel unsafe, seek urgent medical care.";
const SYMPTOMS = [
  "numbness",
  "chest pain",
  "dizziness",
  "recent injury",
  "trauma",
] as const;

type LoggedSet = SetEntry & { sessionId: string };
type Drafts = Record<string, SetEntry>;
type ResumeState = "waiting" | "ready" | "failed";

function setKey(sessionId: string, exerciseId: string, setIndex: number) {
  return `${sessionId}:${exerciseId}:${setIndex}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Draft persistence is optional; the current form remains usable if storage is unavailable.
  }
}

function locationSessionId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("session");
}

function initialEntry(
  exerciseId: string,
  setIndex: number,
  weight: number,
  reps: number,
  targetRpe: number,
): SetEntry {
  return { exerciseId, setIndex, weight, reps, rpe: targetRpe, status: "done" };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getExercise(library: Exercise[], exerciseId: string) {
  return library.find((exercise) => exercise.id === exerciseId);
}

function buildLogMap(entries: LoggedSet[]) {
  return entries.reduce<Record<string, LoggedSet>>((map, entry) => {
    map[setKey(entry.sessionId, entry.exerciseId, entry.setIndex)] = entry;
    return map;
  }, {});
}

function SafetyPause({ areas: pausedAreas }: { areas: string[] }) {
  if (!pausedAreas.length) return null;
  return (
    <aside className="training-pause-banner" aria-label="Paused training areas">
      <Pause size={18} aria-hidden="true" />
      <div>
        <strong>Training is paused for {pausedAreas.join(", ")}.</strong>
        <p>
          Your plan already omits affected work. We won’t suggest workarounds.
        </p>
      </div>
    </aside>
  );
}

export function WorkoutView({
  state,
  today,
  busy,
  mutate,
  notify,
  navigate,
}: ViewProps) {
  const requestedSessionId = locationSessionId();
  const [drafts, setDrafts] = useState<Drafts>(() =>
    readJson<Drafts>(DRAFT_STORAGE_KEY, {}),
  );
  const [demoLogs, setDemoLogs] = useState<LoggedSet[]>(() =>
    readJson<LoggedSet[]>(DEMO_LOG_STORAGE_KEY, []),
  );
  const [committedLogs, setCommittedLogs] = useState<LoggedSet[]>([]);
  const [restSeconds, setRestSeconds] = useState(90);
  const [restRunning, setRestRunning] = useState(false);
  const [resumeState, setResumeState] = useState<ResumeState>(
    state.demo ? "ready" : "waiting",
  );
  const resumeAttempted = useRef(false);

  const upcoming = useMemo(
    () =>
      [...state.sessions]
        .filter(
          (session) =>
            session.status === "planned" || session.status === "moved",
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [state.sessions],
  );
  const todaySession = upcoming.find((session) => session.date === today);
  const queriedSession = requestedSessionId
    ? upcoming.find((session) => session.id === requestedSessionId)
    : undefined;
  const session = queriedSession ?? todaySession ?? upcoming[0] ?? null;
  const isToday = Boolean(session && session.date === today);
  const personalActionable =
    !state.demo && Boolean(session && isToday && session.exercises.length);
  const allPaused = Boolean(
    session &&
      state.profile?.pausedAreas.length &&
      session.exercises.length === 0,
  );

  useEffect(() => {
    writeJson(DRAFT_STORAGE_KEY, drafts);
  }, [drafts]);

  useEffect(() => {
    if (!state.demo) return;
    setDemoLogs(readJson<LoggedSet[]>(DEMO_LOG_STORAGE_KEY, []));
  }, [state.demo]);

  useEffect(() => {
    if (
      state.demo ||
      !personalActionable ||
      !session ||
      resumeAttempted.current
    )
      return;
    resumeAttempted.current = true;
    mutate({ action: "resume", sessionId: session.id })
      .then((result) => {
        if (result) setResumeState("ready");
        else {
          setResumeState("failed");
          notify(
            "We could not resume this workout. Please try again from your schedule.",
          );
        }
      })
      .catch(() => {
        setResumeState("failed");
        notify(
          "We could not resume this workout. Please try again from your schedule.",
        );
      });
  }, [mutate, notify, personalActionable, session?.id, state.demo]);

  useEffect(() => {
    if (!restRunning) return;
    const timer = window.setInterval(() => {
      setRestSeconds((seconds) => {
        if (seconds <= 1) {
          setRestRunning(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [restRunning]);

  const sessionLogs = useMemo(() => {
    if (!session) return [];
    const serverLogs = state.logs.filter(
      (entry) => entry.sessionId === session.id,
    );
    return Object.values(
      buildLogMap([
        ...serverLogs,
        ...committedLogs,
        ...(state.demo
          ? demoLogs.filter((entry) => entry.sessionId === session.id)
          : []),
      ]),
    );
  }, [committedLogs, demoLogs, session, state.demo, state.logs]);
  const logMap = useMemo(() => buildLogMap(sessionLogs), [sessionLogs]);
  const totalSets =
    session?.exercises.reduce(
      (sum, prescription) => sum + prescription.sets,
      0,
    ) ?? 0;
  const loggedCount = Object.keys(logMap).length;
  const complete = totalSets > 0 && loggedCount === totalSets;
  const canLog = state.demo || (personalActionable && resumeState === "ready");

  const getDraft = (
    exerciseId: string,
    setIndex: number,
    weight: number,
    reps: number,
    targetRpe: number,
  ) => {
    if (!session)
      return initialEntry(exerciseId, setIndex, weight, reps, targetRpe);
    const key = setKey(session.id, exerciseId, setIndex);
    const savedLog = logMap[key];
    return (
      drafts[key] ??
      savedLog ??
      initialEntry(exerciseId, setIndex, weight, reps, targetRpe)
    );
  };

  const updateDraft = (
    exerciseId: string,
    setIndex: number,
    defaults: SetEntry,
    patch: Partial<SetEntry>,
  ) => {
    if (!session) return;
    const key = setKey(session.id, exerciseId, setIndex);
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? logMap[key] ?? defaults), ...patch },
    }));
  };

  const commitSet = async (entry: SetEntry) => {
    if (!session || !canLog) return;
    const key = setKey(session.id, entry.exerciseId, entry.setIndex);
    const exactEntry: SetEntry = {
      exerciseId: entry.exerciseId,
      setIndex: entry.setIndex,
      weight: clamp(entry.weight, 0, 500),
      reps: Math.round(clamp(entry.reps, 0, 100)),
      rpe: clamp(entry.rpe, 1, 10),
      status: entry.status,
    };
    if (state.demo) {
      const next = Object.values(
        buildLogMap([...demoLogs, { ...exactEntry, sessionId: session.id }]),
      );
      setDemoLogs(next);
      writeJson(DEMO_LOG_STORAGE_KEY, next);
      setRestSeconds(90);
      setRestRunning(true);
      return;
    }
    try {
      const result = await mutate({
        action: "log",
        sessionId: session.id,
        entry: exactEntry,
      });
      if (!result) return;
      setCommittedLogs((current) =>
        Object.values(
          buildLogMap([...current, { ...exactEntry, sessionId: session.id }]),
        ),
      );
      setRestSeconds(90);
      setRestRunning(true);
    } catch {
      notify(
        "That set was not saved. Please check your connection and try again.",
      );
    }
  };

  const goToCheckIn = () => {
    if (!session) return;
    navigate(`/check-in?session=${encodeURIComponent(session.id)}`);
  };

  const minutes = Math.floor(restSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (restSeconds % 60).toString().padStart(2, "0");
  const nextLabel = session ? `Next: ${formatDate(session.date)}` : undefined;

  if (!session || (!state.demo && !isToday)) {
    return (
      <main className="training-view training-workout">
        <PageHeading
          eyebrow="Training"
          title="Nothing to train today"
          subtitle={
            nextLabel
              ? `${nextLabel}. Keep the rhythm by checking your schedule.`
              : "Your next workout will appear here when it is scheduled."
          }
        />
        <SafetyPause areas={state.profile?.pausedAreas ?? []} />
        <section className="panel training-empty-panel empty-state">
          <Clock3 size={28} aria-hidden="true" />
          <h2>Use your schedule to plan the next session</h2>
          <p>Personal workouts can only be logged on their scheduled day.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate("/schedule")}
          >
            <ArrowRight size={17} /> View schedule
          </button>
        </section>
      </main>
    );
  }

  if (allPaused) {
    return (
      <main className="training-view training-workout">
        <PageHeading
          eyebrow="Training"
          title="Training is paused"
          subtitle="There is no substitute workout while your affected areas are paused."
        />
        <SafetyPause areas={state.profile?.pausedAreas ?? []} />
        <section className="panel training-empty-panel empty-state">
          <Pause size={28} aria-hidden="true" />
          <h2>There’s nothing to log right now</h2>
          <p>
            Your plan will remain clear of paused areas until it is updated.
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => navigate("/schedule")}
          >
            View schedule
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="training-view training-workout">
      <PageHeading
        eyebrow={state.demo ? "Example workout" : "Today’s training"}
        title={session.title}
        subtitle={
          state.demo
            ? "Adjust each set, log it, and see how a plan feels in practice."
            : `${formatDate(session.date)} · Week ${session.week}`
        }
        action={
          state.demo ? (
            <Pill tone="training-example-pill">Example</Pill>
          ) : (
            <Pill tone="training-live-pill">Live session</Pill>
          )
        }
      />
      <SafetyPause areas={state.profile?.pausedAreas ?? []} />

      <section
        className="training-progress panel"
        aria-label="Workout progress"
      >
        <div className="training-progress-copy">
          <span>Progress</span>
          <strong>
            {loggedCount} of {totalSets} sets logged
          </strong>
        </div>
        <div className="training-progress-track">
          <span
            style={{
              width: `${totalSets ? (loggedCount / totalSets) * 100 : 0}%`,
            }}
          />
        </div>
        {complete && (
          <p className="training-complete">
            <Check size={17} /> Every set is recorded. Finish with a check-in
            when you’re ready.
          </p>
        )}
        {!state.demo && resumeState === "waiting" && (
          <p className="training-resume-note">
            Preparing your session before set logging…
          </p>
        )}
        {!state.demo && resumeState === "failed" && (
          <button
            className="training-link-button"
            onClick={() => navigate("/schedule")}
          >
            Return to schedule
          </button>
        )}
      </section>

      <section className="training-exercise-list" aria-label="Exercises">
        {session.exercises.map((prescription, exerciseIndex) => {
          const exercise = getExercise(state.library, prescription.exerciseId);
          const exerciseName = exercise?.name ?? "Planned exercise";
          return (
            <article
              className="panel training-exercise"
              key={prescription.exerciseId}
            >
              <header className="training-exercise-head">
                <div className="training-exercise-number">
                  {String(exerciseIndex + 1).padStart(2, "0")}
                </div>
                <div>
                  <h2>{exerciseName}</h2>
                  <p>
                    {prescription.sets} sets × {prescription.reps} reps · target
                    RPE {prescription.targetRpe}
                  </p>
                </div>
                {exercise?.pattern && (
                  <Pill tone="training-pattern-pill">{exercise.pattern}</Pill>
                )}
              </header>
              <div className="training-set-list">
                {Array.from({ length: prescription.sets }, (_, setIndex) => {
                  const defaults = initialEntry(
                    prescription.exerciseId,
                    setIndex,
                    prescription.weight,
                    prescription.reps,
                    prescription.targetRpe,
                  );
                  const draft = getDraft(
                    prescription.exerciseId,
                    setIndex,
                    prescription.weight,
                    prescription.reps,
                    prescription.targetRpe,
                  );
                  const logged = Boolean(
                    logMap[
                      setKey(session.id, prescription.exerciseId, setIndex)
                    ],
                  );
                  return (
                    <div className="training-set-row" key={setIndex}>
                      <div className="training-set-label">
                        <span>Set</span>
                        <strong>{setIndex + 1}</strong>
                        {logged && <Check size={16} aria-label="Logged" />}
                      </div>
                      <label className="field">
                        <span>Weight, kg</span>
                        <input
                          aria-label={`${exerciseName} set ${setIndex + 1} weight in kilograms`}
                          type="number"
                          min="0"
                          max="500"
                          step={exercise?.increment ?? 0.5}
                          value={draft.weight}
                          onChange={(event) =>
                            updateDraft(
                              prescription.exerciseId,
                              setIndex,
                              defaults,
                              {
                                weight: clamp(
                                  Number(event.target.value),
                                  0,
                                  500,
                                ),
                              },
                            )
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Reps</span>
                        <input
                          aria-label={`${exerciseName} set ${setIndex + 1} reps`}
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={draft.reps}
                          onChange={(event) =>
                            updateDraft(
                              prescription.exerciseId,
                              setIndex,
                              defaults,
                              {
                                reps: Math.round(
                                  clamp(Number(event.target.value), 0, 100),
                                ),
                              },
                            )
                          }
                        />
                      </label>
                      <label className="field">
                        <span>RPE</span>
                        <input
                          aria-label={`${exerciseName} set ${setIndex + 1} RPE`}
                          type="number"
                          min="1"
                          max="10"
                          step="0.5"
                          value={draft.rpe}
                          onChange={(event) =>
                            updateDraft(
                              prescription.exerciseId,
                              setIndex,
                              defaults,
                              { rpe: clamp(Number(event.target.value), 1, 10) },
                            )
                          }
                        />
                      </label>
                      <div
                        className="training-status-control"
                        role="group"
                        aria-label={`${exerciseName} set ${setIndex + 1} status`}
                      >
                        <button
                          type="button"
                          className={
                            draft.status === "done" ? "is-selected" : ""
                          }
                          onClick={() =>
                            updateDraft(
                              prescription.exerciseId,
                              setIndex,
                              defaults,
                              { status: "done" },
                            )
                          }
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          className={
                            draft.status === "skipped" ? "is-selected" : ""
                          }
                          onClick={() =>
                            updateDraft(
                              prescription.exerciseId,
                              setIndex,
                              defaults,
                              { status: "skipped" },
                            )
                          }
                        >
                          Skip
                        </button>
                      </div>
                      <button
                        className="btn btn-secondary training-log-button"
                        disabled={!canLog || busy}
                        onClick={() => commitSet(draft)}
                      >
                        {logged ? "Update" : "Log set"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel training-rest" aria-label="Rest timer">
        <div className="training-rest-time">
          <Clock3 size={20} aria-hidden="true" />
          <div>
            <span>Rest timer</span>
            <strong>
              {minutes}:{seconds}
            </strong>
          </div>
        </div>
        <div className="training-rest-controls">
          <button
            className="icon-button"
            aria-label={restRunning ? "Pause rest timer" : "Start rest timer"}
            onClick={() => setRestRunning((running) => !running)}
          >
            {restRunning ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="Add 30 seconds to rest timer"
            onClick={() => setRestSeconds((seconds) => seconds + 30)}
          >
            <Plus size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Reset rest timer to 90 seconds"
            onClick={() => {
              setRestSeconds(90);
              setRestRunning(false);
            }}
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </section>

      <footer className="training-workout-actions">
        <button className="btn training-stop-button" onClick={goToCheckIn}>
          <AlertTriangle size={17} /> Report pain / stop
        </button>
        <button
          className="btn btn-primary"
          onClick={() => (state.demo ? navigate("/onboarding") : goToCheckIn())}
        >
          {state.demo ? "Make this plan yours" : "Finish & check in"}{" "}
          <ArrowRight size={17} />
        </button>
      </footer>
    </main>
  );
}

export function CheckInView({
  state,
  today,
  busy,
  mutate,
  notify,
  navigate,
}: ViewProps) {
  const requestedSessionId = locationSessionId();
  const session = useMemo(() => {
    const requested = requestedSessionId
      ? state.sessions.find((item) => item.id === requestedSessionId)
      : undefined;
    return (
      requested ??
      state.sessions.find((item) => item.date === today) ??
      state.sessions[0] ??
      null
    );
  }, [requestedSessionId, state.sessions, today]);
  const [energy, setEnergy] = useState(3);
  const [pain, setPain] = useState<"none" | "mild" | "sharp">("none");
  const [area, setArea] = useState<string>("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const needsReferral = pain === "sharp" || symptoms.length > 0;

  const toggleSymptom = (symptom: string) => {
    setSymptoms((current) =>
      current.includes(symptom)
        ? current.filter((item) => item !== symptom)
        : [...current, symptom],
    );
  };

  const submit = async () => {
    if (!session) return;
    try {
      const result = needsReferral
        ? await mutate({
            action: "safety",
            energy,
            pain: pain === "sharp" ? "sharp" : "none",
            ...(area ? { area: area as (typeof areas)[number] } : {}),
            symptoms: symptoms as (typeof SYMPTOMS)[number][],
          })
        : await mutate({
            action: "finish",
            sessionId: session.id,
            energy,
            pain,
            ...(area ? { area: area as (typeof areas)[number] } : {}),
            symptoms: symptoms as (typeof SYMPTOMS)[number][],
          });
      if (!result) return;
      notify(
        needsReferral
          ? "Your check-in was saved."
          : "Check-in saved. Your plan is up to date.",
      );
      navigate("/");
    } catch {
      notify("Your check-in was not saved. Please try again.");
    }
  };

  if (!session) {
    return (
      <main className="training-view training-checkin">
        <PageHeading
          eyebrow="Check-in"
          title="No session selected"
          subtitle="Choose a scheduled session before recording a check-in."
        />
        <section className="panel training-empty-panel empty-state">
          <HeartPulse size={28} />
          <h2>Start from your schedule</h2>
          <button
            className="btn btn-primary"
            onClick={() => navigate("/schedule")}
          >
            View schedule
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="training-view training-checkin">
      <PageHeading
        eyebrow="Post-workout check-in"
        title="How did that feel?"
        subtitle={`${session.title} · ${formatDate(session.date)}. Safety symptoms can be reported at any time; other check-ins complete today’s logged workout.`}
      />
      <section className="panel training-checkin-form">
        <fieldset className="training-choice-group">
          <legend>Energy today</legend>
          <p>Choose the number that feels most accurate.</p>
          <div className="training-energy-options">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className={energy === value ? "is-selected" : ""}
                onClick={() => setEnergy(value)}
                aria-pressed={energy === value}
              >
                <strong>{value}</strong>
                <span>
                  {["Very low", "Low", "Steady", "Good", "High"][value - 1]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="training-choice-group">
          <legend>Any pain during training?</legend>
          <div className="training-pain-options">
            {(["none", "mild", "sharp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={pain === value ? `is-selected is-${value}` : ""}
                onClick={() => setPain(value)}
                aria-pressed={pain === value}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="field training-area-field">
            <span>Area (optional)</span>
            <select
              value={area}
              onChange={(event) => setArea(event.target.value)}
            >
              <option value="">No area selected</option>
              {areas.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset className="training-choice-group">
          <legend>Anything else to note?</legend>
          <p>Select all that apply.</p>
          <div className="training-symptom-options">
            {SYMPTOMS.map((symptom) => (
              <button
                key={symptom}
                type="button"
                className={symptoms.includes(symptom) ? "is-selected" : ""}
                onClick={() => toggleSymptom(symptom)}
                aria-pressed={symptoms.includes(symptom)}
              >
                <span className="training-checkbox">
                  {symptoms.includes(symptom) && <Check size={14} />}
                </span>
                {symptom}
              </button>
            ))}
          </div>
        </fieldset>

        {needsReferral && (
          <aside className="training-referral" role="alert">
            <ShieldAlert size={21} aria-hidden="true" />
            <div>
              <strong>Clinician referral</strong>
              <p>{REFERRAL_MESSAGE}</p>
            </div>
          </aside>
        )}
        <button
          className="btn btn-primary training-submit-checkin"
          disabled={busy}
          onClick={submit}
        >
          Save check-in <ArrowRight size={17} />
        </button>
      </section>
    </main>
  );
}

function LineChart({ points }: { points: { date: string; weight: number }[] }) {
  const width = 640;
  const height = 220;
  const inset = { top: 18, right: 20, bottom: 38, left: 44 };
  const weights = points.map((point) => point.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = Math.max(maxWeight - minWeight, 1);
  const x = (index: number) =>
    inset.left +
    (points.length === 1
      ? (width - inset.left - inset.right) / 2
      : (index * (width - inset.left - inset.right)) / (points.length - 1));
  const y = (weight: number) =>
    height -
    inset.bottom -
    ((weight - minWeight) / range) * (height - inset.top - inset.bottom);
  const line = points
    .map((point, index) => `${x(index)},${y(point.weight)}`)
    .join(" ");
  return (
    <div
      className="training-chart-wrap"
      aria-label="Maximum completed weight by session"
    >
      <svg
        className="training-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={points
          .map((point) => `${formatDate(point.date)} ${point.weight} kg`)
          .join(", ")}
      >
        <line
          x1={inset.left}
          y1={inset.top}
          x2={inset.left}
          y2={height - inset.bottom}
        />
        <line
          x1={inset.left}
          y1={height - inset.bottom}
          x2={width - inset.right}
          y2={height - inset.bottom}
        />
        <text x={8} y={inset.top + 4}>
          {maxWeight} kg
        </text>
        <text x={8} y={height - inset.bottom}>
          {minWeight} kg
        </text>
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle cx={x(index)} cy={y(point.weight)} r="5" />
            <text x={x(index)} y={height - 12} textAnchor="middle">
              {formatDate(point.date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function HistoryView({ state }: ViewProps) {
  const [demoLogs, setDemoLogs] = useState<LoggedSet[]>(() =>
    readJson<LoggedSet[]>(DEMO_LOG_STORAGE_KEY, []),
  );
  const [selectedExerciseId, setSelectedExerciseId] = useState("");

  useEffect(() => {
    if (state.demo)
      setDemoLogs(readJson<LoggedSet[]>(DEMO_LOG_STORAGE_KEY, []));
  }, [state.demo]);

  const logs = useMemo(
    () =>
      Object.values(
        buildLogMap([...state.logs, ...(state.demo ? demoLogs : [])]),
      ),
    [demoLogs, state.demo, state.logs],
  );
  const doneLogs = useMemo(
    () => logs.filter((log) => log.status === "done"),
    [logs],
  );
  const exerciseIds = useMemo(
    () => [...new Set(doneLogs.map((log) => log.exerciseId))],
    [doneLogs],
  );
  const chartExerciseId =
    selectedExerciseId && exerciseIds.includes(selectedExerciseId)
      ? selectedExerciseId
      : (exerciseIds[0] ?? "");
  const sessionsWithLogs = useMemo(() => {
    const bySession = new Map<string, LoggedSet[]>();
    logs.forEach((log) =>
      bySession.set(log.sessionId, [
        ...(bySession.get(log.sessionId) ?? []),
        log,
      ]),
    );
    return [...bySession.entries()]
      .map(([sessionId, entries]) => ({
        session: state.sessions.find((item) => item.id === sessionId),
        entries,
      }))
      .filter(
        (item): item is { session: TrainingSession; entries: LoggedSet[] } =>
          Boolean(item.session),
      )
      .sort((a, b) => b.session.date.localeCompare(a.session.date));
  }, [logs, state.sessions]);
  const chartPoints = useMemo(() => {
    if (!chartExerciseId) return [];
    const bySession = new Map<string, { date: string; weight: number }>();
    doneLogs
      .filter((log) => log.exerciseId === chartExerciseId)
      .forEach((log) => {
        const session = state.sessions.find(
          (item) => item.id === log.sessionId,
        );
        if (!session) return;
        const current = bySession.get(log.sessionId);
        if (!current || log.weight > current.weight)
          bySession.set(log.sessionId, {
            date: session.date,
            weight: log.weight,
          });
      });
    return [...bySession.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [chartExerciseId, doneLogs, state.sessions]);
  const volume = doneLogs.reduce((sum, log) => sum + log.weight * log.reps, 0);
  const energyCheckIns = state.checkIns.filter((checkIn) =>
    logs.some((log) => log.sessionId === checkIn.sessionId),
  );
  const averageEnergy = energyCheckIns.length
    ? energyCheckIns.reduce((sum, checkIn) => sum + checkIn.energy, 0) /
      energyCheckIns.length
    : null;

  return (
    <main className="training-view training-history">
      <PageHeading
        eyebrow={state.demo ? "Example history" : "Training history"}
        title={state.demo ? "See the pattern take shape" : "Your recorded work"}
        subtitle={
          state.demo
            ? "Example data updates as you log the demo workout."
            : "Only completed set logs are shown here."
        }
      />
      {doneLogs.length === 0 ? (
        <section className="panel training-empty-panel empty-state">
          <BarChart3 size={28} aria-hidden="true" />
          <h2>
            {state.demo
              ? "No example sets logged yet"
              : "No completed sets yet"}
          </h2>
          <p>
            {state.demo
              ? "Log the example workout to see its chart and totals."
              : "Your actual set logs will appear here after a workout."}
          </p>
        </section>
      ) : (
        <>
          <section className="training-totals" aria-label="Training totals">
            <article className="panel">
              <span>Sessions</span>
              <strong>{sessionsWithLogs.length}</strong>
              <p>{state.demo ? "example sessions" : "with set logs"}</p>
            </article>
            <article className="panel">
              <span>Completed sets</span>
              <strong>{doneLogs.length}</strong>
              <p>status: done</p>
            </article>
            <article className="panel">
              <span>Volume</span>
              <strong>{Math.round(volume).toLocaleString()} kg</strong>
              <p>completed reps × weight</p>
            </article>
            <article className="panel">
              <span>Energy</span>
              <strong>
                {averageEnergy === null ? "—" : averageEnergy.toFixed(1)}
              </strong>
              <p>{averageEnergy === null ? "no check-ins" : "average / 5"}</p>
            </article>
          </section>
          <section className="panel training-history-chart">
            <header>
              <div>
                <p className="eyebrow">
                  {state.demo ? "Example chart" : "Strength record"}
                </p>
                <h2>Max completed weight per session</h2>
              </div>
              {state.demo && (
                <Pill tone="training-example-pill">Example data</Pill>
              )}
            </header>
            <label className="field">
              <span>Exercise</span>
              <select
                value={chartExerciseId}
                onChange={(event) => setSelectedExerciseId(event.target.value)}
              >
                {exerciseIds.map((id) => (
                  <option key={id} value={id}>
                    {getExercise(state.library, id)?.name ?? id}
                  </option>
                ))}
              </select>
            </label>
            {chartPoints.length > 0 && <LineChart points={chartPoints} />}
          </section>
          <section
            className="training-session-history"
            aria-label="Logged sessions"
          >
            <h2>Logged sessions</h2>
            {sessionsWithLogs.map(({ session, entries }) => {
              const done = entries.filter((entry) => entry.status === "done");
              const checkIn = state.checkIns.find(
                (item) => item.sessionId === session.id,
              );
              return (
                <article
                  className="panel training-history-session"
                  key={session.id}
                >
                  <div>
                    <p className="eyebrow">
                      {formatDate(session.date)} · Week {session.week}
                    </p>
                    <h3>{session.title}</h3>
                    <p>
                      {done.length} completed set{done.length === 1 ? "" : "s"}{" "}
                      ·{" "}
                      {
                        entries.filter((entry) => entry.status === "skipped")
                          .length
                      }{" "}
                      skipped
                    </p>
                  </div>
                  <div className="training-history-session-meta">
                    {checkIn && (
                      <Pill tone="training-energy-pill">
                        Energy {checkIn.energy}/5
                      </Pill>
                    )}
                    <Dumbbell size={20} aria-hidden="true" />
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
