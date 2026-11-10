// Sentry in the browser: uncaught errors only, no tracing, no session replay.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
    // No user info, cookies (they hold Supabase auth tokens), headers or query strings.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
