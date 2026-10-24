import { notFound } from "next/navigation";
import ReboundApp from "@/components/ReboundApp";
const screens = [
  "schedule",
  "history",
  "program",
  "workout",
  "check-in",
  "onboarding",
  "billing",
];
export function generateStaticParams() {
  return screens.map((screen) => ({ screen }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  if (!screens.includes(screen)) notFound();
  return <ReboundApp view={screen} />;
}
