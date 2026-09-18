import { AskThread } from "./ask-thread";

/**
 * /chat — ask a question in plain English, get an answer grounded in your own
 * data with citations (SPEC "chat with my data", v1: keyword retrieval).
 * ?q=… (from the command palette) asks that question on arrival.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initialQuestion = typeof q === "string" && q.trim() ? q.trim().slice(0, 500) : undefined;

  return (
    <div>
      <header className="pt-6">
        <h1 className="display-title">Ask</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Answers come only from your own data, with sources. The thread clears on refresh.
        </p>
      </header>
      <AskThread initialQuestion={initialQuestion} />
    </div>
  );
}
