import { Worker, Queue } from "bullmq";
import { glob } from "glob";
import logger from "@/services/logger.service";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "hono/bun";
import type { JobItem } from "@/types/job";
import { connection } from "@/services/redis.service";

// Bull Board 配置
export const serverAdapter = new HonoAdapter(serveStatic);

// 优雅关闭的最长等待时间，超过后强制退出，避免卡住后被 Docker 直接 SIGKILL
const SHUTDOWN_TIMEOUT = 10_000;

/**
 * 自动加载所有 worker 任务
 */
export async function loadWorkers() {
  try {
    // 获取所有 .ts 文件
    const taskFiles = await glob("src/jobs/**/*.ts", {
      cwd: process.cwd(),
      absolute: true,
    });

    const workers: Worker[] = [];
    const queues: Queue[] = [];

    for (const taskFile of taskFiles) {
      try {
        // 动态导入任务文件
        const taskModule = await import(taskFile);
        const {
          name,
          queue,
          schedule,
          processor,
          concurrency,
          options,
        }: JobItem = taskModule.default;

        // 如果导出了队列，收集它
        if (taskModule.default && name) {
          // 创建队列
          queues.push(queue);
          // Redis 连接异常只记录日志
          queue.on("error", (err) => {
            logger.error("queue error", {
              queue: queue.name,
              code: (err as any)?.code,
              message: err?.message,
            });
          });

          // 如果有定时任务，创建 Cron 任务
          if (schedule) {
            // 不阻塞启动；失败（例如 Redis 暂时不可用）只记录日志，避免变成未处理的 Promise 拒绝
            const scheduler: Promise<unknown> =
              Bun.env.NODE_ENV !== "production"
                ? queue.removeJobScheduler(name)
                : queue.upsertJobScheduler(name, { pattern: schedule });
            scheduler.catch((err) => {
              logger.error("配置定时任务失败", {
                queue: queue.name,
                message: err?.message,
              });
            });
          }

          // 如果有处理器，创建 Worker
          if (processor) {
            const worker = new Worker(queue.name, processor, {
              concurrency: concurrency || 10,
              connection,
              ...options,
            });

            worker.on("failed", (job, err) => {
              logger.error("job failed", {
                queue: queue.name,
                jobId: job?.id,
                name: job?.name,
                attemptsMade: job?.attemptsMade,
                data: job?.data,
                code: (err as any)?.code,
                message: err?.message,
                stack: err?.stack,
              });
            });
            worker.on("error", (err) => {
              logger.error("worker error", {
                queue: queue.name,
                code: (err as any)?.code,
                message: err?.message,
                stack: err?.stack,
              });
            });
            worker.on("stalled", (jobId) => {
              logger.warn("job stalled", { queue: queue.name, jobId });
            });

            workers.push(worker);
          }
        }
      } catch (error) {
        logger.error(`加载任务文件失败 ${taskFile}:`, error);
      }
    }

    // 创建 Bull Board
    createBullBoard({
      queues: queues.map((queue) => new BullMQAdapter(queue)),
      serverAdapter,
    });

    logger.info(`总共加载了 ${workers.length} 个 Workers`);
    logger.info("Bull Board 已配置完成");

    return { workers, queues };
  } catch (error) {
    logger.error("加载 Workers 失败:", error);
    return { workers: [], queues: [] };
  }
}

// 优雅关闭处理
export function setupWorkerShutdown(workers: Worker[], queues: Queue[] = []) {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`接收到 ${signal} 信号，正在关闭 Workers 和队列...`);

    // worker.close() 会等待进行中的任务结束，任务卡住时不能无限等
    const forceExit = setTimeout(() => {
      logger.warn(`关闭超过 ${SHUTDOWN_TIMEOUT / 1000} 秒仍未完成，强制退出`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      // 关闭所有 Workers
      await Promise.all(workers.map((worker) => worker.close()));

      // 关闭所有队列
      await Promise.all(queues.map((queue) => queue.close()));

      // Queue/Worker 用的是共享的 ioredis 实例，BullMQ 不会替我们断开
      await connection.quit().catch(() => {});

      logger.info("所有 Workers 和队列已关闭");
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error("关闭 Workers 和队列时出错:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
