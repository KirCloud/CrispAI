import * as telegram from "@/services/telegram.service";
import * as db from "@/services/db.service";
import { Queue } from "bullmq";
import path from "path";
import { createResponse } from "@/utils/general";
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
  schedule: "* * * * *", // 每分钟运行
  concurrency: 100,
  processor: async () => {
    const sessionData = await db.listDisabledSessions();
    const projectData = await db.listProjects();

    const toEnableIds: string[] = [];
    const toDeleteIds: string[] = [];
    for (const session of sessionData) {
      const project = projectData.find(
        (p) => p.websiteId === session.website_id
      );
      if (project) {
        const enableTime =
          new Date(session.enable_time).getTime() + project.timer * 1000;
        if (enableTime < Date.now()) {
          toEnableIds.push(session.session_id);
        }
      } else {
        toDeleteIds.push(session.session_id);
      }
    }

    await db.enableSessions(toEnableIds);
    for (const id of toEnableIds) {
      const session = sessionData.find((s) => s.session_id === id);
      if (session && session.topic_id && session.group_id) {
        try {
          await telegram.default.api.editMessageReplyMarkup(
            session.group_id,
            session.message_id,
            {
              reply_markup: telegram.changeAI(
                session.group_id,
                session.topic_id,
                true
              ),
            }
          );
        } catch {}
      }
    }

    await db.deleteSessions(toDeleteIds);

    return {
      success: true,
      message: "任务执行完成",
      data: { toEnableIds, toDeleteIds },
    };
  },
};
