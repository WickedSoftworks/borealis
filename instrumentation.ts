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
