"use client";
import { Moon, Sun, Monitor } from "lucide-react";
import type { ThemePreference } from "@/lib/domain";
export default function ThemeToggle({
  value,
  onChangeAction,
}: {
  value: ThemePreference;
  onChangeAction: (value: ThemePreference) => void;
}) {
  const next: ThemePreference =
    value === "system" ? "dark" : value === "dark" ? "light" : "system";
  const Icon = value === "dark" ? Moon : value === "light" ? Sun : Monitor;
  const label =
    value === "dark"
      ? "Dark mode"
      : value === "light"
        ? "Light mode"
        : "System theme";
  return (
    <button
      className="theme-toggle icon-button"
      aria-label={`${label}. Switch to ${next} theme`}
      title={`${label} · switch to ${next}`}
      onClick={() => onChangeAction(next)}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
}
