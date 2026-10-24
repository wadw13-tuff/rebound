import type { Exercise, Prescription } from "./domain";
/** A new movement never inherits a heavier load than its starting library load. */
export function prescriptionForSwap(
  prescription: Prescription,
  alternative: Exercise,
): Prescription {
  return {
    ...prescription,
    exerciseId: alternative.id,
    weight: Math.min(prescription.weight, alternative.defaultWeight),
  };
}
