import { redirect } from "next/navigation";
import { getPublicEnv } from "@/lib/env/public";

export default function Home() {
  redirect(getPublicEnv().NEXT_PUBLIC_DEMO_ENABLED ? "/demo" : "/login");
}
