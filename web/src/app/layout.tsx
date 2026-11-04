import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Stoop: know what's going on in your building",
  description:
    "Every official NYC housing complaint about your building, plus reports from your neighbors. Search any address.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-dvh`}>
        <header className="border-b border-stone-200 dark:border-stone-800">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-xl font-bold tracking-tight">
              <span className="text-orange-700 dark:text-orange-400">Stoop</span>
            </Link>
            <nav className="text-sm text-stone-600 dark:text-stone-400">NYC housing complaints, in plain English</nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-stone-500">
          Official data: NYC HPD Housing Maintenance Code Complaints (NYC Open Data), synced every 15 minutes.
        </footer>
      </body>
    </html>
  );
}
