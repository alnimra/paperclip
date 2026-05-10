const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_LINES = 200;

function readEnvInt(name: string, defaultValue: number): number | null {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const trimmed = raw.trim();
  if (!trimmed) return defaultValue;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed <= 0 ? null : parsed;
}

const maxChars = readEnvInt("PAPERCLIP_CLI_MAX_TOOL_RESULT_CHARS", DEFAULT_MAX_CHARS);
const maxLines = readEnvInt("PAPERCLIP_CLI_MAX_TOOL_RESULT_LINES", DEFAULT_MAX_LINES);

export function truncateToolResultText(text: string): string {
  if (maxChars === null && maxLines === null) return text;

  let result = text;
  let truncated = false;

  if (maxChars !== null && result.length > maxChars) {
    result = result.slice(0, maxChars);
    truncated = true;
  }

  if (maxLines !== null) {
    const lines = result.split("\n");
    if (lines.length > maxLines) {
      result = lines.slice(0, maxLines).join("\n");
      truncated = true;
    }
  }

  if (truncated) {
    const omittedChars = text.length - result.length;
    result += `\n… (truncated, ${omittedChars} chars omitted)`;
  }

  return result;
}
