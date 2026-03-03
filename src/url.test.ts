import { describe, it, expect } from "vitest";
import { isGleanMcpUrl } from "./url";

describe("isGleanMcpUrl()", () => {
  it("matches a standard Glean MCP URL", () => {
    expect(isGleanMcpUrl("https://company-be.glean.com/mcp/v1")).toBe(true);
  });

  it("matches different Glean subdomains", () => {
    expect(isGleanMcpUrl("https://scio-prod-be.glean.com/mcp/v1")).toBe(true);
    expect(isGleanMcpUrl("https://glean-dev-be.glean.com/mcp/v1")).toBe(true);
  });

  it("matches deeper /mcp/ paths", () => {
    expect(isGleanMcpUrl("https://company-be.glean.com/mcp/v2/sse")).toBe(true);
  });

  it("rejects URLs with non-glean hostnames", () => {
    expect(isGleanMcpUrl("https://example.com/mcp/v1")).toBe(false);
    expect(isGleanMcpUrl("https://not-glean.com/mcp/v1")).toBe(false);
  });

  it("rejects URLs without /mcp/ path", () => {
    expect(isGleanMcpUrl("https://company-be.glean.com/api/v1")).toBe(false);
    expect(isGleanMcpUrl("https://company-be.glean.com/")).toBe(false);
  });

  it("rejects hostnames that contain but don't end with .glean.com", () => {
    expect(isGleanMcpUrl("https://glean.com.evil.com/mcp/v1")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isGleanMcpUrl(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGleanMcpUrl("")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isGleanMcpUrl("not-a-url")).toBe(false);
  });
});
