/**
 * Returns true when the given URL points to a Glean MCP endpoint —
 * i.e. the hostname ends with `.glean.com` and the path starts with `/mcp/`.
 */
export function isGleanMcpUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(".glean.com") && parsed.pathname.startsWith("/mcp/");
  } catch {
    return false;
  }
}
