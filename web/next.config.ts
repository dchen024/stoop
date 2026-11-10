import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: "daniel-fxl",
  project: "stoop",
  // Source maps upload only when SENTRY_AUTH_TOKEN is set (not configured yet);
  // without it, browser stack traces in Sentry are minified.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
