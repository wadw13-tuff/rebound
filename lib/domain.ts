export type Equipment = "gym" | "dumbbells" | "bodyweight";
export type Goal = "muscle" | "strength" | "fitness";
export type Pain = "none" | "mild" | "sharp";
export type SessionStatus = "planned" | "done" | "skipped" | "moved";
export interface Exercise {
  id: string;
  name: string;
  pattern: string;
  loadedAreas: string[];
  equipment: Equipment[];
  swapIds: string[];
  increment: number;
  defaultWeight: number;
}
export interface Prescription {
  exerciseId: string;
  sets: number;
  reps: number;
  weight: number;
  targetRpe: number;
  baseSets?: number;
  volumeFactor?: number;
}
export interface TrainingSession {
  id: string;
  date: string;
  title: string;
  week: number;
  status: SessionStatus;
  exercises: Prescription[];
  restart?: boolean;
  missed?: boolean;
  missedWeek?: string;
}
export interface CheckIn {
  sessionId: string;
  date: string;
  energy: number;
  pain: Pain;
  area?: string;
  symptoms: string[];
}
export interface SetEntry {
  exerciseId: string;
  setIndex: number;
  weight: number;
  reps: number;
  status: "done" | "skipped";
  rpe: number;
}
export interface Performance {
  sessionId: string;
  date: string;
  exerciseId: string;
  prescribedReps: number;
  prescribedSets: number;
  targetRpe: number;
  logs: SetEntry[];
}
export type ThemePreference = "system" | "light" | "dark";
export interface Profile {
  goal: Goal;
  days: number;
  equipment: Equipment;
  experience: "beginner" | "intermediate";
  limitations: string[];
  pausedAreas: string[];
  blockedDates: string[];
  themePreference?: ThemePreference;
}
export interface PlanChange {
  type: string;
  reason_code: string;
  affected_sessions: string[];
  before: unknown;
  after: unknown;
  explanation?: string;
  id?: string;
  createdAt?: string;
}
export type AdjustmentEvent =
  | { type: "missed"; sessionIds: string[] }
  | { type: "checkin"; checkIn: CheckIn }
  | { type: "availability"; dates: string[]; kind: "trip" | "sick" }
  | { type: "move"; sessionId: string; date: string }
  | {
      type: "resume";
      lastCompletedDate: string;
      lastWorkingWeights?: Record<string, number>;
    }
  | { type: "progression"; performances: Performance[] };
export interface AdjustmentInput {
  today: string;
  sessions: TrainingSession[];
  library: Exercise[];
  checkIns: CheckIn[];
  blockedDates: string[];
  pausedAreas: string[];
  equipment: Equipment;
  events: AdjustmentEvent[];
}
export interface AdjustmentResult {
  sessions: TrainingSession[];
  changes: PlanChange[];
  pausedAreas: string[];
  blockedDates: string[];
}
export interface AppState {
  name: string;
  demo: boolean;
  disclaimerAccepted: boolean;
  profile: Profile | null;
  program: { id: string; title: string; startDate: string };
  sessions: TrainingSession[];
  changes: PlanChange[];
  checkIns: CheckIn[];
  logs: (SetEntry & { sessionId: string })[];
  library: Exercise[];
  themePreference?: ThemePreference;
}
export const isUpcoming = (s: TrainingSession) =>
  s.status === "planned" || s.status === "moved";
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function dayGap(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000,
  );
}
export function monday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}
