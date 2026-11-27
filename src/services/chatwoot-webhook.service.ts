import type { Context } from "hono";
import introTask from "@/jobs/intro.task";
import messageReceivedTask from "@/jobs/messageReceived.task";
import messageUpdatedTask from "@/jobs/messageUpdated.task";
import { chatwootBindings } from "@/services/chatwoot.service";
import {
  chatwootJobs,
  verifyChatwootSignature,
  type ChatwootJob,
} from "@/services/chatwoot-events.service";
import { bufferMessage } from "@/services/crisp.service";
import * as db from "@/services/db.service";
import logger from "@/services/logger.service";
import { connection } from "@/services/redis.service";
import { isProjectId } from "@/utils/conversation-id";
import { enqueue } from "@/utils/queue";

const claim = async (key: string, seconds: number) =>
  (await connection.set(key, "1", "EX", seconds, "NX")) === "OK";

const welcomeConfigured = (project: any) =>
  project.options?.type === "text" || project.options?.type === "option";

const dispatch = async (job: ChatwootJob, project: any) => {
  switch (job.kind) {
    case "visitor":
      await bufferMessage(job.data);
      return;
    case "operator":
      await enqueue(messageReceivedTask.queue, "messageReceived", job.data);
      return;
    case "picker":
      // A later edit of the same card would replay the click.
      if (await claim(`crispai:chatwoot-picker:${job.key}`, 7 * 86400))
        await enqueue(messageUpdatedTask.queue, "messageUpdated", job.data);
      return;
    case "intro":
      // Fired on every widget open; welcome at most once an hour per visitor.
      if (
        welcomeConfigured(project) &&
        (await claim(`crispai:chatwoot-intro:${job.key}`, 3600))
      )
        await enqueue(introTask.queue, "intro", job.data);
      return;
  }
};

// Answers 503 rather than 200 while the project or binding is off: Chatwoot
// does not retry 503 and moves the pending conversation to human agents.
export const chatwootWebhook = async (c: Context) => {
  const projectId = c.req.param("project");
  if (!isProjectId(projectId)) return c.json({ message: "无效的请求" }, 404);
  const project = await db.getProjectById(projectId);
  const binding = project?.enabled
    ? await chatwootBindings.load(projectId)
    : null;
  if (!binding?.enabled || !binding.webhookSecret)
    return c.json({ message: "项目未启用 Chatwoot" }, 503);

  const raw = await c.req.text();
  if (
    !verifyChatwootSignature({
      secret: binding.webhookSecret,
      timestamp: c.req.header("x-chatwoot-timestamp"),
      signature: c.req.header("x-chatwoot-signature"),
      body: raw,
    })
  ) {
    logger.warn("Chatwoot webhook signature rejected", { project: projectId });
    return c.json({ message: "无效的请求" }, 401);
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ message: "无效的请求" }, 400);
  }

  const delivery = c.req.header("x-chatwoot-delivery");
  const deliveryKey = delivery
    ? `crispai:chatwoot-delivery:${projectId}:${delivery.slice(0, 64)}`
    : null;
  if (deliveryKey && !(await claim(deliveryKey, 86400)))
    return c.json({ ok: true, skipped: true });
  try {
    for (const job of chatwootJobs(projectId, body, binding.inboxId))
      await dispatch(job, project);
  } catch (error) {
    if (deliveryKey) await connection.del(deliveryKey).catch(() => {});
    throw error;
  }
  return c.json({ ok: true });
};
