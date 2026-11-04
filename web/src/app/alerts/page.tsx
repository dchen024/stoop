import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AlertList } from "@/components/alert-list";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/alerts");

  const { data: alerts } = await supabase
    .from("alerts")
    .select(
      "id, kind, created_at, read_at, building_id, buildings(address), complaints(problem_code, category), resident_reports(category, description)",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
        <p className="text-sm text-stone-500">
          New official complaints, closed complaints and neighbor reports for buildings you watch. Updates live.
        </p>
      </div>
      <AlertList userId={user.id} initial={alerts ?? []} />
    </div>
  );
}
