import type { Metadata } from "next";
import { getPublicEnv } from "@/lib/env/public";
import "./globals.css";

const appName = getPublicEnv().NEXT_PUBLIC_APP_NAME;

export const metadata: Metadata = {
  title: {
    default: `${appName} — AI-assisted knowledge base`,
    template: `%s | ${appName}`,
  },
  description: "Curate, summarize and retrieve your team's technical knowledge.",
  applicationName: appName,
  icons: {
    icon: [
      { url: "/curio-tab-logo.svg", type: "image/svg+xml" },
      { url: "/curio-logo.png", type: "image/png" },
    ],
    shortcut: "/curio-tab-logo.svg",
    apple: "/curio-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-noise selection:bg-primary/30">{children}</body>
    </html>
  );
}
