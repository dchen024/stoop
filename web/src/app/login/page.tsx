"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/me";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(params.get("error") ? "error" : "idle");
  const [message, setMessage] = useState(params.get("error") ? "That sign-in link expired. Try again." : "");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { data } = await supabase.auth.getUser();
    // A guest who adds an email keeps their watchlist and reports.
    const { error } = data.user?.is_anonymous
      ? await supabase.auth.updateUser({ email }, { emailRedirectTo })
      : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
    }
  }

  async function continueAsGuest() {
    setState("sending");
    const { error } = await createClient().auth.signInAnonymously();
    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keep an eye on your building</h1>
        <p className="mt-1 text-stone-600 dark:text-stone-400">
          Watch buildings, get alerted when new complaints come in, and report problems the city hasn&apos;t caught yet.
        </p>
      </div>

      {state === "sent" ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Check {email} for a sign-in link.
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-3">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-600/20 dark:border-stone-700 dark:bg-stone-900"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="w-full rounded-xl bg-orange-700 px-4 py-3 font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
          >
            Email me a sign-in link
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 text-sm text-stone-500">
        <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" /> or <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
      </div>

      <button
        onClick={continueAsGuest}
        disabled={state === "sending"}
        className="w-full rounded-xl border border-stone-300 px-4 py-3 font-medium hover:bg-stone-100 disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-900"
      >
        Continue as guest
      </button>

      {state === "error" && <p className="text-sm text-red-700 dark:text-red-400">{message}</p>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
