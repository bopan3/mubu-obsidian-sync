const AUTH_HOSTS = new Set([
  "open.weixin.qq.com",
  "open.work.weixin.qq.com",
  "graph.qq.com",
  "accounts.google.com"
]);

export function isAllowedLoginNavigation(rawUrl: string): boolean {
  if (rawUrl === "about:blank") return true;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "mubu.com" || host.endsWith(".mubu.com") || AUTH_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function safeUrlForLog(rawUrl: string): string {
  if (rawUrl === "about:blank") return rawUrl;
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid URL]";
  }
}
