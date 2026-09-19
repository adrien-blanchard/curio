"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import DashboardGrid from "@/components/DashboardGrid";
import FilterBar from "@/components/FilterBar";
import SubmitLinkButton from "@/components/SubmitLinkButton";
import AdminTable from "@/components/AdminTable";
import TagsClientPage from "@/app/dashboard/tags/TagsClientPage";
import type { CurioEntry, CurioTag } from "@/components/types";
import { demoEntries } from "@/lib/demo/data";

const userId = "81000000-0000-4000-8000-000000000001";
const tagNames = [
  "3D",
  "Agentic",
  "Audio",
  "Computer Vision",
  "Image Editing",
  "LLM / Text",
  "Real-Time",
  "Research",
  "Video Generation",
  "Workflow",
];
const colors = [
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#0075c9",
  "#14b8a6",
  "#f59e0b",
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
];
const tags: CurioTag[] = tagNames.map((name, i) => ({
  id: `82000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  name,
  slug: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-$/, ""),
  color: colors[i],
}));
const entries: CurioEntry[] = demoEntries.map((entry, i) => ({
  id: `83000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  title: entry.title,
  url: `https://example.com/resources/${entry.id}`,
  tldr: entry.summary,
  thumbnailUrl: entry.image,
  thumbnailOrigin: "automatic",
  status: "ready",
  sourceType: entry.source === "Product" ? "proprietary" : "opensource",
  tags: [...new Set([tags[[3, 0, 5, 1, 6, 4, 5, 4, 6, 2, 7, 5][i]], tags[i % 2 ? 9 : 7]])],
  createdAt: `2026-09-${String(19 - i).padStart(2, "0")}T09:00:00Z`,
  createdBy: userId,
  authorEmail: i % 3 ? "morgan@example.test" : "avery@example.test",
  authorDisplayName: i % 3 ? "Morgan Reed" : "Avery Chen",
  sourcePublishedAt: ["2026-08-25", "2026-05-12", "2025-11-03"][i % 3],
  sourceDateKind: "published",
  sourceDateOrigin: "ai",
}));

function StudioContent() {
  const [panel, setPanel] = useState("dashboard");
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("tags")?.split(",").filter(Boolean) ?? [];
  const query = params.get("q")?.toLowerCase() ?? "";
  const filtered = entries.filter(
    (entry) =>
      (!selected.length || selected.every((slug) => entry.tags.some((tag) => tag.slug === slug))) &&
      (!query || `${entry.title} ${entry.tldr}`.toLowerCase().includes(query)) &&
      (!params.get("source") || entry.sourceType === params.get("source")),
  );
  return (
    <div
      className="flex min-h-screen bg-background"
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        const href = link?.getAttribute("href");
        if (href?.startsWith("/dashboard")) {
          event.preventDefault();
          event.stopPropagation();
          setPanel(
            href.includes("/tags") ? "tags" : href.includes("/admin") ? "members" : "dashboard",
          );
          router.replace("/demo/studio");
        }
      }}
    >
      <div className="sticky top-0 h-screen shrink-0">
        <Sidebar
          user={{ email: "avery@example.test", displayName: "Avery Chen" }}
          role="administrator"
        />
      </div>
      <div className="min-w-0 flex-1">
        <Navbar searchAction="/demo/studio" />
        <main className="px-4 pb-10 sm:px-8 lg:px-10">
          {panel === "dashboard" ? (
            <div className="space-y-5">
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-[#1B254B]">
                    Knowledge base
                  </h1>
                  <p className="mt-1 text-[15px] font-medium text-[#718096]">
                    Review the technical resources shared by your organization.
                  </p>
                </div>
                <SubmitLinkButton role="administrator" />
              </div>
              <FilterBar
                allTags={tags}
                currentTags={selected}
                currentSource={
                  params.get("source") === "opensource"
                    ? "opensource"
                    : params.get("source") === "proprietary"
                      ? "proprietary"
                      : ""
                }
                uniqueAuthors={[
                  { value: "avery@example.test", label: "Avery Chen" },
                  { value: "morgan@example.test", label: "Morgan Reed" },
                ]}
              />
              <DashboardGrid
                entries={filtered}
                allTags={tags}
                role="administrator"
                currentUserId={userId}
              />
            </div>
          ) : panel === "tags" ? (
            <TagsClientPage
              initialTags={tags.map((tag, i) => ({ ...tag, usageCount: 14 - i }))}
              role="administrator"
            />
          ) : (
            <div className="space-y-7 pt-4">
              <div>
                <h1 className="text-[32px] font-extrabold tracking-tight text-[#1B254B]">
                  Members &amp; access
                </h1>
                <p className="mt-1 text-[15px] font-medium text-[#718096]">
                  Manage roles for active members of your workspace.
                </p>
              </div>
              <AdminTable
                currentUserId={userId}
                initialUsers={[
                  "Avery Chen",
                  "Morgan Reed",
                  "Jamie Park",
                  "Taylor Blake",
                  "Sam Rivera",
                  "Alex Morgan",
                ].map((name, i) => ({
                  id: `81000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
                  displayName: name,
                  email: `${name.toLowerCase().replace(" ", ".")}@example.test`,
                  role: i === 0 ? "administrator" : i % 2 ? "contributor" : "reader",
                  createdAt: "2026-08-01T09:00:00Z",
                }))}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function CaptureStudio() {
  return (
    <Suspense>
      <StudioContent />
    </Suspense>
  );
}
