import type { Queue } from "bullmq";
import logger from "@/services/logger.service";

/**
 * 安全入队：不阻塞调用方（Webhook 需要尽快响应），
 * 但把失败记录下来，避免 queue.add 的拒绝变成未处理的 Promise 拒绝把进程打挂。
 */
export const enqueue = (queue: Queue, name: string, data: any) =>
  queue.add(name, data).catch((error) => {
    logger.error("任务入队失败", {
      queue: queue.name,
      name,
      code: error?.code,
      message: error?.message,
    });
  });
