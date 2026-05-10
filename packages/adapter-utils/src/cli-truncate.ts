const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_LINES = 200;

function readEnvLimit(envVar: string, defaultValue: number): number | null {
  const raw = process.env[envVar];
  if (raw === undefined) return defaultValue;
  const trimmed = raw.trim();
  if (!trimmed) return defaultValue;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed <= 0 ? null : parsed;
}

const resolvedMaxChars = readEnvLimit("PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS", DEFAULT_MAX_CHARS);
const resolvedMaxLines = readEnvLimit("PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES", DEFAULT_MAX_LINES);

export function truncateToolResultText(
  text: string,
  overrides?: { maxChars?: number | null; maxLines?: number | null },
): string {
  const maxChars = overrides?.maxChars !== undefined ? overrides.maxChars : resolvedMaxChars;
  const maxLines = overrides?.maxLines !== undefined ? overrides.maxLines : resolvedMaxLines;

  if (maxChars === null && maxLines === null) return text;

  let result = text;
  let truncated = false;
  let omittedChars = 0;
  let omittedLines = 0;

  if (maxLines !== null) {
    const lines = result.split("\n");
    if (lines.length > maxLines) {
      omittedLines = lines.length - maxLines;
      result = lines.slice(0, maxLines).join("\n");
      truncated = true;
    }
  }

  if (maxChars !== null && result.length > maxChars) {
    omittedChars = result.length - maxChars;
    result = result.slice(0, maxChars);
    truncated = true;
  }

  if (truncated) {
    const parts: string[] = [];
    if (omittedChars > 0) parts.push(`${omittedChars} chars omitted`);
    if (omittedLines > 0) parts.push(`${omittedLines} lines omitted`);
    result += `\n… (truncated, ${parts.join(", ")})`;
  }

  return result;
}
