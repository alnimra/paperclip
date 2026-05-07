import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { heartbeatService } from "../services/heartbeat.ts";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres tickTimers tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat.tickTimers", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-tick-timers-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    // tickTimers enqueues wakeups that immediately start queued runs in the background.
    // This suite uses randomly generated company IDs per test, so we do not truncate
    // the database (which can race with background run logging and cause FK violations).
    // The embedded postgres instance is disposable and cleaned up in afterAll.
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("skips timer heartbeats when the agent has no actionable assigned work", async () => {
    const now = new Date("2026-05-08T00:00:00.000Z");
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 3).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Timers Co",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Timer Agent",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 60 } },
      lastHeartbeatAt: new Date(now.getTime() - 2 * 60 * 1000),
    });

    const result = await heartbeatService(db).tickTimers(now);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const wakeups = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests);
    expect(wakeups.filter((row) => Boolean(row.id))).toHaveLength(0);

    const runs = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns);
    expect(runs).toHaveLength(0);
  });

  it("enqueues a timer heartbeat with issue context when actionable work exists", async () => {
    const now = new Date("2026-05-08T00:00:00.000Z");
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 3).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Timers Co",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Timer Agent",
      role: "cto",
      status: "idle",
      adapterType: "codex_local",
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 60 } },
      lastHeartbeatAt: new Date(now.getTime() - 2 * 60 * 1000),
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Do the thing",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const result = await heartbeatService(db).tickTimers(now);
    expect(result.enqueued).toBe(1);

    const wakeups = await db
      .select({
        agentId: agentWakeupRequests.agentId,
        payload: agentWakeupRequests.payload,
        source: agentWakeupRequests.source,
      })
      .from(agentWakeupRequests);
    const timerWake = wakeups.find((wakeup) => wakeup.agentId === agentId && wakeup.source === "timer");
    expect(timerWake).toBeTruthy();
    expect(timerWake?.payload).toMatchObject({ issueId });

    const runs = await db
      .select({
        agentId: heartbeatRuns.agentId,
        invocationSource: heartbeatRuns.invocationSource,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns);
    const timerRun = runs.find((run) => run.agentId === agentId && run.invocationSource === "timer");
    expect(timerRun).toBeTruthy();
    expect((timerRun?.contextSnapshot ?? {}) as Record<string, unknown>).toMatchObject({ issueId });
  });
});
