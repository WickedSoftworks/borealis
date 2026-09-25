const MAX_AUTH_BODY_BYTES = 64 * 1024;

/** Return null as soon as a request exceeds the auth-specific body ceiling. */
export async function boundedAuthBody(
  req: Request,
): Promise<ArrayBuffer | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUTH_BODY_BYTES) return null;

  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}
