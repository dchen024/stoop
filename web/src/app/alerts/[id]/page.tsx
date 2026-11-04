import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KIND_LABEL } from "@/lib/alerts";
import { OUTCOME, fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const alertId = Number(id);
  if (!Number.isSafeInteger(alertId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/alerts/${alertId}`);

  // RLS: this only returns the alert if it belongs to the signed-in user.
  const { data: alert } = await supabase
    .from("alerts")
    .select(
      `id, kind, created_at, read_at, building_id,
       buildings(address, borough, nta, postcode),
       complaints(problem_id, complaint_id, category, subcategory, problem_code, urgency, apartment, received_at,
                  problem_status, status_changed_at, status_descriptions(description, closure_reason)),
       resident_reports(category, description, apartment, status, created_at)`,
    )
    .eq("id", alertId)
    .maybeSingle();
  if (!alert) notFound();

  // Opening an alert marks it read (users may only touch read_at, on their own rows).
  if (!alert.read_at) {
    await supabase.from("alerts").update({ read_at: new Date().toISOString() }).eq("id", alertId);
  }

  const b = alert.buildings;
  const c = alert.complaints;
  const r = alert.resident_reports;
  const outcome = c
    ? OUTCOME[c.status_descriptions?.closure_reason ?? (c.problem_status === "OPEN" ? "still_open" : "other")]
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/alerts" className="text-sm text-stone-500 hover:underline">
        ← All alerts
      </Link>

      <div>
        <p className="text-sm font-medium text-orange-700 dark:text-orange-400">{KIND_LABEL[alert.kind]}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {c ? titleCase(c.problem_code ?? c.category) : titleCase(r?.category)}
        </h1>
        <p className="text-stone-600 dark:text-stone-400">
          {titleCase(b?.address)} · {titleCase(b?.nta)}, {titleCase(b?.borough)}
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900">
        {c && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {outcome && <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${outcome.tone}`}>{outcome.label}</span>}
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                {titleCase(c.urgency)}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Category" value={titleCase(c.category)} />
              <Field label="Where" value={titleCase(c.subcategory) || "–"} />
              <Field label="Apartment" value={c.apartment ?? "–"} />
              <Field label="Received by the city" value={fmtDate(c.received_at, true)} />
              <Field label="Status updated" value={fmtDate(c.status_changed_at, true)} />
              <Field label="HPD complaint #" value={String(c.complaint_id)} />
            </dl>
            {c.status_descriptions?.description && (
              <div className="border-t border-stone-200 pt-3 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-400">
                <p className="mb-1 font-medium text-stone-800 dark:text-stone-200">What HPD says</p>
                {c.status_descriptions.description}
              </div>
            )}
          </>
        )}

        {r && (
          <>
            <p className="text-base">&ldquo;{r.description}&rdquo;</p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Category" value={titleCase(r.category)} />
              <Field label="Apartment" value={r.apartment ?? "–"} />
              <Field label="Posted" value={fmtDate(r.created_at, true)} />
              <Field label="Status" value={r.status === "open" ? "Open" : "Resolved"} />
            </dl>
            <p className="text-xs text-stone-500">Resident report, unverified. Not filed with the city.</p>
          </>
        )}

        <p className="border-t border-stone-200 pt-3 text-xs text-stone-500 dark:border-stone-800">
          Alert sent {fmtDate(alert.created_at, true)}
        </p>
      </div>

      <Link
        href={`/building/${alert.building_id}`}
        className="inline-flex h-10 items-center rounded-lg bg-orange-700 px-4 text-sm font-semibold text-white hover:bg-orange-800"
      >
        View building
      </Link>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
