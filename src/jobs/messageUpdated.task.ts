import * as crisp from "@/services/crisp.service";
import * as db from "@/services/db.service";
import * as telegram from "@/services/telegram.service";
import { Queue } from "bullmq";
import path from "path";
import { createResponse } from "@/utils/general";
import { createTelegramSession } from "@/utils/general";
import { connection } from "@/services/redis.service";

const currentFileName = path.basename(
  import.meta.url,
  path.extname(import.meta.url)
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
  processor: async (job: any) => {
    const { website_id, session_id, content } = job.data;
    const cleanSessionId = session_id.replace("session_", "");

    const isPicker = content.id ? true : false;
    if (!isPicker) return createResponse(false, "跳过非选项消息");

    await crisp.composeMessage(website_id, session_id, true);
    const project = await db.getProject(website_id);
    if (!project) return createResponse(false, "项目不存在");

    const options = await db.getOption(project.id);
    const currentOption = options.find((o) => o.id === content.id);
    if (!currentOption) return createResponse(false, "当前选项不存在");

    const tasks = content.choices.map(async (choice: any, i: number) => {
      if (!choice.selected) return;

      const replyOption = currentOption.options[i].trigger;
      let replyContent: string | undefined;

      switch (replyOption.type) {
        case "text":
          replyContent = replyOption.text;
          await crisp.sendMessage(
            website_id,
            session_id,
            replyContent!,
            project.botName,
            project.botIcon
          );
          break;

        case "option":
          const nextOption = options.find((o) => o.id === replyOption.optionId);
          if (nextOption) {
            replyContent = nextOption.text;
            await crisp.sendOption(
              website_id,
              session_id,
              nextOption,
              project.botName,
              project.botIcon
            );
          }
          break;

        case "closeAI":
          replyContent = "已关闭智能回复，请等待人工客服接入...";
          await db.setSessionReply(cleanSessionId, false);

          await crisp.sendMessage(
            website_id,
            session_id,
            replyContent,
            project.botName,
            project.botIcon
          );
          break;
      }

      // 发送到 Telegram
      if (project.telegramId && replyContent) {
        let session = await db.getSession(cleanSessionId);
        if (!session) {
          session = await createTelegramSession(
            cleanSessionId,
            website_id,
            project
          );
        }

        const flow = [
          "🧾<b>用户选择</b>：",
          currentOption.options[i].label,
          "",
          "💡<b>智能回复</b>：",
          replyContent,
        ];

        await telegram.default.api.sendMessage(
          session.group_id,
          flow.join("\n"),
          {
            message_thread_id: session.topic_id,
            parse_mode: "HTML",
          }
        );
      }
    });

    await Promise.all(tasks);
    return createResponse(true, "任务执行成功");
  },
};
