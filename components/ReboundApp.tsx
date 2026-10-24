"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  ChartNoAxesCombined,
  House,
  Dumbbell,
  Repeat2,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Leaf,
  ShieldCheck,
  CircleHelp,
  SlidersHorizontal,
  Plane,
  HeartPulse,
  X,
  GripVertical,
  CircleCheck,
  Sparkles,
  Bell,
  MoreHorizontal,
  CreditCard,
} from "lucide-react";
import { addDays, monday, isUpcoming, dayGap } from "@/lib/domain";
import type {
  AppState,
  TrainingSession,
  Goal,
  Equipment,
  Profile,
  ThemePreference,
} from "@/lib/domain";
import { WorkoutView, CheckInView, HistoryView } from "./TrainingViews";
import SafetyNotice from "./SafetyNotice";
import BillingView from "./BillingView";
import ThemeToggle from "./ThemeToggle";
import { Pill, PageHeading, Modal, displayDate } from "./ui";
import type { ActionRequest, ViewProps } from "./ui";

const navItems = [
  { path: "/", label: "Today", icon: House },
  { path: "/schedule", label: "Schedule", icon: CalendarDays },
  { path: "/history", label: "History", icon: ChartNoAxesCombined },
  { path: "/program", label: "My program", icon: Dumbbell },
  { path: "/billing", label: "Rebound Plus", icon: CreditCard },
];
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const cleanTitle = (title: string) => title.replace(/^Demo · /, "");
export default function ReboundApp({ view = "today" }: { view?: string }) {
  const router = useRouter();
  const [state, setState] = useState<AppState | null>(null);
  const [today] = useState(localToday);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [offline, setOffline] = useState(false);
  const [help, setHelp] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("system");
  const notify = useCallback((message: string) => {
    setToast(message);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?today=${today}`, {
        cache: "no-store",
      });
      if (!res.ok) throw Error("Could not load your plan.");
      const data = (await res.json()) as AppState;
      setState(data);
      const savedTheme = localStorage.getItem(
        "rebound-theme",
      ) as ThemePreference | null;
      if (!savedTheme) setThemePreference(data.themePreference || "system");
      setOffline(false);
      setLoadError("");
      localStorage.setItem("rebound-state", JSON.stringify(data));
    } catch {
      const cache = localStorage.getItem("rebound-state");
      if (cache) {
        setState(JSON.parse(cache));
        setOffline(true);
      } else setLoadError("We couldn’t reach your plan. Please try again.");
    }
  }, [today]);
  useEffect(() => {
    const saved = localStorage.getItem(
      "rebound-theme",
    ) as ThemePreference | null;
    if (saved === "light" || saved === "dark" || saved === "system")
      setThemePreference(saved);
  }, []);
  useEffect(() => {
    void load();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, [load]);
  const mutate = useCallback(
    async (action: ActionRequest): Promise<AppState | null> => {
      setBusy(true);
      try {
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, today }),
        });
        const data = await res.json();
        if (!res.ok) throw Error(data.error || "Could not save this change.");
        setState(data);
        localStorage.setItem("rebound-state", JSON.stringify(data));
        setOffline(false);
        return data;
      } catch (e) {
        notify(
          e instanceof Error
            ? e.message
            : "Could not save this change. Your draft is still here.",
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [today, notify],
  );
  const changeTheme = useCallback(
    (value: ThemePreference) => {
      setThemePreference(value);
      localStorage.setItem("rebound-theme", value);
      document.documentElement.dataset.theme = value;
      if (state && !state.demo)
        void mutate({ action: "theme", preference: value });
    },
    [mutate, state],
  );
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const props: ViewProps | null = state
    ? { state, today, busy, mutate, notify, navigate }
    : null;
  const activePath = view === "today" ? "/" : `/${view}`;
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link href="/" className="wordmark">
          <span className="brand-mark">
            <Repeat2 size={23} strokeWidth={2.6} />
          </span>
          rebound<span className="brand-dot">.</span>
        </Link>
        <div className="nav-label">YOUR SPACE</div>
        <nav>
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              href={path}
              className={`nav-item ${activePath === path ? "active" : ""}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === "/" && <span className="nav-current-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="rail-note">
            <span className="rail-loop">
              <Repeat2 size={25} />
            </span>
            <h3>
              Life happens.
              <br />
              Keep coming back.
            </h3>
            <p>A flexible plan for a beautifully unpredictable life.</p>
          </div>
          <button className="nav-item help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
            Help & safety
          </button>
          <Link href="/onboarding" className="profile-chip">
            <span className="avatar">{state?.name.slice(0, 1) || "R"}</span>
            <span>
              <strong>
                {state?.demo ? "Alex · example" : state?.name || "Your profile"}
              </strong>
              <small>
                {state?.demo
                  ? "Explore your next chapter"
                  : "Your strength journey"}
              </small>
            </span>
            <SlidersHorizontal size={16} />
          </Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Your space <span>/</span>{" "}
            <strong>
              {view === "today"
                ? "Today"
                : view === "check-in"
                  ? "Check-in"
                  : view === "onboarding"
                    ? "Build your plan"
                    : view === "program"
                      ? "My program"
                      : view[0]?.toUpperCase() + view.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="live-status">
              <i />
              Your plan is flexible
            </span>
            <ThemeToggle value={themePreference} onChangeAction={changeTheme} />
            <button
              className="icon-button notification-button"
              aria-label="What changed and why"
              onClick={() => setChangesOpen(true)}
            >
              <Bell size={19} />
              {!!state?.changes.length && <span />}
            </button>
            <button
              className="avatar top-avatar"
              aria-label="Edit your plan"
              onClick={() => navigate("/onboarding")}
            >
              {state?.name.slice(0, 1) || "R"}
            </button>
          </div>
        </header>
        <main
          className={`main-content ${view === "onboarding" ? "onboarding-main" : ""}`}
        >
          {offline && (
            <div className="offline-banner">
              You’re viewing your last saved plan. Reconnect before saving a
              workout; drafts stay on this device.
            </div>
          )}
          {!state ? (
            <div className="loading-state">
              {loadError ? (
                <>
                  <h2>Let’s try that again.</h2>
                  <p>{loadError}</p>
                  <button
                    className="btn btn-primary"
                    onClick={() => void load()}
                  >
                    Reload plan
                  </button>
                </>
              ) : (
                <>
                  <span className="brand-mark loading-mark">
                    <Repeat2 />
                  </span>
                  <p>Making room for your next workout…</p>
                </>
              )}
            </div>
          ) : (
            props && (
              <>
                {view === "today" && <Dashboard {...props} />}
                {view === "schedule" && <Schedule {...props} />}
                {view === "program" && <Program {...props} />}
                {view === "onboarding" && <Onboarding {...props} />}
                {view === "workout" && <WorkoutView {...props} />}
                {view === "check-in" && <CheckInView {...props} />}
                {view === "history" && <HistoryView {...props} />}
                {view === "billing" && <BillingView notifyAction={notify} />}
              </>
            )
          )}
        </main>
        <footer className="app-footer">
          <span>Progress isn’t a straight line. We’re here for all of it.</span>
          <span>Made for real life.</span>
        </footer>
      </div>
      <nav className="mobile-nav">
        {navItems.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            href={path}
            className={activePath === path ? "active" : ""}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={19} />
          <span>{toast}</span>
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal
          title="A little care goes a long way"
          onClose={() => setHelp(false)}
        >
          <div className="safety-icon">
            <ShieldCheck />
          </div>
          <p>
            Rebound is not medical advice. Plans are guides, not obligations.
            Stop training if you experience sharp pain, numbness, chest pain,
            dizziness, or a recent injury, and speak with a clinician.
          </p>
          <p>
            For severe or ongoing symptoms, seek urgent medical care. Rebound
            never offers medication advice or substitutes around a safety pause.
          </p>
          <button className="btn btn-primary" onClick={() => setHelp(false)}>
            Got it
          </button>
        </Modal>
      )}
      {changesOpen && state && (
        <Modal
          title="What changed and why"
          onClose={() => setChangesOpen(false)}
        >
          <ChangeList state={state} />
        </Modal>
      )}
    </div>
  );
}

function ChangeList({ state }: { state: AppState }) {
  return (
    <div className="change-list">
      {state.changes.length ? (
        state.changes.map((c) => (
          <div key={c.id || c.reason_code} className="change-entry">
            <span className="change-dot">
              <Repeat2 size={16} />
            </span>
            <div>
              <p>{c.explanation}</p>
              <small>
                {c.affected_sessions.length} session
                {c.affected_sessions.length === 1 ? "" : "s"} adjusted{" "}
                <span>·</span>{" "}
                {c.createdAt
                  ? displayDate(c.createdAt.slice(0, 10))
                  : "Just now"}
              </small>
            </div>
          </div>
        ))
      ) : (
        <p>
          No changes yet. When life gets in the way, your plan will adapt here.
        </p>
      )}
    </div>
  );
}
function Dashboard(props: ViewProps) {
  const { state, today, navigate, busy, mutate } = props;
  const [showChanges, setShowChanges] = useState(false);
  const weekStart = monday(today),
    days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekSessions = state.sessions.filter(
    (s) => s.date >= weekStart && s.date <= days[6],
  );
  const completed = weekSessions.filter((s) => s.status === "done").length;
  const target = state.profile?.days || 3;
  const workout =
    state.sessions.find((s) => isUpcoming(s) && s.date === today) ??
    state.sessions.find((s) => isUpcoming(s) && s.date > today);
  const isToday = workout?.date === today;
  const firstChange = state.changes[0];
  const energy = state.checkIns.at(-1)?.energy;
  const planWeek = Math.min(
    4,
    Math.max(1, Math.floor(dayGap(state.program.startDate, today) / 7) + 1),
  );
  return (
    <>
      <PageHeading
        eyebrow={displayDate(today, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        title={`Good to see you, ${state.name}.`}
        subtitle="A little progress. A little flexibility. All yours."
        action={
          <button
            className="btn btn-secondary heading-action"
            onClick={() => navigate("/schedule")}
          >
            <CalendarDays size={16} />
            Adjust my week
          </button>
        }
      />
      {state.demo && (
        <div className="demo-banner">
          <span>
            <Sparkles size={16} />
            <strong>A little look at what’s possible.</strong> You’re exploring
            an example plan.
          </span>
          <Link href="/onboarding">
            Make it yours <ArrowRight size={16} />
          </Link>
        </div>
      )}
      <SafetyNotice {...props} />
      <div className="dashboard-columns">
        <div className="primary-column">
          <section className="panel week-panel">
            <div className="section-row">
              <div>
                <h2>Your week, at a glance</h2>
                <p className="muted">Room to train. Room for life.</p>
              </div>
              <Pill>Week {planWeek} of 4</Pill>
            </div>
            <div className="week-strip">
              {days.map((d) => {
                const s = weekSessions.find(
                  (s) => s.date === d && s.status !== "skipped",
                );
                return (
                  <button
                    className={`day-capsule ${d === today ? "today" : ""} ${s?.status === "done" ? "completed" : ""}`}
                    key={d}
                    onClick={() =>
                      navigate(s ? `/schedule?day=${d}` : "/schedule")
                    }
                    aria-label={`${displayDate(d, { weekday: "long" })}: ${s ? cleanTitle(s.title) : "recovery day"}`}
                  >
                    <span className="day-label">
                      {displayDate(d, { weekday: "short" }).slice(0, 3)}
                    </span>
                    <strong>{Number(d.slice(-2))}</strong>
                    <span className="day-status">
                      {s?.status === "done" ? (
                        <Check size={16} />
                      ) : s ? (
                        <Dumbbell size={16} />
                      ) : (
                        <span className="rest-dash">—</span>
                      )}
                    </span>
                    {d === today && <i />}
                  </button>
                );
              })}
            </div>
            <div className="week-legend">
              <span>
                <i className="legend-done" />
                Completed
              </span>
              <span>
                <i className="legend-planned" />
                Planned
              </span>
              <span>
                <i className="legend-rest" />
                Recovery
              </span>
              <strong>
                {completed} of {target} sessions
              </strong>
            </div>
          </section>
          <section className="panel workout-preview">
            <div className="workout-feature">
              <div className="feature-copy">
                <div className="feature-tags">
                  <Pill tone="light">
                    {isToday ? "TODAY’S WORKOUT" : "UP NEXT"}
                  </Pill>
                  {workout?.restart && <Pill tone="peach">Easing back in</Pill>}
                </div>
                <h2>
                  {workout ? cleanTitle(workout.title) : "A day to recharge."}
                </h2>
                <p>
                  {isToday
                    ? "Show up as you are. Your plan has the rest."
                    : workout
                      ? `Your next session is ${displayDate(workout.date, { weekday: "long", month: "short", day: "numeric" })}. Today, leave room for recovery.`
                      : "You’ve reached the end of your plan. Take a moment to see how far you’ve come."}
                </p>
                <div className="workout-meta">
                  <span>
                    <Dumbbell size={15} />
                    {workout?.exercises.length || 0} exercises
                  </span>
                  <span>
                    <Clock3 size={15} />
                    {workout ? workout.exercises.length * 7 : 0}–
                    {workout ? workout.exercises.length * 9 : 0} min
                  </span>
                  <span>
                    {state.profile?.equipment === "gym"
                      ? "Full gym"
                      : state.profile?.equipment === "bodyweight"
                        ? "Bodyweight"
                        : "Dumbbells"}
                  </span>
                </div>
              </div>
              <div
                className="equipment-photo"
                role="img"
                aria-label="A pair of dumbbells ready for a workout"
              />
            </div>
            {workout && (
              <div className="exercise-preview-list">
                {workout.exercises.slice(0, 3).map((p, i) => {
                  const e = state.library.find((e) => e.id === p.exerciseId);
                  return (
                    <div className="exercise-preview" key={p.exerciseId}>
                      <span className="exercise-number">0{i + 1}</span>
                      <div>
                        <strong>{e?.name}</strong>
                        <small>{e?.pattern.replaceAll("-", " ")}</small>
                      </div>
                      <span>
                        {p.sets} × {p.reps}
                        <small>
                          {p.weight ? p.weight + " kg" : "Bodyweight"}
                        </small>
                      </span>
                    </div>
                  );
                })}
                {workout.exercises.length > 3 && (
                  <p className="more-exercises">
                    + {workout.exercises.length - 3} more exercises{" "}
                    <span>·</span> A balanced session, just for you
                  </p>
                )}
              </div>
            )}
            <div className="workout-preview-bottom">
              <span>
                <ShieldCheck size={16} />
                Your pace. Your progress.
              </span>
              <button
                className="btn btn-primary"
                onClick={() =>
                  navigate(
                    isToday && workout
                      ? `/workout?session=${workout.id}`
                      : workout
                        ? "/schedule"
                        : "/onboarding",
                  )
                }
              >
                {isToday
                  ? "Start workout"
                  : workout
                    ? "See my schedule"
                    : "Build my next plan"}
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
          <section className="adaptation-card">
            <div className="adaptation-heading">
              <span className="adaptation-icon">
                <Repeat2 size={22} />
              </span>
              <div>
                <p className="eyebrow">A PLAN THAT LISTENS</p>
                <h2>What changed and why</h2>
              </div>
              <Pill tone="peach">
                {state.changes.length ? "Plan adapted" : "All set"}
              </Pill>
            </div>
            <p className="adaptation-reason">
              {firstChange?.explanation ||
                "Your plan is ready when you are. When your week changes, we’ll adjust the next steps together."}
            </p>
            <div className="adaptation-bottom">
              <span>
                <i />
                Same goal. A more flexible way there.
              </span>
              <button onClick={() => setShowChanges(true)}>
                See changes <ArrowUpRight size={16} />
              </button>
            </div>
          </section>
        </div>
        <aside className="context-column">
          <section className="panel momentum-panel">
            <div className="section-row">
              <h2>A little momentum</h2>
              <Leaf size={19} />
            </div>
            <p className="muted">Small steps still move you forward.</p>
            <div
              className="progress-ring"
              style={
                {
                  "--progress": `${Math.min(100, (completed / target) * 100)}%`,
                } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {completed}
                  <span> / {target}</span>
                </strong>
                <small>sessions this week</small>
              </div>
            </div>
            <p className="momentum-line">
              {completed > 0
                ? "You’re finding your rhythm."
                : "Your next chapter starts with one set."}
            </p>
            <div className="momentum-stats">
              <div>
                <span>Last check-in</span>
                <strong>
                  {energy ? energy + " / 5" : "Not yet"}
                  <small>{energy ? "Energy" : "Make it yours"}</small>
                </strong>
              </div>
              <div>
                <span>Plan length</span>
                <strong>
                  4 weeks<small>One day at a time</small>
                </strong>
              </div>
            </div>
          </section>
          <section className="mindset-card">
            <span className="small-spark">
              <Sparkles size={21} />
            </span>
            <p className="eyebrow">A GENTLE REMINDER</p>
            <h3>
              Consistency isn’t
              <br />
              never missing.
              <br />
              <em>It’s coming back.</em>
            </h3>
            <p>A missed day doesn’t erase the days you showed up.</p>
            <span className="mindset-line" />
          </section>
          <section className="next-card">
            <p className="eyebrow">LOOKING AHEAD</p>
            {state.sessions
              .filter((s) => isUpcoming(s) && s.date > today)
              .slice(0, 2)
              .map((s) => (
                <button key={s.id} onClick={() => navigate("/schedule")}>
                  <span className="next-day">
                    <strong>{displayDate(s.date, { weekday: "short" })}</strong>
                    <small>{Number(s.date.slice(-2))}</small>
                  </span>
                  <span>
                    <strong>{cleanTitle(s.title)}</strong>
                    <small>
                      {s.exercises.length} exercises · Your usual pace
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            <Link href="/schedule">
              See your whole week <ArrowRight size={15} />
            </Link>
          </section>
        </aside>
      </div>
      {!state.disclaimerAccepted && !state.demo && (
        <div className="disclaimer-inline">
          <ShieldCheck size={18} />
          <p>
            Rebound is not medical advice. Please seek clinician guidance for
            pain or injury.
          </p>
          <button
            disabled={busy}
            onClick={() => void mutate({ action: "disclaimer" })}
          >
            I understand
          </button>
        </div>
      )}
      {showChanges && (
        <Modal
          title="What changed and why"
          onClose={() => setShowChanges(false)}
        >
          <ChangeList state={state} />
        </Modal>
      )}
    </>
  );
}
function Schedule(props: ViewProps) {
  const { state, today, mutate, navigate, notify, busy } = props;
  const [week, setWeek] = useState(monday(today));
  const [availability, setAvailability] = useState(false);
  const [kind, setKind] = useState<"trip" | "sick">("trip");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [moving, setMoving] = useState<TrainingSession | null>(null);
  const [moveDate, setMoveDate] = useState(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  async function move(id: string, date: string) {
    if (state.demo) {
      navigate("/onboarding");
      return;
    }
    const result = await mutate({ action: "move", sessionId: id, date });
    if (result) {
      setMoving(null);
      notify("A little more room in your week. Session moved.");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE ROOM FOR REAL LIFE"
        title="Your week. Your way."
        subtitle="Move a workout, take a trip, leave a little breathing room."
        action={
          <button
            className="btn btn-primary"
            onClick={() => setAvailability(true)}
          >
            <Plus size={17} />
            Mark time away
          </button>
        }
      />
      <SafetyNotice {...props} />
      {state.demo && (
        <div className="demo-banner">
          <span>Example schedule · Complete setup to save changes.</span>
          <Link href="/onboarding">
            Make it yours <ArrowRight size={15} />
          </Link>
        </div>
      )}
      <section className="panel schedule-panel">
        <div className="schedule-toolbar">
          <h2>
            {displayDate(week)} –{" "}
            {displayDate(days[6], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </h2>
          <div>
            <button
              className="icon-button"
              aria-label="Previous week"
              onClick={() => setWeek(addDays(week, -7))}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="btn btn-small btn-secondary"
              onClick={() => setWeek(monday(today))}
            >
              This week
            </button>
            <button
              className="icon-button"
              aria-label="Next week"
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </div>
        <div className="schedule-days">
          {days.map((d) => {
            const sessions = state.sessions.filter(
              (s) => s.date === d && s.status !== "skipped",
            );
            const blocked = state.profile?.blockedDates.includes(d);
            return (
              <div
                key={d}
                className={`schedule-day ${d === today ? "is-today" : ""} ${blocked ? "is-blocked" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void move(e.dataTransfer.getData("session-id"), d);
                }}
              >
                <div className="schedule-date">
                  <span>{displayDate(d, { weekday: "short" })}</span>
                  <strong>{Number(d.slice(-2))}</strong>
                  {d === today && <small>Today</small>}
                </div>
                {blocked ? (
                  <div className="recovery-slot">
                    <Plane size={21} />
                    <p>Time away</p>
                  </div>
                ) : sessions.length ? (
                  sessions.map((s) => (
                    <div
                      className={`schedule-session ${s.status === "done" ? "is-done" : ""}`}
                      key={s.id}
                      draggable={isUpcoming(s)}
                      onDragStart={(e) =>
                        e.dataTransfer.setData("session-id", s.id)
                      }
                    >
                      <div className="schedule-session-top">
                        <Dumbbell size={18} />
                        {s.status === "done" ? (
                          <Check size={16} />
                        ) : (
                          <GripVertical size={16} />
                        )}
                      </div>
                      <h3>{cleanTitle(s.title)}</h3>
                      <p>{s.exercises.length} exercises</p>
                      <Pill tone={s.status === "done" ? "sage" : "peach"}>
                        {s.status === "done"
                          ? "Completed"
                          : s.restart
                            ? "Restart week"
                            : "Planned"}
                      </Pill>
                      {isUpcoming(s) && (
                        <>
                          <button
                            className="text-button"
                            onClick={() => {
                              setMoving(s);
                              setMoveDate(s.date);
                            }}
                          >
                            Move session <ArrowUpRight size={13} />
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={async () => {
                              if (state.demo) {
                                navigate("/onboarding");
                                return;
                              }
                              const result = await mutate({
                                action: "miss",
                                sessionIds: [s.id],
                              });
                              if (result)
                                notify(
                                  "No guilt, no catching up. Your plan has adjusted.",
                                );
                            }}
                          >
                            Can’t make it
                          </button>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="recovery-slot">
                    <Leaf size={23} />
                    <p>Recovery day</p>
                    <small>Rest is part of the plan.</small>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="schedule-tip">
          <GripVertical size={16} />
          Drag a session to a new day, or tap “Move session”. We protect your
          recovery automatically.
        </div>
      </section>
      <section className="adaptation-card schedule-adaptation">
        <div className="adaptation-heading">
          <Repeat2 size={22} />
          <h2>Plans can bend. Your progress stays.</h2>
        </div>
        <p>
          Never more than one workout a day, or three training days in a row. If
          your week gets busy, Rebound finds the next available space.
        </p>
      </section>
      {availability && (
        <Modal
          title="Make room for time away"
          onClose={() => setAvailability(false)}
        >
          <p className="muted">
            Your workouts can wait. We’ll move them around these dates.
          </p>
          <div className="choice-row">
            <button
              className={`choice-tile ${kind === "trip" ? "selected" : ""}`}
              onClick={() => setKind("trip")}
            >
              <Plane size={23} />A trip
            </button>
            <button
              className={`choice-tile ${kind === "sick" ? "selected" : ""}`}
              onClick={() => setKind("sick")}
            >
              <HeartPulse size={23} />
              Sick days
            </button>
          </div>
          <label className="field">
            From
            <input
              type="date"
              min={today}
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <label className="field">
            Through
            <input
              type="date"
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary full-width"
            disabled={busy || !start || !end}
            onClick={async () => {
              if (state.demo) {
                navigate("/onboarding");
                return;
              }
              const result = await mutate({
                action: "availability",
                start,
                end,
                kind,
              });
              if (result) {
                setAvailability(false);
                notify("Time away marked. Your plan has made room.");
              }
            }}
          >
            {busy ? "Adjusting your week…" : "Make room in my plan"}
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {moving && (
        <Modal
          title="A better day for this workout"
          onClose={() => setMoving(null)}
        >
          <p>
            {cleanTitle(moving.title)} · Same workout. A little more
            flexibility.
          </p>
          <label className="field">
            New date
            <input
              type="date"
              min={today}
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary full-width"
            disabled={busy}
            onClick={() => void move(moving.id, moveDate)}
          >
            Move workout
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
    </>
  );
}
function Program(props: ViewProps) {
  const { state, today, navigate } = props;
  const [expanded, setExpanded] = useState(1);
  return (
    <>
      <PageHeading
        eyebrow="THE BIG PICTURE"
        title="A plan with room to grow."
        subtitle="Four weeks of strength, built around the life you actually live."
        action={
          <Link className="btn btn-secondary" href="/onboarding">
            <SlidersHorizontal size={17} />
            Update my plan
          </Link>
        }
      />
      <SafetyNotice {...props} />
      <section className="program-banner">
        <div>
          <Pill tone="light">
            {state.demo ? "EXAMPLE PROGRAM" : "YOUR STARTING PROGRAM"}
          </Pill>
          <h2>{state.demo ? "3-day full-body" : state.program.title}</h2>
          <p>
            {state.profile?.days} days a week <span>·</span>{" "}
            {state.profile?.equipment === "gym"
              ? "Full gym"
              : state.profile?.equipment === "bodyweight"
                ? "Bodyweight"
                : "Dumbbells"}{" "}
            <span>·</span> Built to adapt
          </p>
        </div>
        <Repeat2 size={82} strokeWidth={1} />
      </section>
      {[1, 2, 3, 4].map((w) => (
        <section className="panel program-week" key={w}>
          <button
            className="program-week-heading"
            onClick={() => setExpanded(expanded === w ? 0 : w)}
          >
            <div>
              <span className="week-badge">0{w}</span>
              <div>
                <h2>Week {w}</h2>
                <p>
                  {w === 1
                    ? "Find your rhythm"
                    : w === 2
                      ? "Build on the basics"
                      : w === 3
                        ? "Keep showing up"
                        : "Look how far you’ve come"}
                </p>
              </div>
            </div>
            <ChevronRight
              size={20}
              className={expanded === w ? "rotated" : ""}
            />
          </button>
          {expanded === w && (
            <div className="program-session-list">
              {state.sessions
                .filter((s) => s.week === w)
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      navigate(
                        s.date === today && isUpcoming(s)
                          ? `/workout?session=${s.id}`
                          : "/schedule",
                      )
                    }
                  >
                    <span className="program-session-icon">
                      {s.status === "done" ? (
                        <Check size={19} />
                      ) : (
                        <Dumbbell size={19} />
                      )}
                    </span>
                    <div>
                      <strong>{cleanTitle(s.title)}</strong>
                      <small>
                        {displayDate(s.date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        · {s.exercises.length} exercises
                      </small>
                    </div>
                    <Pill
                      tone={
                        s.status === "done" ? "sage" : s.restart ? "peach" : ""
                      }
                    >
                      {s.status === "done"
                        ? "Done"
                        : s.restart
                          ? "Restart"
                          : s.status === "skipped"
                            ? "Moved on"
                            : "Planned"}
                    </Pill>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
function Onboarding({ state, mutate, busy, navigate, notify }: ViewProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.demo ? "" : state.name);
  const [goal, setGoal] = useState<Goal>(
    state.demo ? "muscle" : state.profile?.goal || "muscle",
  );
  const [days, setDays] = useState(state.profile?.days || 3);
  const [equipment, setEquipment] = useState<Equipment>(
    state.profile?.equipment || "gym",
  );
  const [experience, setExperience] = useState<Profile["experience"]>(
    state.profile?.experience || "beginner",
  );
  const [limitations, setLimitations] = useState<string[]>(
    state.demo ? [] : state.profile?.limitations || [],
  );
  const [accepted, setAccepted] = useState(state.disclaimerAccepted);
  const titles = [
    "What are you working toward?",
    "How much room is in your week?",
    "What do you have to work with?",
    "Let’s make it feel like you.",
  ];
  const subtitles = [
    "One goal. Plenty of ways to get there.",
    "Choose a rhythm, not a rigid rule. You can change it later.",
    "We’ll only include exercises you have the equipment for.",
    "A couple of details so we can start in the right place.",
  ];
  return (
    <div className="onboarding">
      <Link className="back-link" href="/">
        <ArrowLeft size={17} />
        Back to your space
      </Link>
      <div className="onboarding-progress">
        {[0, 1, 2, 3].map((s) => (
          <span key={s} className={s <= step ? "filled" : ""} />
        ))}
        <small>STEP {step + 1} OF 4</small>
      </div>
      <p className="eyebrow">A STRONGER YOU. A MORE FLEXIBLE PLAN.</p>
      <h1>{titles[step]}</h1>
      <p className="page-subtitle">{subtitles[step]}</p>
      {step === 0 && (
        <div className="onboarding-options">
          {(
            [
              {
                id: "muscle",
                title: "Build muscle",
                description: "Build strength you can see and feel.",
                icon: Dumbbell,
              },
              {
                id: "strength",
                title: "Get stronger",
                description: "A little more confidence under the bar.",
                icon: ChartNoAxesCombined,
              },
              {
                id: "fitness",
                title: "Feel good, move well",
                description: "A balanced foundation for everyday life.",
                icon: Leaf,
              },
            ] as const
          ).map(({ id, title, description, icon: Icon }) => (
            <button
              key={id}
              className={`onboarding-option ${goal === id ? "selected" : ""}`}
              onClick={() => setGoal(id)}
            >
              <span>
                <Icon size={25} />
              </span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <span className="selection-circle">
                {goal === id && <Check size={15} />}
              </span>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <>
          <div className="day-choices">
            {[2, 3, 4, 5].map((d) => (
              <button
                key={d}
                className={days === d ? "selected" : ""}
                onClick={() => setDays(d)}
              >
                <strong>{d}</strong>
                <span>days / week</span>
                {d === 3 && <small>A gentle sweet spot</small>}
              </button>
            ))}
          </div>
          <div className="onboarding-note">
            <Repeat2 size={23} />
            <p>
              Miss a day? Your plan adjusts. There’s no catching up, and no
              starting over from zero.
            </p>
          </div>
        </>
      )}
      {step === 2 && (
        <div className="onboarding-options">
          {(
            [
              {
                id: "gym",
                title: "Full gym",
                description: "Barbells, machines, and the whole setup.",
                icon: Dumbbell,
              },
              {
                id: "dumbbells",
                title: "Dumbbells only",
                description: "A pair of weights. Plenty of possibility.",
                icon: House,
              },
              {
                id: "bodyweight",
                title: "Just me",
                description: "No equipment needed. Start where you are.",
                icon: Leaf,
              },
            ] as const
          ).map(({ id, title, description, icon: Icon }) => (
            <button
              key={id}
              className={`onboarding-option ${equipment === id ? "selected" : ""}`}
              onClick={() => setEquipment(id)}
            >
              <span>
                <Icon size={25} />
              </span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <span className="selection-circle">
                {equipment === id && <Check size={15} />}
              </span>
            </button>
          ))}
        </div>
      )}
      {step === 3 && (
        <div className="onboarding-details">
          <label className="field">
            What should we call you?
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Your first name"
              autoComplete="given-name"
            />
          </label>
          <p className="field-title">Your training experience</p>
          <div className="choice-row">
            <button
              className={`choice-tile ${experience === "beginner" ? "selected" : ""}`}
              onClick={() => setExperience("beginner")}
            >
              Finding my feet<small>Beginner or returning</small>
            </button>
            <button
              className={`choice-tile ${experience === "intermediate" ? "selected" : ""}`}
              onClick={() => setExperience("intermediate")}
            >
              Finding my groove<small>Training regularly</small>
            </button>
          </div>
          <p className="field-title">
            Any current limitations? <span>Optional</span>
          </p>
          <div className="limitation-chips">
            {[
              "lower back",
              "knee",
              "shoulder",
              "chest",
              "elbow",
              "hip",
              "core",
            ].map((a) => (
              <button
                className={limitations.includes(a) ? "selected" : ""}
                key={a}
                onClick={() =>
                  setLimitations((old) =>
                    old.includes(a) ? old.filter((x) => x !== a) : [...old, a],
                  )
                }
              >
                {limitations.includes(a) && <Check size={13} />} {a}
              </button>
            ))}
          </div>
          <p className="muted small-text">
            These are general limitations, not acute symptoms. For sharp pain,
            numbness, chest pain, dizziness, or a recent injury, stop and speak
            with a clinician before training.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              I understand Rebound is not medical advice. I’ll seek professional
              guidance for pain or injury.
            </span>
          </label>
        </div>
      )}
      <div className="onboarding-buttons">
        {step > 0 ? (
          <button
            className="btn btn-secondary"
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft size={16} />
            Back
          </button>
        ) : (
          <span className="setup-time">
            <Clock3 size={15} />
            About 2 minutes
          </span>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || (step === 3 && (!name.trim() || !accepted))}
          onClick={async () => {
            if (step < 3) {
              setStep(step + 1);
              return;
            }
            const result = await mutate({
              action: "onboard",
              name: name.trim(),
              goal,
              days,
              equipment,
              experience,
              limitations: limitations as (
                | "knee"
                | "lower back"
                | "shoulder"
                | "chest"
                | "elbow"
                | "hip"
                | "core"
              )[],
              disclaimerAccepted: true,
            });
            if (result) {
              notify("Your plan is ready. Let’s take it one set at a time.");
              navigate("/");
            }
          }}
        >
          {step === 3
            ? busy
              ? "Building your plan…"
              : "Build my plan"
            : "Continue"}
          <ArrowRight size={17} />
        </button>
      </div>
      <p className="onboarding-footnote">
        Built around you. Ready to change with you.
      </p>
    </div>
  );
}
