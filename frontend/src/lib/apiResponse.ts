/**
 * Shared fetch-`Response` → JSON reader.
 *
 * Four API clients (`teacherApi`, `insightsApi`, `curriculumApi`, `costApi`)
 * each hand-rolled the same response-reading mechanics: on ok, cast
 * `resp.json()` to `T`; on non-ok, best-effort read the body
 * (`.text().catch(() => "")`) and throw. Only the error CONSTRUCTION genuinely
 * differs per client (their own error classes + message formats, pinned by
 * their tests). This centralizes the plumbing and leaves the error mapping to
 * each client via `toError`.
 *
 * `toError` receives the FULL body (uncapped) so a mapper can `JSON.parse` it
 * for a `detail` field; the default error caps the body at 200 chars.
 */

export interface ReadJsonOptions {
  /** Build the Error to throw on a non-ok response, from the status, the
   *  best-effort body (uncapped — slice in the mapper as the client did), and
   *  the caller's label. When omitted, a generic
   *  `Error(\`${message}: ${status} ${body.slice(0, 200)}\`)` is thrown. */
  toError?: (ctx: { status: number; body: string; message: string }) => Error;
}

export async function readJson<T>(
  resp: Response,
  message: string,
  opts?: ReadJsonOptions,
): Promise<T> {
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw (
      opts?.toError?.({ status: resp.status, body, message }) ??
      new Error(`${message}: ${resp.status} ${body.slice(0, 200)}`)
    );
  }
  return (await resp.json()) as T;
}
