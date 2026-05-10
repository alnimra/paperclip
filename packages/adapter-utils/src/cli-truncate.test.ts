import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("truncateToolResultText", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function importFresh() {
    const mod = await import("./cli-truncate.js");
    return mod.truncateToolResultText;
  }

  it("returns short text unchanged with defaults", async () => {
    const truncate = await importFresh();
    expect(truncate("hello")).toBe("hello");
  });

  it("truncates text exceeding default max chars (4000)", async () => {
    const truncate = await importFresh();
    const long = "x".repeat(5000);
    const result = truncate(long);
    expect(result).toContain("… (truncated, 1000 chars omitted)");
    expect(result.startsWith("x".repeat(4000))).toBe(true);
  });

  it("truncates text exceeding default max lines (200)", async () => {
    const truncate = await importFresh();
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const result = truncate(lines.join("\n"));
    expect(result).toContain("100 lines omitted");
    expect(result).toContain("truncated");
  });

  it("respects PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS env var", async () => {
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS = "10";
    const truncate = await importFresh();
    const result = truncate("0123456789ABCDEFGHIJ");
    expect(result).toContain("0123456789");
    expect(result).toContain("truncated");
    expect(result).toContain("10 chars omitted");
  });

  it("respects PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES env var", async () => {
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES = "3";
    const truncate = await importFresh();
    const result = truncate("a\nb\nc\nd\ne");
    expect(result).toContain("2 lines omitted");
    expect(result).toContain("truncated");
  });

  it("disables char truncation when env var is 0", async () => {
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS = "0";
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES = "0";
    const truncate = await importFresh();
    const long = "x".repeat(10000);
    expect(truncate(long)).toBe(long);
  });

  it("uses overrides when provided", async () => {
    const truncate = await importFresh();
    const result = truncate("0123456789ABCDEF", { maxChars: 5, maxLines: null });
    expect(result).toContain("01234");
    expect(result).toContain("11 chars omitted");
  });

  it("applies both char and line truncation", async () => {
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS = "50";
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES = "2";
    const truncate = await importFresh();
    const input = "line1\nline2\nline3\nline4\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const result = truncate(input);
    expect(result).toContain("truncated");
    expect(result).toContain("lines omitted");
  });

  it("falls back to default for non-numeric env var", async () => {
    process.env.PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS = "not-a-number";
    const truncate = await importFresh();
    const short = "x".repeat(100);
    expect(truncate(short)).toBe(short);
  });
});
