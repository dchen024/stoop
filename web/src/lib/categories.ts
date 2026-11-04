import { titleCase } from "@/lib/format";

// HPD's major categories in words a tenant would use.
const LABELS: Record<string, string> = {
  "HEAT/HOT WATER": "Heat & hot water",
  "UNSANITARY CONDITION": "Pests, mold & sanitation",
  PLUMBING: "Plumbing",
  "PAINT/PLASTER": "Paint & plaster",
  "DOOR/WINDOW": "Doors & windows",
  GENERAL: "General",
  "WATER LEAK": "Leaks",
  ELECTRIC: "Electrical",
  "FLOORING/STAIRS": "Floors & stairs",
  APPLIANCE: "Appliances",
  SAFETY: "Safety (smoke/CO detectors, locks)",
  "LINE OF TRAVEL": "Accessibility",
  ELEVATOR: "Elevator",
  "OUTSIDE BUILDING": "Outside the building",
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return "All issues";
  return LABELS[category] ?? titleCase(category);
}
