"use client";
import { useState } from "react";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Modal } from "./ui";
import type { ViewProps } from "./ui";
export default function SafetyNotice({
  state,
  mutate,
  notify,
  busy,
}: Pick<ViewProps, "state" | "mutate" | "notify" | "busy">) {
  const paused = state.profile?.pausedAreas ?? [];
  const [open, setOpen] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [area, setArea] = useState(paused[0] || "all");
  if (!paused.length) return null;
  return (
    <>
      <div className="safety-banner">
        <ShieldCheck size={22} />
        <div>
          <strong>Let’s put your wellbeing first.</strong>
          <p>
            Planning{" "}
            {paused.includes("all")
              ? "is paused"
              : `for ${paused.join(", ")} is paused`}
            . Please speak with a clinician before returning to training. Seek
            urgent care for severe or ongoing concerning symptoms.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setArea(paused[0]);
              setReviewed(false);
              setOpen(true);
            }}
          >
            Manage safety pause <ArrowRight size={13} />
          </button>
        </div>
      </div>
      {open && (
        <Modal
          title="Returning after a safety pause"
          onClose={() => setOpen(false)}
        >
          <p>
            Rebound cannot assess whether it is safe for you to train. This
            pause should only be cleared after clinician guidance about the
            symptoms you reported. Clearing it does not replace that guidance.
          </p>
          <label className="field">
            Pause to clear
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              {paused.map((a) => (
                <option key={a} value={a}>
                  {a === "all" ? "All training (global pause)" : a}
                </option>
              ))}
            </select>
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              I have reviewed these symptoms with a clinician and received
              guidance about returning to training.
            </span>
          </label>
          <p className="muted">
            Your upcoming workouts will restart at 70% of the starting sets and
            weights. Other pauses and limitations remain in place.
          </p>
          <button
            className="btn btn-primary full-width"
            disabled={!reviewed || busy}
            onClick={async () => {
              const result = await mutate({
                action: "clear-pause",
                area: area as
                  | "all"
                  | "knee"
                  | "lower back"
                  | "shoulder"
                  | "chest"
                  | "elbow"
                  | "hip"
                  | "core",
                clinicianReviewed: true,
              });
              if (result) {
                setOpen(false);
                notify(
                  "Pause cleared after your confirmed clinician review. A gentler return is ready.",
                );
              }
            }}
          >
            Confirm reviewed return
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </>
  );
}
