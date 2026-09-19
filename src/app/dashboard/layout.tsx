import type { ReactNode } from "react";

import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import { requirePageActor } from "@/lib/auth/page";
import { getOptionalServerMetadata } from "@/lib/env/server";

export default async function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  const actor = await requirePageActor();
  const metadata = getOptionalServerMetadata();
  const extensionUrl =
    metadata.EXTENSION_ENABLED && actor.role !== "reader"
      ? metadata.NEXT_PUBLIC_EXTENSION_INSTALL_URL
      : null;

  return (
    <div className="flex min-h-screen bg-background">
      <div className="sticky top-0 h-screen shrink-0">
        <Sidebar
          user={{
            email: actor.user.email,
            displayName: actor.user.displayName,
            avatarUrl: actor.user.avatarUrl,
          }}
          role={actor.role}
          extensionUrl={extensionUrl}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Navbar />
        <main id="main-content" className="px-4 pb-10 sm:px-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
