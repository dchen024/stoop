import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="November 10, 2026">
      <p>By using Stoop you agree to these terms. If you don&apos;t agree, please don&apos;t use Stoop.</p>

      <h2>What Stoop is</h2>
      <p>
        Stoop is a free tool that shows official NYC housing complaints from NYC Open Data. It isn&apos;t affiliated
        with or endorsed by the City of New York or HPD.
      </p>

      <h2>No guarantees</h2>
      <p>
        Data can be late, incomplete or wrong, at the city&apos;s end or ours. Stoop is provided &quot;as is&quot;
        without warranties of any kind. It isn&apos;t legal advice. Check the city&apos;s own records before acting on
        anything here, and to report a problem officially, call or file with{" "}
        <a className="underline" href="https://portal.311.nyc.gov/" target="_blank" rel="noreferrer">
          311
        </a>
        .
      </p>

      <h2>Using Stoop fairly</h2>
      <ul>
        <li>Don&apos;t use Stoop to harass, threaten or discriminate against anyone, including landlords, tenants or neighbors.</li>
        <li>Don&apos;t scrape Stoop at volume, overload it or try to get around its limits or security. The underlying data is available from NYC Open Data directly.</li>
        <li>Don&apos;t try to access accounts or data that aren&apos;t yours.</li>
      </ul>
      <p>We may limit or close accounts that break these rules.</p>

      <h2>Accounts and alerts</h2>
      <p>
        You can use Stoop as a guest or with an email sign-in link. Alerts are best-effort and can be delayed or
        missed; don&apos;t rely on them for anything urgent.
      </p>

      <h2>Neighbor reports</h2>
      <p>
        Posting neighbor reports is currently turned off. If it returns, you&apos;ll be responsible for what you post,
        and we may remove anything inaccurate, abusive or that shares someone&apos;s personal information.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, Stoop and its makers aren&apos;t liable for any loss or damage from using Stoop
        or relying on its data.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms and will change the date above when we do. Our{" "}
        <Link className="underline" href="/privacy">
          privacy policy
        </Link>{" "}
        explains how we handle your data. Questions: <Contact />.
      </p>
    </LegalPage>
  );
}
