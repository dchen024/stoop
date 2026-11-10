// Sentry for server components, route handlers and middleware (Sentry project "stoop").
// Off unless NEXT_PUBLIC_SENTRY_DSN is set, so local dev sends nothing by default.
import * as Sentry from "@sentry/nextjs";

export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0, // errors only
    // No user info, cookies (they hold Supabase auth tokens), headers or query strings.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false },
  });
}

export const onRequestError = Sentry.captureRequestError;
