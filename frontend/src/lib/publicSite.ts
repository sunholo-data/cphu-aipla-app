export const PUBLIC_SITE_ORIGIN = "https://aipla.ku.dk";
export const PUBLIC_SITE_HOST = "aipla.ku.dk";

export function isPublicSiteHost(host: string | null): boolean {
  return host?.split(":", 1)[0].toLowerCase() === PUBLIC_SITE_HOST;
}
