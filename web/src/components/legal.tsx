import Link from "next/link";
import { CONTACT_EMAIL, REPO_URL } from "@/lib/site";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-6 leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-stone-700 dark:[&_p]:text-stone-300">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-stone-500">Last updated {updated}</p>
      </header>
      {children}
    </article>
  );
}

export function Contact() {
  return CONTACT_EMAIL ? (
    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
      {CONTACT_EMAIL}
    </a>
  ) : (
    <>
      an issue on{" "}
      <Link className="underline" href={`${REPO_URL}/issues`}>
        our GitHub
      </Link>
    </>
  );
}
