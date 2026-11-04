import type { Database } from "@/lib/database.types";

export type AlertKind = Database["public"]["Enums"]["alert_kind"];

export type AlertRow = {
  id: number;
  kind: AlertKind;
  created_at: string;
  read_at: string | null;
  building_id: number;
  buildings: { address: string | null } | null;
  complaints: { problem_code: string | null; category: string } | null;
  resident_reports: { category: string; description: string } | null;
};

export const ALERT_SELECT =
  "id, kind, created_at, read_at, building_id, buildings(address), complaints(problem_code, category), resident_reports(category, description)";

export const KIND_LABEL: Record<AlertKind, string> = {
  new_complaint: "New official complaint",
  complaint_closed: "Complaint closed",
  new_report: "Neighbor posted a report",
};
