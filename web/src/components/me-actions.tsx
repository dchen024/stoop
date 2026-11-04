"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MeActions() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={signOut}
        className="rounded-xl border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-900"
      >
        Sign out
      </button>
    </div>
  );
}
