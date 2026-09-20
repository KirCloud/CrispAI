import * as db from "@/services/db.service";
import * as telegram from "@/services/telegram.service";
import { Queue } from "bullmq";
import path from "path";
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
    const { data } = job;
    const query = data.split("_");
    if (query.length == 3) {
      const action = query[0] === "close" ? false : true;
      const group_id = parseInt(query[1]);
      const topic_id = parseInt(query[2]);
      await db.setSessionReplyByTopic(group_id, topic_id, action);

      try {
        await telegram.default.api.editMessageReplyMarkup(
          group_id,
          topic_id + 1,
          {
            reply_markup: telegram.changeAI(group_id, topic_id, action),
          }
        );
      } catch {}
    }
    return { success: true };
  },
};
