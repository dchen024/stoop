import type { Database } from "@/lib/database.types";
import { OUTCOME } from "@/lib/format";

export type AlertKind = Database["public"]["Enums"]["alert_kind"];

export type AlertRow = {
  id: number;
  kind: AlertKind;
  created_at: string;
  read_at: string | null;
  building_id: number;
  buildings: { address: string | null } | null;
  complaints: {
    problem_code: string | null;
    category: string;
    status_descriptions: { closure_reason: Database["public"]["Enums"]["closure_reason"] } | null;
  } | null;
  resident_reports: { category: string; description: string } | null;
};

export const ALERT_SELECT =
  "id, kind, created_at, read_at, building_id, buildings(address), complaints(problem_code, category, status_descriptions(closure_reason)), resident_reports(category, description)";

export const KIND_LABEL: Record<AlertKind, string> = {
  new_complaint: "New official complaint",
  complaint_closed: "Complaint closed",
  new_report: "Neighbor posted a report",
};

/** "Complaint closed" alone hides the point: closed is often not fixed. Say how. */
export function alertTitle(a: Pick<AlertRow, "kind" | "complaints">): string {
  const reason = a.complaints?.status_descriptions?.closure_reason;
  if (a.kind === "complaint_closed" && reason && reason !== "still_open") return OUTCOME[reason].label;
  return KIND_LABEL[a.kind];
}
