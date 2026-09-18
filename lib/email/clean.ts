// Email thread cleaning (SPEC §6.1). A Gmail thread becomes one source_item
// whose `text` is what the extraction sweep reads, so quoted replies have to
// go: left in, every message in a 10-message thread repeats the whole thread
// and the LLM re-extracts commitments it already saw. Headers stay — the sweep
// needs to know who said what to whom, and when.

export interface EmailMessageInput {
  from: string;
  to: string;
  cc?: string;
  date: string;
  subject: string;
  textBody: string;
}

/** Everything from the first match onwards is quoted history, not new text. */
const QUOTE_MARKERS: RegExp[] = [
  /^On\s[\s\S]{5,300}?wrote:\s*$/m, // Gmail/Apple Mail, incl. the two-line wrap
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*-{3,}\s*Forwarded message\s*-{3,}/im,
  /^\s*(?:>|&gt;)/m, // quoted lines
  /^From:\s.{1,300}\n(?:Sent|Date|To):\s/m, // Outlook header block
  /^_{5,}\s*$/m,
  /^\s*={5,}\s*$/m,
];

/** Everything from the first match onwards is a signature. */
const SIGNATURE_MARKERS: RegExp[] = [
  /^--\s*$/m, // RFC 3676 signature delimiter
  /^Sent from my .{0,60}$/im,
  /^Get Outlook for (?:iOS|Android).*$/im,
];

function cutAt(text: string, markers: RegExp[]): string {
  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut);
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip quoted replies and signatures from one message body. */
export function stripQuotedReply(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n").replace(/ /g, " ");
  return tidy(cutAt(cutAt(normalized, QUOTE_MARKERS), SIGNATURE_MARKERS));
}

/**
 * One plain-text block per message — a compact header block plus the message's
 * own words — separated by a rule. Order is the caller's (oldest first reads
 * best for extraction).
 */
export function cleanEmailText(rawBodies: EmailMessageInput[]): string {
  return rawBodies
    .map((message) => {
      const header = [
        `From: ${message.from.trim()}`,
        `To: ${message.to.trim()}`,
        message.cc?.trim() ? `Cc: ${message.cc.trim()}` : null,
        `Date: ${message.date.trim()}`,
        `Subject: ${message.subject.trim()}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const body = stripQuotedReply(message.textBody ?? "");
      return body ? `${header}\n\n${body}` : header;
    })
    .join("\n\n---\n\n");
}

const NEWSLETTER_FROM =
  /(?:no-?reply|noreply|do-?not-?reply|newsletter|notifications?@|mailer-daemon|updates@|marketing@)/i;

/**
 * Newsletters, receipts and notification mail are skipped by the Gmail sync
 * and never extracted. Header names are matched case-insensitively.
 */
export function isNewsletterish(headers: Record<string, string>): boolean {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") lower.set(key.toLowerCase(), value);
  }
  const has = (name: string) => (lower.get(name) ?? "").trim().length > 0;
  if (has("list-unsubscribe") || has("list-id") || has("list-post")) return true;
  const precedence = (lower.get("precedence") ?? "").toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return true;
  if (has("auto-submitted") && (lower.get("auto-submitted") ?? "").toLowerCase() !== "no") return true;
  return NEWSLETTER_FROM.test(lower.get("from") ?? "");
}
