import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy · LifeOS" };

/**
 * Written for what LifeOS actually is: a single-user personal tool operated
 * by its one user. The Google API section carries the Limited Use disclosure
 * Google requires of apps holding Gmail scopes.
 */
export default function PrivacyPage() {
  return (
    <article className="text-[15px] leading-relaxed text-ink">
      <h1 className="display-title mt-6">Privacy Policy</h1>
      <p className="mt-1 text-[13px] text-ink-2">Effective September 18, 2026</p>

      <Section title="What LifeOS is">
        <p>
          LifeOS is a personal task and life-management application operated by its owner for
          their own individual use. It is not a public service: there is a single user account,
          and the only person whose data the app holds is the operator. This policy exists so
          that the services LifeOS connects to, and anyone reviewing the app, can see exactly
          how data is handled.
        </p>
      </Section>

      <Section title="Data the app stores">
        <p>
          Tasks, notes, projects, routines, voice and text captures, people records, and weekly
          reviews the user creates; and, when the user connects an account, copies of content
          from those sources: email threads and calendar events from Google, meeting notes from
          Granola, and pages from Notion. All of it is stored in a private Supabase (PostgreSQL)
          database controlled by the user, protected by row-level security. OAuth tokens are
          encrypted at rest with AES-256-GCM.
        </p>
      </Section>

      <Section title="Google user data">
        <p>
          When the user connects a Google account, LifeOS requests read-only access to Gmail
          (gmail.readonly) and read/write access to Google Calendar. Gmail content is read to
          display it to the user and to extract, using an AI model, commitments, deadlines, and
          follow-ups that the user then reviews and accepts or dismisses. Calendar events are
          read to display the user&apos;s day; the app writes only to one calendar the user
          designates, and never modifies events it did not create.
        </p>
        <p>
          LifeOS&apos;s use and transfer to any other application of information received from
          Google APIs will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-accent underline-offset-2 hover:underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          Specifically: Google user data is used only to provide the app&apos;s user-facing
          features to its one user. It is never sold, never used for advertising, never shared
          with other people, and never used to train generalized artificial-intelligence or
          machine-learning models. Humans other than the user do not read it.
        </p>
      </Section>

      <Section title="AI processing">
        <p>
          To provide extraction, filing, transcription, search answers, and coaching features,
          relevant snippets of the user&apos;s data are sent to large language models through
          OpenRouter (which routes to model providers such as Anthropic and Google). These
          requests are made solely to produce a result shown to the user, and the app instructs
          providers not to use the data beyond serving the request. No data is used to train
          models on LifeOS&apos;s behalf.
        </p>
      </Section>

      <Section title="Service providers">
        <p>
          LifeOS runs on Vercel (hosting), Supabase (database, authentication, file storage),
          and OpenRouter (AI processing), and communicates with the services the user connects
          (Google, Notion, Granola). These providers process data only to run the app. No data
          is sold or shared with anyone else.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          Data is kept until the user deletes it. The user can delete individual items in the
          app, export everything from Settings, and disconnect any connected account at any
          time, which stops further syncing. Google access can also be revoked at{" "}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-accent underline-offset-2 hover:underline"
          >
            myaccount.google.com/permissions
          </a>
          . On request to the contact below, all stored data, including archived Google data,
          is deleted.
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
