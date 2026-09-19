import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import DemoCatalog from "@/components/demo/DemoCatalog";
import { demoEntries } from "@/lib/demo/data";
import { getPublicEnv } from "@/lib/env/public";

export const metadata: Metadata = {
  title: "Public demo | Curio",
  description: "Explore Curio with a static, synthetic knowledge base.",
};

export const dynamic = "force-static";

export default function DemoPage() {
  if (!getPublicEnv().NEXT_PUBLIC_DEMO_ENABLED) notFound();

  return (
    <main className="min-h-screen bg-[#F4F7FE]">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex h-20 max-w-[1480px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link
            href="/demo"
            aria-label="Curio demo home"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-4"
          >
            <Image
              src="/curio-logo-horizontal-3.svg"
              alt="Curio"
              width={2315}
              height={544}
              priority
              className="h-8 w-auto"
            />
          </Link>
          <nav className="flex items-center gap-3" aria-label="Public navigation">
            <Link
              href="/privacy"
              className="rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-[#0075c9] px-4 py-2.5 text-sm font-extrabold text-white shadow-sm hover:bg-[#0067b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <DemoCatalog entries={demoEntries} />
    </main>
  );
}
