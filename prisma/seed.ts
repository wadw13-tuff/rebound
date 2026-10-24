import { PrismaClient } from '@prisma/client';
import { exercises } from '../lib/library';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$transaction(
    exercises.map((exercise) => prisma.exercise.upsert({
      where: { id: exercise.id },
      update: {
        name: exercise.name,
        pattern: exercise.pattern,
        loadedAreas: JSON.stringify(exercise.loadedAreas),
        equipment: JSON.stringify(exercise.equipment),
        swapIds: JSON.stringify(exercise.swapIds),
        increment: exercise.increment,
        defaultWeight: exercise.defaultWeight,
      },
      create: {
        id: exercise.id,
        name: exercise.name,
        pattern: exercise.pattern,
        loadedAreas: JSON.stringify(exercise.loadedAreas),
        equipment: JSON.stringify(exercise.equipment),
        swapIds: JSON.stringify(exercise.swapIds),
        increment: exercise.increment,
        defaultWeight: exercise.defaultWeight,
      },
    })),
  );

  console.log(`Seeded ${exercises.length} exercises.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
