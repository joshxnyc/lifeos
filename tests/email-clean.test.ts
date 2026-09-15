import { describe, expect, it } from "vitest";
import { cleanEmailText, isNewsletterish, stripQuotedReply, type EmailMessageInput } from "@/lib/email/clean";

const message = (overrides: Partial<EmailMessageInput> = {}): EmailMessageInput => ({
  from: "Bernhard Niesner <bernhard@tarifa.example>",
  to: "Joshua Sta Ana <joshua@example.com>",
  date: "Tue, 15 Sep 2026 09:12:00 -0400",
  subject: "LP consent — Juicy Energy",
  textBody: "Can you send the signed consent by Friday?",
  ...overrides,
});

describe("stripQuotedReply", () => {
  it("cuts a Gmail-style quoted reply", () => {
    const body = [
      "Sounds good, I will send it Friday.",
      "",
      "On Mon, Sep 14, 2026 at 4:02 PM Bernhard <bernhard@tarifa.example> wrote:",
      "",
      "> Can you send the consent?",
      "> Thanks",
    ].join("\n");
    expect(stripQuotedReply(body)).toBe("Sounds good, I will send it Friday.");
  });

  it("cuts a quoted reply whose attribution line wraps", () => {
    const body = [
      "Will do.",
      "",
      "On Mon, Sep 14, 2026 at 4:02 PM Bernhard Niesner <bernhard@tarifa.example>",
      "wrote:",
      "> anything",
    ].join("\n");
    expect(stripQuotedReply(body)).toBe("Will do.");
  });

  it("cuts an Outlook original-message block", () => {
    const body = ["Approved.", "", "-----Original Message-----", "From: Someone", "Sent: Monday", "Old text"].join("\n");
    expect(stripQuotedReply(body)).toBe("Approved.");
  });

  it("cuts an Outlook From/Sent header block", () => {
    const body = ["Approved.", "", "From: Someone <s@example.com>", "Sent: Monday 14 September", "Old text"].join("\n");
    expect(stripQuotedReply(body)).toBe("Approved.");
  });

  it("cuts a forwarded-message block", () => {
    const body = ["FYI.", "", "---------- Forwarded message ---------", "From: Someone", "Old text"].join("\n");
    expect(stripQuotedReply(body)).toBe("FYI.");
  });

  it("cuts HTML-escaped quote markers", () => {
    const body = ["Yes.", "", "&gt; the original question", "&gt; more"].join("\n");
    expect(stripQuotedReply(body)).toBe("Yes.");
  });

  it("cuts an RFC 3676 signature", () => {
    const body = ["Here it is.", "", "--", "Joshua Sta Ana", "New York"].join("\n");
    expect(stripQuotedReply(body)).toBe("Here it is.");
  });

  it("cuts a mobile signature", () => {
    expect(stripQuotedReply("On it.\n\nSent from my iPhone")).toBe("On it.");
    expect(stripQuotedReply("On it.\n\nGet Outlook for iOS")).toBe("On it.");
  });

  it("keeps a double hyphen that is not a signature delimiter", () => {
    expect(stripQuotedReply("The plan -- as discussed -- holds.")).toBe("The plan -- as discussed -- holds.");
  });

  it("cuts at the earliest marker when several appear", () => {
    const body = [
      "Short answer: yes.",
      "",
      "On Mon, Sep 14, 2026 at 4:02 PM Bernhard <b@example.com> wrote:",
      "> question",
      "",
      "--",
      "Bernhard",
    ].join("\n");
    expect(stripQuotedReply(body)).toBe("Short answer: yes.");
  });

  it("normalises line endings and collapses blank runs", () => {
    expect(stripQuotedReply("One.\r\n\r\n\r\n\r\nTwo.   \r\n")).toBe("One.\n\nTwo.");
  });

  it("returns an empty string when the whole body is quoted", () => {
    expect(stripQuotedReply("> everything\n> is quoted")).toBe("");
  });

  it("leaves an ordinary body untouched", () => {
    const body = "Two things:\n\n1. The wire went out.\n2. I will send the memo Friday.";
    expect(stripQuotedReply(body)).toBe(body);
  });
});

describe("cleanEmailText", () => {
  it("keeps a header block per message", () => {
    const text = cleanEmailText([message()]);
    expect(text).toBe(
      [
        "From: Bernhard Niesner <bernhard@tarifa.example>",
        "To: Joshua Sta Ana <joshua@example.com>",
        "Date: Tue, 15 Sep 2026 09:12:00 -0400",
        "Subject: LP consent — Juicy Energy",
        "",
        "Can you send the signed consent by Friday?",
      ].join("\n"),
    );
  });

  it("includes Cc only when there is one", () => {
    expect(cleanEmailText([message({ cc: "ops@tarifa.example" })])).toContain("Cc: ops@tarifa.example");
    expect(cleanEmailText([message({ cc: "  " })])).not.toContain("Cc:");
    expect(cleanEmailText([message()])).not.toContain("Cc:");
  });

  it("joins messages with a rule and strips each one's quoted history", () => {
    const text = cleanEmailText([
      message(),
      message({
        from: "Joshua Sta Ana <joshua@example.com>",
        to: "Bernhard Niesner <bernhard@tarifa.example>",
        textBody: [
          "Yes — sending Friday.",
          "",
          "On Tue, Sep 15, 2026 at 9:12 AM Bernhard <bernhard@tarifa.example> wrote:",
          "> Can you send the signed consent by Friday?",
        ].join("\n"),
      }),
    ]);
    expect(text).toContain("\n\n---\n\n");
    expect(text).toContain("Yes — sending Friday.");
    expect(text).not.toContain("wrote:");
    expect(text.match(/Subject:/g)).toHaveLength(2);
    // The question survives once, in the message that actually asked it.
    expect(text.match(/Can you send the signed consent by Friday\?/g)).toHaveLength(1);
  });

  it("keeps the headers when the body is empty after cleaning", () => {
    const text = cleanEmailText([message({ textBody: "> only quoted text" })]);
    expect(text).toContain("Subject: LP consent — Juicy Energy");
    expect(text.endsWith("Subject: LP consent — Juicy Energy")).toBe(true);
  });

  it("returns an empty string for no messages", () => {
    expect(cleanEmailText([])).toBe("");
  });
});

describe("isNewsletterish", () => {
  it("is true when List-Unsubscribe is present, whatever the header case", () => {
    expect(isNewsletterish({ "List-Unsubscribe": "<mailto:x@y.com>" })).toBe(true);
    expect(isNewsletterish({ "list-unsubscribe": "<mailto:x@y.com>" })).toBe(true);
    expect(isNewsletterish({ "LIST-UNSUBSCRIBE": "<mailto:x@y.com>" })).toBe(true);
  });

  it("ignores an empty List-Unsubscribe", () => {
    expect(isNewsletterish({ "List-Unsubscribe": "  ", From: "a@b.com" })).toBe(false);
  });

  it("is true for no-reply and newsletter senders", () => {
    expect(isNewsletterish({ From: "no-reply@stripe.com" })).toBe(true);
    expect(isNewsletterish({ From: "noreply@github.com" })).toBe(true);
    expect(isNewsletterish({ From: "The Newsletter <newsletter@substack.com>" })).toBe(true);
    expect(isNewsletterish({ From: "notifications@linear.app" })).toBe(true);
    expect(isNewsletterish({ From: "Do Not Reply <donotreply@bank.com>" })).toBe(true);
  });

  it("is true for bulk mail and list headers", () => {
    expect(isNewsletterish({ Precedence: "bulk", From: "a@b.com" })).toBe(true);
    expect(isNewsletterish({ "List-Id": "<list.example.com>", From: "a@b.com" })).toBe(true);
    expect(isNewsletterish({ "Auto-Submitted": "auto-generated", From: "a@b.com" })).toBe(true);
  });

  it("is false for a person writing to a person", () => {
    expect(isNewsletterish({ From: "Bernhard Niesner <bernhard@tarifa.example>", To: "joshua@example.com" })).toBe(
      false,
    );
    expect(isNewsletterish({})).toBe(false);
    expect(isNewsletterish({ "Auto-Submitted": "no", From: "a@b.com" })).toBe(false);
  });
});
