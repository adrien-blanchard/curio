import { ENTRY_PLACEHOLDER_IMAGES } from "@/lib/ui/entry-placeholders";

export type DemoEntry = {
  id: string;
  title: string;
  summary: string;
  source: "Open source" | "Research" | "Product";
  publishedAt: string;
  image: string;
  tags: Array<{ name: string; color: string }>;
};

export const demoEntries: DemoEntry[] = [
  {
    id: "demo-01",
    title: "Atlas: compact models for on-device visual search",
    summary:
      "A fictional model family demonstrates private, low-latency semantic search over local image libraries without uploading source media.",
    source: "Research",
    publishedAt: "2026-07-28",
    image: ENTRY_PLACEHOLDER_IMAGES[0],
    tags: [
      { name: "Computer Vision", color: "#0075c9" },
      { name: "Research", color: "#8b5cf6" },
    ],
  },
  {
    id: "demo-02",
    title: "OpenRender adds deterministic scene validation",
    summary:
      "A sample rendering toolkit introduces reproducible validation reports for assets, materials and render settings before farm submission.",
    source: "Open source",
    publishedAt: "2026-07-25",
    image: ENTRY_PLACEHOLDER_IMAGES[1],
    tags: [
      { name: "3D", color: "#f59e0b" },
      { name: "Developer Tools", color: "#10b981" },
    ],
  },
  {
    id: "demo-03",
    title: "Field Notes: evaluating long-context assistants",
    summary:
      "A practical evaluation framework compares retrieval quality, citation accuracy and latency using repeatable synthetic knowledge bases.",
    source: "Research",
    publishedAt: "2026-07-22",
    image: ENTRY_PLACEHOLDER_IMAGES[2],
    tags: [
      { name: "LLM", color: "#ec4899" },
      { name: "Evaluation", color: "#6366f1" },
    ],
  },
  {
    id: "demo-04",
    title: "Relay turns review comments into structured tasks",
    summary:
      "This fictional review assistant groups feedback by shot, detects conflicts and exports clear action items while keeping final approval human-led.",
    source: "Product",
    publishedAt: "2026-07-18",
    image: ENTRY_PLACEHOLDER_IMAGES[3],
    tags: [
      { name: "Workflow", color: "#14b8a6" },
      { name: "Collaboration", color: "#3b82f6" },
    ],
  },
  {
    id: "demo-05",
    title: "Nimbus streams neural previews on modest hardware",
    summary:
      "A sample real-time preview system adapts resolution and model complexity to provide stable interactive feedback on common workstations.",
    source: "Open source",
    publishedAt: "2026-07-14",
    image: ENTRY_PLACEHOLDER_IMAGES[4],
    tags: [
      { name: "Real-time", color: "#06b6d4" },
      { name: "Rendering", color: "#f97316" },
    ],
  },
  {
    id: "demo-06",
    title: "A benchmark for controllable material generation",
    summary:
      "A fictional benchmark measures prompt adherence, tileability and edit consistency across procedurally generated production materials.",
    source: "Research",
    publishedAt: "2026-07-11",
    image: ENTRY_PLACEHOLDER_IMAGES[5],
    tags: [
      { name: "Image", color: "#ef4444" },
      { name: "Generative AI", color: "#8b5cf6" },
    ],
  },
  {
    id: "demo-07",
    title: "Lattice indexes technical decisions alongside code",
    summary:
      "This sample knowledge tool links architecture decisions to the pull requests and incidents that motivated them, with explicit source citations.",
    source: "Product",
    publishedAt: "2026-07-08",
    image: ENTRY_PLACEHOLDER_IMAGES[6],
    tags: [
      { name: "Knowledge", color: "#0075c9" },
      { name: "Developer Tools", color: "#10b981" },
    ],
  },
  {
    id: "demo-08",
    title: "Prism isolates lighting changes from scene content",
    summary:
      "A fictional relighting method separates illumination controls from appearance so artists can iterate without replacing the underlying scene.",
    source: "Research",
    publishedAt: "2026-07-05",
    image: ENTRY_PLACEHOLDER_IMAGES[7],
    tags: [
      { name: "Relighting", color: "#eab308" },
      { name: "Computer Vision", color: "#0075c9" },
    ],
  },
  {
    id: "demo-09",
    title: "VectorDock packages repeatable ML experiments",
    summary:
      "A sample command-line toolkit records data versions, model settings and evaluation results in portable, reviewable experiment manifests.",
    source: "Open source",
    publishedAt: "2026-06-30",
    image: ENTRY_PLACEHOLDER_IMAGES[8],
    tags: [
      { name: "MLOps", color: "#6366f1" },
      { name: "Developer Tools", color: "#10b981" },
    ],
  },
  {
    id: "demo-10",
    title: "Soundstage maps dialogue edits to picture revisions",
    summary:
      "This fictional audio workflow highlights timing changes between editorial versions and prepares a concise review report for sound teams.",
    source: "Product",
    publishedAt: "2026-06-26",
    image: ENTRY_PLACEHOLDER_IMAGES[9],
    tags: [
      { name: "Audio", color: "#ec4899" },
      { name: "Workflow", color: "#14b8a6" },
    ],
  },
  {
    id: "demo-11",
    title: "Cedar tests retrieval systems against stale knowledge",
    summary:
      "A synthetic dataset evaluates whether assistants recognize superseded documentation instead of confidently returning outdated procedures.",
    source: "Research",
    publishedAt: "2026-06-21",
    image: ENTRY_PLACEHOLDER_IMAGES[10],
    tags: [
      { name: "Retrieval", color: "#84cc16" },
      { name: "Evaluation", color: "#6366f1" },
    ],
  },
  {
    id: "demo-12",
    title: "Patchwork creates accessible release summaries",
    summary:
      "A sample release assistant converts structured changes into concise summaries for technical and non-technical audiences without inventing features.",
    source: "Open source",
    publishedAt: "2026-06-17",
    image: ENTRY_PLACEHOLDER_IMAGES[11],
    tags: [
      { name: "Documentation", color: "#f97316" },
      { name: "LLM", color: "#ec4899" },
    ],
  },
];
