import type { Exercise, PlanChange } from "./domain";
export const REFERRAL =
  "Planning for this area is paused; please speak with a clinician before returning to training, and seek urgent care for severe or ongoing chest pain, dizziness, or other concerning symptoms.";
type Transport = (system: string, payload: unknown) => Promise<unknown>;
export function safeJson(text: string): unknown {
  if (text.length > 12000) throw new Error("Oversized response");
  // Do not salvage markdown or malformed JSON: it must be a JSON-only response.
  return JSON.parse(text);
}
export const claude: Transport = async (system, payload) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Claude not configured");
  const headers: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
    "content-type": "application/json",
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID)
    headers["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(4500),
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 250,
      system,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!response.ok) throw new Error("Claude unavailable");
  const body = await response.json();
  if (!Array.isArray(body.content) || body.stop_reason === "refusal")
    throw new Error("Invalid Claude response");
  return safeJson(
    body.content
      .filter((c: { type?: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join(""),
  );
};
export function fallbackExplanation(change: PlanChange): string {
  const reason = change.reason_code.toLowerCase();
  if (/sharp|safety|referral|numbness|trauma|paused/.test(reason))
    return REFERRAL;
  if (/no_swap|no_alternative|no_safe|exercise_removed/.test(reason))
    return "We have paused the affected exercises because there is no approved substitute for this area.";
  if (/14|long_gap|restart_gap|gap_restart|resume_restart/.test(reason))
    return "After a longer break, we have eased your return to 70% of your usual sets and weights.";
  if (/7|short_gap|moderate_gap|gap_return|resume_weight/.test(reason))
    return "After some time away, your working weights are at 85% to make the return more manageable.";
  if (
    /two_miss|multiple_miss|missed_2|missed_two|week_restart|missed_week/.test(
      reason,
    )
  )
    return "Life happens, so this week restarts at 80% of your usual sets with your weights unchanged.";
  if (/energy|fatigue/.test(reason))
    return "Your energy has been low, so the next workout has 20% fewer sets to give you some breathing room.";
  if (/mild|swap/.test(reason))
    return "We have replaced exercises that load the sore area with approved alternatives and kept the rest of your session.";
  if (/travel|trip/.test(reason))
    return "Your workouts now fit around your trip, with recovery days still protected.";
  if (/sick|illness/.test(reason))
    return "Your sick days are clear of workouts, and the remaining sessions have room for recovery.";
  if (/progress/.test(reason))
    return "You hit your target reps comfortably in two sessions, so the next workout uses the smallest weight increase.";
  if (/miss/.test(reason))
    return "No catching up needed; your workout has moved to the next available day with the same weights.";
  if (/availability/.test(reason))
    return "Your time away is clear of workouts, and the remaining sessions have moved with recovery days protected.";
  if (/move|reschedul|schedule/.test(reason))
    return "Your session has moved, and your recovery days are still protected.";
  return "Your plan has been adjusted to fit your week, with recovery kept in mind.";
}
export async function explainChange(
  change: PlanChange,
  transport: Transport = claude,
): Promise<string> {
  const fallback = fallbackExplanation(change);
  // Safety messaging is fixed, not a probabilistic language-model decision.
  if (
    fallback === REFERRAL ||
    /no_swap|no_alternative|no_safe|exercise_removed/i.test(change.reason_code)
  )
    return fallback;
  try {
    const out = await transport(
      'Return JSON only: {"sentence":"..."}. Rewrite the supplied approved sentence into exactly one plain encouraging sentence. Preserve every number and its meaning. Never blame the user or use failed/failure/lazy/your fault/should have. Do not invent exercises, quantities, diagnoses or medication advice. You cannot make training decisions.',
      { approved_sentence: fallback, change },
    );
    if (
      !out ||
      typeof out !== "object" ||
      !("sentence" in out) ||
      typeof out.sentence !== "string"
    )
      return fallback;
    const text = out.sentence.trim();
    if (
      !text ||
      text.length > 320 ||
      /\b(fail\w*|lazy|blame|diagnos\w*|medicat\w*|drug|prescri\w*)\b|your fault|should have|push through|work around/i.test(
        text,
      )
    )
      return fallback;
    if (text.split(/[!?]|\.(?=\s|$)/).filter((s) => s.trim()).length !== 1)
      return fallback;
    const numbers = fallback.match(/\d+(?:\.\d+)?/g) ?? [];
    const returned = text.match(/\d+(?:\.\d+)?/g) ?? [];
    if (JSON.stringify(numbers) !== JSON.stringify(returned)) return fallback;
    return text;
  } catch {
    return fallback;
  }
}
export async function chooseSwap(
  original: Exercise,
  whitelist: Exercise[],
  transport: Transport = claude,
): Promise<string> {
  if (!whitelist.length) throw new Error("No approved substitute");
  // Exactly one retry for invalid JSON/ID or an API error; fallback is always the first rule match.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await transport(
        'Return JSON only: {"exercise_id":"ID"}. Choose exactly one ID from whitelist. Never invent exercises, change sets/weights, diagnose, discuss medication, or add advice. An invalid response will be rejected.',
        {
          original: { id: original.id, pattern: original.pattern },
          whitelist: whitelist.map((e) => ({
            id: e.id,
            pattern: e.pattern,
            equipment: e.equipment,
            loaded_areas: e.loadedAreas,
          })),
          retry: attempt === 1,
        },
      );
      if (
        result &&
        typeof result === "object" &&
        "exercise_id" in result &&
        typeof result.exercise_id === "string" &&
        Object.keys(result).length === 1 &&
        whitelist.some((e) => e.id === result.exercise_id)
      )
        return result.exercise_id;
    } catch {
      /* offline and API errors are routine; the rule-based plan remains usable */
    }
  }
  return whitelist[0].id;
}
