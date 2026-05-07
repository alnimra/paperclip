import { spawn } from "node:child_process";
import type { Request } from "express";
import { logger } from "../middleware/logger.js";

const pendingHooks = new Map<string, ReturnType<typeof setTimeout>>();
const runningHooks = new Set<string>();
const MAX_CAPTURE_CHARS = 32_000;

type IssueRoutingHookEvent = "issue.created" | "issue.child_created" | "issue.updated";

interface IssueRoutingHookIssue {
  id: string;
  identifier: string | null;
  companyId: string;
}

interface IssueRoutingHookActor {
  actorType: "agent" | "user" | "system" | "plugin";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
}

export interface IssueRoutingHookInput {
  event: IssueRoutingHookEvent;
  issue: IssueRoutingHookIssue;
  actor: IssueRoutingHookActor;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}

export function isIssueRoutingHookBypassed(req: Request): boolean {
  const raw =
    req.header("x-paperclip-routing-hook") ??
    req.header("x-paperclip-router") ??
    req.header("x-paperclip-skip-routing-hook") ??
    "";
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "skip" || normalized === "awareos-deterministic";
}

export function shouldRouteIssueUpdate(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const fields = body as Record<string, unknown>;
  return [
    "title",
    "description",
    "status",
    "priority",
    "assigneeAgentId",
    "assigneeUserId",
    "blockedByIssueIds",
    "projectId",
    "goalId",
    "parentId",
    "labelIds",
  ].some((key) => Object.prototype.hasOwnProperty.call(fields, key));
}

export function queueIssueRoutingHook(input: IssueRoutingHookInput): void {
  const command = process.env.PAPERCLIP_ISSUE_ROUTER_COMMAND?.trim();
  if (!command || process.env.PAPERCLIP_ISSUE_ROUTER_DISABLED === "true") return;

  const delayMs = parsePositiveInt(process.env.PAPERCLIP_ISSUE_ROUTER_DELAY_MS, 500);
  const key = input.issue.id;
  const existing = pendingHooks.get(key);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(() => {
    pendingHooks.delete(key);
    runIssueRoutingHook(input, command);
  }, delayMs);
  pendingHooks.set(key, timeout);
}

function runIssueRoutingHook(input: IssueRoutingHookInput, command: string): void {
  const key = input.issue.id;
  if (runningHooks.has(key)) {
    queueIssueRoutingHook(input);
    return;
  }

  runningHooks.add(key);
  // The server can be configured with a public/remote PAPERCLIP_API_URL (e.g. a Tailscale hostname)
  // for UI and agent processes. The routing hook runs locally alongside the server, so it should
  // prefer the runtime loopback URL when available to avoid DNS/network dependency.
  const routingApiUrl = process.env.PAPERCLIP_RUNTIME_API_URL?.trim() || process.env.PAPERCLIP_API_URL?.trim() || "";
  const timeoutMs = parsePositiveInt(process.env.PAPERCLIP_ISSUE_ROUTER_TIMEOUT_MS, 30_000);
  const issueRef = input.issue.identifier ?? input.issue.id;
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const child = spawn("/bin/sh", ["-lc", command], {
    env: {
      ...process.env,
      ...(routingApiUrl ? { PAPERCLIP_API_URL: routingApiUrl } : {}),
      PAPERCLIP_ROUTING_HOOK: "1",
      PAPERCLIP_ISSUE_ID: issueRef,
      PAPERCLIP_ISSUE_UUID: input.issue.id,
      PAPERCLIP_ISSUE_IDENTIFIER: input.issue.identifier ?? "",
      PAPERCLIP_COMPANY_ID: input.issue.companyId,
      PAPERCLIP_ROUTING_EVENT: input.event,
      PAPERCLIP_ROUTING_ACTOR_TYPE: input.actor.actorType,
      PAPERCLIP_ROUTING_ACTOR_ID: input.actor.actorId,
      PAPERCLIP_ROUTING_AGENT_ID: input.actor.agentId ?? "",
      PAPERCLIP_RUN_ID: input.actor.runId ?? process.env.PAPERCLIP_RUN_ID ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk);
  });
  child.on("error", (err) => {
    clearTimeout(timer);
    runningHooks.delete(key);
    logger.warn({ err, issueId: input.issue.id, issueRef }, "issue routing hook failed to start");
  });
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    runningHooks.delete(key);
    if (timedOut) {
      logger.warn({ issueId: input.issue.id, issueRef, timeoutMs, stdout, stderr }, "issue routing hook timed out");
      return;
    }
    if (code !== 0) {
      logger.warn({ issueId: input.issue.id, issueRef, code, signal, stdout, stderr }, "issue routing hook failed");
      return;
    }
    logger.info({ issueId: input.issue.id, issueRef, event: input.event, stdout }, "issue routing hook completed");
  });
}
