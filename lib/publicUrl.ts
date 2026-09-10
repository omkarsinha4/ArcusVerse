/**
 * Build an absolute public URL WhatsApp (and other apps) can auto-detect.
 * Always includes http(s):// and avoids trailing slashes / whitespace.
 */
export function absoluteAppBase(raw?: string | null): string {
  let base = String(raw || "").trim();
  if (!base && typeof window !== "undefined") base = window.location.origin;
  base = base.replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base;
}

export function registrationPublicUrl(base: string | null | undefined, slugOrToken: string | null | undefined): string {
  const root = absoluteAppBase(base);
  const path = String(slugOrToken || "")
    .trim()
    .replace(/^\/+/, "");
  if (!root || !path) return "";
  return `${root}/register/${path}`;
}

/** Prefill text for WhatsApp share — URL alone on its own line for link detection. */
export function whatsappShareHref(publicUrl: string, title?: string): string {
  const url = String(publicUrl || "").trim();
  if (!url) return "";
  const heading = String(title || "Tournament registration").trim();
  const text = `${heading}\n\n${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
