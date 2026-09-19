import { notFound } from "next/navigation";
import CaptureStudio from "@/components/demo/CaptureStudio";

export const dynamic = "force-dynamic";

/** Local-only recording harness. Never available in a production build. */
export default function StudioPage() {
  if (process.env.NODE_ENV !== "development" || process.env.CURIO_CAPTURE_MODE !== "true")
    notFound();
  return <CaptureStudio />;
}
