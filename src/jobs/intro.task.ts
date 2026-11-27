import { resolveAbuseState } from "@/services/abuse-runtime.service";
import { withConversationLock } from "@/services/conversation-lock.service";
import * as db from "@/services/db.service";
import * as chat from "@/services/chat.service";
import { startConversation } from "@/services/chatwoot.service";
import { chatwootProjectOf } from "@/utils/conversation-id";
import { Queue } from "bullmq";
import path from "path";
import { createResponse } from "@/utils/general";
import { connection } from "@/services/redis.service";

const currentFileName = path.basename(
  import.meta.url,
  path.extname(import.meta.url),
);
export default {
  name: currentFileName,
  queue: new Queue(currentFileName, {
    connection,
    defaultJobOptions: {
      // 任务成功完成后，只保留最新的 100 条（或 1000 条，看你需要）
      removeOnComplete: {
        count: 100,
        age: 24 * 3600, // (可选) 同时限制时间，例如只保留24小时内的
      },
      // 任务失败后，保留最新的 1000 条以便排查错误
      removeOnFail: {
        count: 100,
      },
    },
  }),
  concurrency: 100,
  processor: async (job: any) =>
    withConversationLock(
      connection,
      job.data.website_id,
      job.data.session_id ?? "intro:" + job.data.chatwoot?.sourceId,
      () => processIntro(job),
    ),
};
async function processIntro(job: any) {
  const { website_id } = job.data;
  const project = await db.getProject(website_id);
  if (!project) return createResponse(false, "未找到项目");
  if (!project.options.type || project.options.type === "none") {
    return createResponse(true, "无需发送欢迎语");
  }

  // A Chatwoot visitor who has never written has no conversation to greet in.
  let session_id: string = job.data.session_id;
  if (!session_id) {
    const chatwootProject = chatwootProjectOf(website_id);
    if (!chatwootProject || !job.data.chatwoot)
      return createResponse(false, "缺少会话");
    session_id = await startConversation(chatwootProject, job.data.chatwoot);
  }

  const state = await resolveAbuseState(website_id, session_id, () =>
    chat.getVisitorEmail(website_id, session_id),
  );
  if (state.blocked) return createResponse(true, "智能会话已结束");
  const lastMessage = await chat.lastMessageAt(website_id, session_id);
  if (lastMessage && lastMessage + 1000 * 60 * 60 > Date.now()) {
    return createResponse(false, "已有用户消息，无需发送欢迎语");
  }

  if (project.options.type === "text") {
    await chat.sendMessage(
      website_id,
      session_id,
      project.options.text,
      project.botName,
      project.botIcon,
    );
  } else if (project.options.type === "option") {
    const options = await db.getOption(project.id);
    const option = options.find(
      (option) => option.id === project.options.optionId,
    );
    if (!option) {
      return createResponse(false, "未找到欢迎语选项");
    }
    await chat.sendOption(
      website_id,
      session_id,
      option,
      project.botName,
      project.botIcon,
    );
  }
  return createResponse(true, "欢迎语发送成功");
}
