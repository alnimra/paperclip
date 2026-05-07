import { describe, expect, it } from "vitest";
import { compactRunLogChunk } from "../services/heartbeat.js";

describe("compactRunLogChunk", () => {
  it("redacts inline base64 image data from structured log chunks", () => {
    const base64 = "A".repeat(4096);
    const chunk = `{"type":"user","message":{"content":[{"type":"image","source":{"type":"base64","data":"${base64}"}}]}}\n`;

    const compacted = compactRunLogChunk(chunk);

    expect(compacted).not.toContain(base64);
    expect(compacted).toContain("[omitted base64 image data: 4096 chars]");
  });

  it("redacts sensitive auth tokens from run logs", () => {
    const chunk = [
      "PAPERCLIP_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature",
      "Authorization: Bearer sk-abc123",
      "x-openclaw-token: secret123",
    ].join("\n");

    const compacted = compactRunLogChunk(chunk);

    expect(compacted).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(compacted).not.toContain("sk-abc123");
    expect(compacted).not.toContain("secret123");
    expect(compacted).toContain("PAPERCLIP_API_KEY=***REDACTED***");
    expect(compacted).toContain("Authorization: Bearer ***REDACTED***");
    expect(compacted).toContain("x-openclaw-token: ***REDACTED***");
  });

  it("truncates oversized chunks after sanitizing them", () => {
    const chunk = `${"x".repeat(90_000)}tail`;

    const compacted = compactRunLogChunk(chunk, 16_384);

    expect(compacted.length).toBeLessThan(chunk.length);
    expect(compacted).toContain("[paperclip truncated run log chunk:");
    expect(compacted.endsWith("tail")).toBe(true);
  });
});
