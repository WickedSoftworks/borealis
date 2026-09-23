import type { Instrumentation } from "next";

/**
 * Starts the background worker inside the server process.
 *
 * Runs once per server boot, and only on the Node runtime — the edge runtime
 * has no database access and would start a worker that could do nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startWorker } = await import("@/lib/jobs");
  startWorker();
}

/**
 * Every server-side error, as one structured log event — and, when
 * `ERROR_WEBHOOK_URL` is set, as a JSON POST to it.
 *
 * A 500 in a recipient's browser used to leave nothing an operator would ever
 * see beyond an unlabelled stack in stdout. A webhook rather than a vendor
 * SDK: it points at a Sentry-compatible relay, a chat channel, or a script,
 * and adds no dependency to an image meant to run with nothing else.
 *
 * The request's headers are deliberately not forwarded. They carry session
 * cookies and share unlock tokens, and the error report must not become the
 * place those leak.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { log } = await import("@/lib/log");
  const failure = error as Error & { digest?: string };

  // The path can itself hold a share token; keep its shape, not its secret.
  const path = request.path.replace(
    /\/(s|r)\/[A-Za-z0-9_-]{8,}/,
    "/$1/<token>",
  );

  log.error("request.failed", {
    digest: failure.digest,
    method: request.method,
    path,
    route: context.routePath,
    kind: context.routeType,
    error: failure,
  });

  const webhook = process.env.ERROR_WEBHOOK_URL;
  if (!webhook) return;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        time: new Date().toISOString(),
        message: failure.message,
        name: failure.name,
        digest: failure.digest ?? null,
        stack: failure.stack ?? null,
        method: request.method,
        path,
        route: context.routePath,
        routeType: context.routeType,
        instance: process.env.BETTER_AUTH_URL ?? null,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (reportError) {
    log.warn("request.report_failed", { error: reportError });
  }
};
