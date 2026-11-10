import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="November 10, 2026">
      <p>
        Stoop shows official NYC housing complaints for any building. You can use it without an account. This page
        explains what we collect when you do, and what we don&apos;t.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Pages you visit and what you click</strong> on Stoop: which pages and buildings you view, searches
          where you pick a result or find nothing, shares, and clicks on the Supabase and Sodabase badges. We use this
          to understand which buildings and features matter to people.
        </li>
        <li>
          <strong>A daily visitor count without cookies.</strong> To count unique visitors per day, we combine your IP
          address and browser type with a random key that changes every day and is then deleted. We store only the
          result, never your IP address, and we can&apos;t recognize you from one day to the next.
        </li>
        <li>
          <strong>General context:</strong> the site that linked you here, campaign tags in the link (like{" "}
          <code>utm_source</code>), your device type (phone, tablet or computer), and the approximate city, region
          and country our host derives from your connection.
        </li>
        <li>
          <strong>If you sign in:</strong> your email address (or a guest account with no email), the buildings you
          watch, and your activity on Stoop linked to your account. Watching a building creates alerts for you when
          complaints there are filed or closed.
        </li>
        <li>
          <strong>Error reports:</strong> when something breaks, we send technical details (the page, the error, your
          browser) to Sentry. These reports exclude cookies, your email, request headers and query strings.
        </li>
      </ul>

      <h2>What we don&apos;t do</h2>
      <ul>
        <li>No advertising, ad trackers or third-party analytics pixels.</li>
        <li>No tracking cookies. The only cookies keep you signed in.</li>
        <li>We don&apos;t sell or rent your information, or send it to data brokers.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Your activity and email are visible only to Stoop&apos;s administrators, who use them to run and improve Stoop
        and may email you about it. Your watchlist is private. Neighbor reports are currently turned off; reports
        posted earlier aren&apos;t shown.
      </p>
      <p>
        Service providers that process data for us: Supabase (database and sign-in), Vercel (hosting), Sentry (error
        reports) and Sodabase (read-only data-quality checks on the database).
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Daily visitor keys: deleted the next day.</li>
        <li>Search text: removed after 90 days.</li>
        <li>Page views and clicks: deleted after about 13 months.</li>
        <li>Account data: until you ask us to delete your account.</li>
      </ul>

      <h2>Your choices</h2>
      <p>
        To see or delete your data, or to stop emails, contact us through <Contact />. Deleting your account removes
        your email, watchlist and alerts, and unlinks your past activity from you.
      </p>

      <h2>The housing data</h2>
      <p>
        Complaint data comes from the NYC Department of Housing Preservation and Development through NYC Open Data. It
        is public. Apartment numbers appear as the city publishes them. See{" "}
        <Link className="underline" href="/status">
          Data health
        </Link>{" "}
        for how fresh it is.
      </p>

      <p>
        Stoop isn&apos;t affiliated with the City of New York. Questions about this policy: <Contact />.
      </p>
    </LegalPage>
  );
}
