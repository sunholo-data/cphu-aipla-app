import { describe, it, expect } from "vitest";

import { readJson } from "@/lib/apiResponse";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fail = (status: number, body = "") => new Response(body, { status });

describe("apiResponse.readJson", () => {
  it("returns the parsed JSON on an ok response", async () => {
    const out = await readJson<{ a: number }>(ok({ a: 1 }), "load thing");
    expect(out).toEqual({ a: 1 });
  });

  it("default error format on non-ok: `<message>: <status> <body>`", async () => {
    await expect(readJson(fail(500, "boom"), "load thing")).rejects.toThrow(
      "load thing: 500 boom",
    );
  });

  it("caps the default body at 200 chars", async () => {
    const big = "x".repeat(500);
    try {
      await readJson(fail(500, big), "load thing");
      throw new Error("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      // "load thing: 500 " (16) + 200 body chars
      expect(msg.length).toBe(16 + 200);
      expect(msg.endsWith("x".repeat(200))).toBe(true);
    }
  });

  it("delegates error construction to toError (status + full body + message)", async () => {
    class MyErr extends Error {
      status: number;
      constructor(m: string, s: number) {
        super(m);
        this.status = s;
      }
    }
    await expect(
      readJson(fail(404, "nope"), "fetch x", {
        toError: ({ status, body, message }) => new MyErr(`${message}#${status}#${body}`, status),
      }),
    ).rejects.toMatchObject({ message: "fetch x#404#nope", status: 404 });
  });

  it("passes the FULL (uncapped) body to toError so it can JSON.parse a detail", async () => {
    const detail = "conflict because reasons";
    const out = readJson(fail(409, JSON.stringify({ detail })), "save x", {
      toError: ({ body, message }) => {
        try {
          const parsed = JSON.parse(body) as { detail?: unknown };
          if (typeof parsed.detail === "string") return new Error(parsed.detail);
        } catch {
          /* ignore */
        }
        return new Error(message);
      },
    });
    await expect(out).rejects.toThrow(detail);
  });

  it("swallows a body-read failure into an empty body (no throw on resp.text())", async () => {
    const broken = {
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream broke")),
    } as unknown as Response;
    await expect(readJson(broken, "load thing")).rejects.toThrow("load thing: 503 ");
  });
});
