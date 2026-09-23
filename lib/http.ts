/**
 * Build a Content-Disposition header safely.
 *
 * `originalName` is attacker-controlled (it's whatever the uploader named the
 * file), so interpolating it raw allows header injection via quotes or CRLF.
 * We emit an ASCII-sanitised `filename` plus an RFC 5987 `filename*`.
 */
export function contentDisposition(
  name: string,
  type: "attachment" | "inline" = "attachment",
) {
  const fallback = name.replace(/[^\w.-]+/g, "_").slice(0, 200) || "download";

  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
