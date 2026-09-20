import * as db from "@/services/db.service";
import * as crisp from "@/services/crisp.service";
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
  concurrency: 100,
  processor: async (job: any) => {
    const { website_id, session_id } = job.data;
    const project = await db.getProject(website_id);
    if (!project) return createResponse(false, "未找到项目");

    const data = await crisp.getMessages(website_id, session_id);
    if (data.length > 0) {
      const message = data[data.length - 1];
      if (message.timestamp + 1000 * 60 * 60 > Date.now()) {
        return createResponse(false, "已有用户消息，无需发送欢迎语");
      }
    }
    if (!project.options.type || project.options.type === "none") {
      return createResponse(true, "无需发送欢迎语");
    }

    if (project.options.type === "text") {
      await crisp.sendMessage(
        website_id,
        session_id,
        project.options.text,
        project.botName,
        project.botIcon
      );
    } else if (project.options.type === "option") {
      const options = await db.getOption(project.id);
      const option = options.find(
        (option) => option.id === project.options.optionId
      );
      if (!option) {
        return createResponse(false, "未找到欢迎语选项");
      }
      await crisp.sendOption(
        website_id,
        session_id,
        option,
        project.botName,
        project.botIcon
      );
    }
    return createResponse(true, "欢迎语发送成功");
  },
};
