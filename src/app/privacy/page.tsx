import type { Metadata } from "next";
import Link from "next/link";
import { getPublicEnv } from "@/lib/env/public";
import { getOptionalServerMetadata } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How a self-hosted Curio instance handles personal and submitted data.",
};

const lastUpdated = "August 20, 2026";

export default function PrivacyPage() {
  const publicEnvironment = getPublicEnv();
  const appName = publicEnvironment.NEXT_PUBLIC_APP_NAME;
  const organization = publicEnvironment.NEXT_PUBLIC_ORGANIZATION_NAME || "the instance operator";
  const contact = getOptionalServerMetadata().PRIVACY_CONTACT_EMAIL;

  return (
    <main className="min-h-screen bg-[#F4F7FE] px-5 py-12 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-100 bg-white p-7 shadow-soft sm:p-12">
        <Link href="/" className="text-sm font-bold text-[#0075c9] hover:underline">
          ← Back to {appName}
        </Link>
        <h1 className="mt-8 text-4xl font-black tracking-tight text-[#1B254B]">Privacy notice</h1>
        <p className="mt-2 text-sm font-medium text-slate-400">Last updated: {lastUpdated}</p>
        <p className="mt-8 leading-relaxed text-slate-600">
          This notice describes the default data flow for a self-hosted {appName} instance operated
          by {organization}. Fork operators are responsible for adapting this notice to their
          deployment and applicable law.
        </p>

        <div className="mt-10 space-y-9 text-slate-600 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-[#1B254B] [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          <section>
            <h2>Data collected</h2>
            <ul>
              <li>Google account email, display name and avatar used for authentication.</li>
              <li>Public URLs submitted deliberately by authorized members.</li>
              <li>Generated titles, summaries, selected tags, thumbnails and processing status.</li>
              <li>Security audit events and hashed, scoped extension-token metadata.</li>
            </ul>
            <p className="mt-3">
              The Chrome extension does not monitor browsing history. After the user chooses to save
              the active page, it sends that URL, the selected source type, and selected tags to the
              configured Curio instance.
            </p>
          </section>

          <section>
            <h2>Processors and purpose</h2>
            <p>
              Supabase provides authentication, PostgreSQL and private object storage. Vercel hosts
              the Next.js application and durable workflow execution. Google Gemini reads each
              submitted public URL or public YouTube video to produce a structured title, summary
              and tag suggestions. An operator may optionally enable Microlink; when enabled, it
              receives the submitted public URL and returns preview-image bytes. Data is not sold or
              used for advertising by Curio.
            </p>
          </section>

          <section>
            <h2>Chrome Web Store Limited Use</h2>
            <p>
              Curio&apos;s use and transfer of information received from Google Chrome APIs complies
              with the Chrome Web Store User Data Policy, including its Limited Use requirements.
              That information is used only to provide and secure the disclosed Save to Curio
              feature: sending the page the user deliberately selected to their configured Curio
              instance, creating its catalog entry, and showing it to authorized members. It is not
              used or transferred for advertising, unrelated profiling, sale, or generalized market
              research. Transfers to the processors listed above are limited to what is necessary to
              provide that feature.
            </p>
          </section>

          <section>
            <h2>Retention and access</h2>
            <p>
              Entries remain until an authorized member deletes them. Revoked extension tokens
              cannot be used again; their digest and audit record may be retained for security.
              Operational logs should use the shortest retention supported by the operator’s
              incident-response needs. Only members covered by the configured email-address or
              domain allowlists can access the private dashboard.
            </p>
          </section>

          <section>
            <h2>Security and choices</h2>
            <p>
              Extension tokens are stored locally in the browser and only a one-way digest is stored
              server-side. Users can revoke tokens from their account. Contact the operator to
              request access, correction or deletion of profile data and authored entries.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            {contact ? (
              <p>
                Privacy questions can be sent to{" "}
                <a className="font-bold text-[#0075c9] hover:underline" href={`mailto:${contact}`}>
                  {contact}
                </a>
                .
              </p>
            ) : (
              <p>
                This instance has not configured a privacy contact. The operator must set
                <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-sm">
                  PRIVACY_CONTACT_EMAIL
                </code>
                before deployment.
              </p>
            )}
          </section>
        </div>
      </article>
    </main>
  );
}
