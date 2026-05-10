import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("truncateToolResultText", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadTruncate(envOverrides?: Record<string, string | undefined>) {
    if (envOverrides) {
      for (const [key, val] of Object.entries(envOverrides)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    }
    const mod = await import("./cli-truncation.js");
    return mod.truncateToolResultText;
  }

  it("returns short text unchanged", async () => {
    const truncate = await loadTruncate();
    expect(truncate("hello")).toBe("hello");
  });

  it("truncates text exceeding default char limit", async () => {
    const truncate = await loadTruncate();
    const longText = "x".repeat(5000);
    const result = truncate(longText);
    expect(result).toContain("… (truncated,");
    expect(result).toContain("chars omitted)");
    expect(result.length).toBeLessThan(longText.length);
    expect(result.startsWith("x".repeat(4000))).toBe(true);
  });

  it("truncates text exceeding default line limit", async () => {
    const truncate = await loadTruncate();
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const longText = lines.join("\n");
    const result = truncate(longText);
    expect(result).toContain("… (truncated,");
    const resultLines = result.split("\n");
    // 200 content lines + truncation suffix line
    expect(resultLines.length).toBe(201);
  });

  it("respects custom char limit via env var", async () => {
    const truncate = await loadTruncate({
      PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS: "100",
      PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES: undefined,
    });
    const text = "a".repeat(200);
    const result = truncate(text);
    expect(result).toContain("… (truncated, 100 chars omitted)");
    expect(result.startsWith("a".repeat(100))).toBe(true);
  });

  it("disables truncation when env var is 0", async () => {
    const truncate = await loadTruncate({
      PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS: "0",
      PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES: "0",
    });
    const text = "x".repeat(10000);
    expect(truncate(text)).toBe(text);
  });

  it("disables truncation when env var is negative", async () => {
    const truncate = await loadTruncate({
      PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS: "-1",
      PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES: "-1",
    });
    const text = "x".repeat(10000);
    expect(truncate(text)).toBe(text);
  });

  it("uses default when env var is non-numeric", async () => {
    const truncate = await loadTruncate({
      PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS: "abc",
    });
    const text = "x".repeat(5000);
    const result = truncate(text);
    expect(result).toContain("… (truncated,");
    expect(result.startsWith("x".repeat(4000))).toBe(true);
  });

  it("applies both char and line limits", async () => {
    const truncate = await loadTruncate({
      PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS: "10000",
      PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES: "5",
    });
    const lines = Array.from({ length: 20 }, (_, i) => `short line ${i}`);
    const text = lines.join("\n");
    const result = truncate(text);
    expect(result).toContain("… (truncated,");
    const resultLines = result.split("\n");
    expect(resultLines.length).toBe(6); // 5 content + truncation suffix
  });
});
