"use client";

// Last-resort error page; also reports React render errors that escape every boundary.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 560 }}>
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
        <p>Stoop hit an unexpected error. It has been reported. You can try again.</p>
        <button onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
