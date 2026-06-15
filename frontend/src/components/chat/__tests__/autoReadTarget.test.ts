import { describe, it, expect } from "vitest";

import { latestAssistantMessageId } from "../autoReadTarget";

const u = (id: string) => ({ id, role: "user" as const });
const a = (id: string) => ({ id, role: "assistant" as const });

describe("latestAssistantMessageId — auto-read plays only the latest turn", () => {
  it("returns null when there are no messages", () => {
    expect(latestAssistantMessageId([])).toBeNull();
  });

  it("returns null when only the student has spoken", () => {
    expect(latestAssistantMessageId([u("1")])).toBeNull();
  });

  it("picks the LAST assistant turn (not the first) — so restored history doesn't all speak", () => {
    // session_start(user) / greet(assistant) / hi(user) / reply(assistant)
    const id = latestAssistantMessageId([u("1"), a("greet"), u("3"), a("reply")]);
    expect(id).toBe("reply"); // only the reply auto-reads, NOT the greet
  });

  it("prefers the latest live assistant turn over restored history", () => {
    const history = [a("hist-greet"), u("hist-hi"), a("hist-reply")];
    const live = [u("live-q"), a("live-answer")];
    expect(latestAssistantMessageId([...history, ...live])).toBe("live-answer");
  });

  it("falls back to history's last assistant when there are no live turns yet (reload)", () => {
    const history = [a("hist-greet"), u("hist-hi"), a("hist-reply")];
    expect(latestAssistantMessageId([...history])).toBe("hist-reply");
  });
});
