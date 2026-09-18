import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service · LifeOS" };

export default function TermsPage() {
  return (
    <article className="text-[15px] leading-relaxed text-ink">
      <h1 className="display-title mt-6">Terms of Service</h1>
      <p className="mt-1 text-[13px] text-ink-2">Effective September 18, 2026</p>

      <Section title="The service">
        <p>
          LifeOS is personal software operated by Joshua Sta Ana for his own individual use. It
          is not offered to the public, has no paying customers, and registration is closed. Use
          of the app is limited to its owner; any other access is unauthorized.
        </p>
      </Section>

      <Section title="Accounts and connected services">
        <p>
          The user is responsible for the credentials used to sign in and for the third-party
          accounts (Google, Notion, Granola) they choose to connect. Connecting an account
          authorizes LifeOS to access it as described in the{" "}
          <a href="/privacy" className="text-accent underline-offset-2 hover:underline">
            Privacy Policy
          </a>
          . Disconnecting an account stops further access.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          The app may not be used to violate any law or the terms of the services it connects
          to, including the Google APIs Terms of Service.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          The app is provided as is, without warranties of any kind, express or implied,
          including fitness for a particular purpose. AI-generated content (extracted tasks,
          summaries, answers, coaching notes) can be wrong and is provided for the user&apos;s
          own review, not as advice.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, the operator is not liable for any indirect,
          incidental, or consequential damages arising from use of the app, including data loss
          or missed tasks and deadlines.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          These terms and the Privacy Policy may be updated as the app evolves; the effective
          date above reflects the current version.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Joshua Sta Ana ·{" "}
          <a href="mailto:joshxnyc@gmail.com" className="text-accent underline-offset-2 hover:underline">
            joshxnyc@gmail.com
          </a>
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-[20px] font-medium text-ink">{title}</h2>
      <div className="mt-2 flex flex-col gap-3 text-ink-2">{children}</div>
    </section>
  );
}
