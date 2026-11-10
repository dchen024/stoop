import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { UserNav } from "@/components/user-nav";
import { Badges } from "@/components/badges";
import { PageViews } from "@/components/page-views";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description =
  "Every official NYC housing complaint about your building, updated every 15 minutes. Search any address.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Stoop: know what's going on in your building", template: "%s · Stoop" },
  description,
  openGraph: { type: "website", siteName: SITE_NAME, url: SITE_URL, description, locale: "en_US" },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-dvh`}>
        <PageViews />
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-1.5 dark:border-stone-800 dark:bg-stone-950">
          <Badges />
        </div>
        <header className="border-b border-stone-200 dark:border-stone-800">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" width={28} height={28} className="h-7 w-7" />
              <span className="text-orange-700 dark:text-orange-400">Stoop</span>
            </Link>
            <nav>
              <UserNav />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-stone-500">
          Official data: NYC HPD Housing Maintenance Code Complaints (NYC Open Data), synced every 15 minutes ·{" "}
          <Link href="/status" className="underline">
            Data health
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>
        </footer>
      </body>
    </html>
  );
}
