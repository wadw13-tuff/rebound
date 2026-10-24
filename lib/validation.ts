import { z } from "zod";
export const areas = [
  "knee",
  "lower back",
  "shoulder",
  "chest",
  "elbow",
  "hip",
  "core",
] as const;
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const parsed = new Date(`${d}T12:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d
    );
  }, "Use a valid calendar date");
const today = dateSchema;
const id = z.string().min(1).max(100);
const area = z.enum(areas).optional();
const entry = z
  .object({
    exerciseId: id,
    setIndex: z.number().int().min(0).max(20),
    weight: z.number().min(0).max(500),
    reps: z.number().int().min(0).max(100),
    status: z.enum(["done", "skipped"]),
    rpe: z.number().min(1).max(10),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("onboard"),
      today,
      name: z.string().trim().min(1).max(40),
      goal: z.enum(["muscle", "strength", "fitness"]),
      days: z.number().int().min(2).max(5),
      equipment: z.enum(["gym", "dumbbells", "bodyweight"]),
      experience: z.enum(["beginner", "intermediate"]),
      limitations: z.array(z.enum(areas)).max(7),
      disclaimerAccepted: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal("log"), today, sessionId: id, entry }).strict(),
  z
    .object({
      action: z.literal("finish"),
      today,
      sessionId: id,
      energy: z.number().int().min(1).max(5),
      pain: z.enum(["none", "mild", "sharp"]),
      area,
      symptoms: z
        .array(
          z.enum([
            "numbness",
            "chest pain",
            "dizziness",
            "recent injury",
            "trauma",
          ]),
        )
        .max(5),
    })
    .strict(),
  z
    .object({
      action: z.literal("miss"),
      today,
      sessionIds: z.array(id).min(1).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("availability"),
      today,
      start: dateSchema,
      end: dateSchema,
      kind: z.enum(["trip", "sick"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("move"),
      today,
      sessionId: id,
      date: dateSchema,
    })
    .strict(),
  z.object({ action: z.literal("resume"), today, sessionId: id }).strict(),
  z.object({ action: z.literal("disclaimer"), today }).strict(),
  z
    .object({
      action: z.literal("theme"),
      today,
      preference: z.enum(["system", "light", "dark"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("safety"),
      today,
      energy: z.number().int().min(1).max(5),
      pain: z.enum(["none", "sharp"]),
      area,
      symptoms: z
        .array(
          z.enum([
            "numbness",
            "chest pain",
            "dizziness",
            "recent injury",
            "trauma",
          ]),
        )
        .max(5),
    })
    .strict(),
  z
    .object({
      action: z.literal("clear-pause"),
      today,
      area: z.enum(["all", ...areas]),
      clinicianReviewed: z.literal(true),
    })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
