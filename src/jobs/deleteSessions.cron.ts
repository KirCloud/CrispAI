import * as db from "@/services/db.service";
import { Job, Queue } from "bullmq";
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
  schedule: "0 */1 * * *", // 每小时运行
  concurrency: 100,
  processor: async (job: Job) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    job.log("30天前的时间戳:" + thirtyDaysAgo.toISOString());

    const deletedIds = await db.deleteSessionsBefore(thirtyDaysAgo);
    job.log("已删除：" + deletedIds.length);

    return createResponse(true, `已删除 ${deletedIds.length} 个过期会话`);
  },
};
