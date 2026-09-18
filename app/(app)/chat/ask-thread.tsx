"use client";

// The Ask thread (SPEC "chat with my data", v1). Q&A pairs are editorial
// blocks, not chat bubbles: the question set in Fraunces as a lead line, the
// answer as body text with [n] citations as accent superscripts, then a
// hairline Sources list that deep-links into the app. State lives in client
// memory only — a refresh clears the thread. Each question is answered
// independently; the previous pair rides along so follow-ups resolve.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FilingIndicator } from "@/components/capture/filing-indicator";
import { askQuestion } from "./actions";
import type { AnswerSource } from "@/lib/ai/pipelines/answer";

interface Turn {
  question: string;
  answer: string;
  sources: AnswerSource[];
  error?: boolean;
}

const EXAMPLES = [
  "What did Bernhard and I agree on last week?",
  "What's overdue in Tarifa?",
  "When did I last talk to Lucas?",
];

/** The answer text with [n] markers rendered as accent superscript links. */
function Cited({ text, sources }: { text: string; sources: AnswerSource[] }) {
  const parts = text.split(/\[(\d+)\]/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const source = sources.find((s) => s.n === Number(part));
        if (!source) return <span key={i}>[{part}]</span>;
        return (
          <sup key={i}>
            <Link
              href={source.href}
              className="px-px font-medium text-accent"
              aria-label={`Source ${part}: ${source.title}`}
            >
              {part}
            </Link>
          </sup>
        );
      })}
    </>
  );
}

function SourceList({ sources }: { sources: AnswerSource[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-4">
      <p className="section-label">Sources</p>
      <ul className="mt-1">
        {sources.map((s) => (
          <li key={`${s.type}-${s.id}`} className="border-b border-line last:border-b-0">
            <Link href={s.href} className="flex min-h-11 items-center gap-3 py-2.5 active:bg-paper-2">
              <span className="tabular w-5 shrink-0 text-right font-mono text-[12px] text-ink-2">
                {s.n}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.title}</span>
              <span className="shrink-0 rounded-[6px] bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-2">
                {s.kind}
              </span>
              {s.date ? (
                <span className="tabular shrink-0 font-mono text-[12px] text-ink-2">{s.date}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AskThread({ initialQuestion }: { initialQuestion?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const askedInitial = useRef(false);
  // The last completed exchange, read inside ask() without re-binding it.
  const lastTurn = useRef<Turn | null>(null);

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, 500);
    if (!question || pending) return;
    setInput("");
    setPending(question);

    const prior = lastTurn.current;
    const res = await askQuestion({
      question,
      priorTurn:
        prior && !prior.error
          ? { question: prior.question, answer: prior.answer.slice(0, 4000) }
          : undefined,
    });

    const turn: Turn = res.ok
      ? { question, answer: res.answer, sources: res.sources }
      : { question, answer: res.error, sources: [], error: true };
    lastTurn.current = turn;
    setTurns((t) => [...t, turn]);
    setPending(null);
  };

  // /chat?q=… (the palette's "Ask about" row) asks on arrival, once.
  useEffect(() => {
    if (initialQuestion && !askedInitial.current) {
      askedInitial.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  useEffect(() => {
    if (turns.length || pending) endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, pending]);

  return (
    <div className="flex flex-col">
      {!turns.length && !pending ? (
        <div className="mt-10">
          <p className="text-[14px] text-ink-2">
            Ask about anything the app holds — tasks, notes, people, and the archived emails,
            meetings and pages. Try one of these.
          </p>
          <div className="mt-4 flex flex-col items-start gap-2">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void ask(q)}
                className="min-h-11 rounded-full border border-line px-4 py-2 text-left text-[14px] text-ink active:bg-paper-2"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col">
        {turns.map((turn, i) => (
          <article key={i} className="border-b border-line py-6 last:border-b-0">
            <p className="display-lead text-ink">{turn.question}</p>
            {turn.error ? (
              <p className="mt-3 text-[14px] text-danger">{turn.answer}</p>
            ) : (
              <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                <Cited text={turn.answer} sources={turn.sources} />
              </p>
            )}
            <SourceList sources={turn.sources} />
          </article>
        ))}

        {pending ? (
          <article className="py-6">
            <p className="display-lead text-ink">{pending}</p>
            <p className="mt-3 text-[14px] text-ink-2">
              <FilingIndicator label="Reading your archive…" />
            </p>
          </article>
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Pinned above the tab bar on the phone, above the page edge on
          desktop; sticky so it stays put while the thread scrolls. */}
      <form
        className="sticky bottom-[84px] mt-6 md:bottom-6"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-card border border-line bg-paper p-2 shadow-whisper">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your tasks, people or archive"
            rows={1}
            maxLength={500}
            enterKeyHint="send"
            className="max-h-32 w-full resize-none bg-transparent p-1.5 text-[15px] text-ink outline-none placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || Boolean(pending)}
            className="h-11 shrink-0 rounded-[8px] px-3 text-[14px] font-medium text-accent disabled:text-ink-3"
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}
