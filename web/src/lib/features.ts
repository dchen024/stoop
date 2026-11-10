// Neighbor (resident) reports are switched off to prevent misuse until moderation exists.
// The database also blocks new reports (migration 20261110200000); to turn them back on,
// set this to true and `grant insert on public.resident_reports to authenticated`.
export const REPORTS_ENABLED = false;
