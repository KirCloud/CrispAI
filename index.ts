import logger from "@/services/logger.service";
import hono, { authMiddleware, mountWeb } from "@/services/hono.service";
import { migrate } from "@/services/db.service";
import { setupWebhook } from "@/services/telegram.service";
import { loadWorkers, serverAdapter, setupWorkerShutdown } from "@/workers";

// 进程级兜底：只记录日志，不退出进程。
// 之前这里会 process.exit(1)，任何一处没接住的 Promise 拒绝（网络抖动、Redis/Postgres 短暂不可用）
// 都会把整个服务打挂；Docker 反复拉起后触发 Coolify 的重启次数上限，最终只能手动启动。
process.on("unhandledRejection", (reason) => {
  logger.error("未处理的 Promise 拒绝:", reason);
});

process.on("uncaughtException", (err) => {
  logger.error("未捕获的异常:", err);
});

// 建表。数据库一直连不上时只记录日志，不退出进程：
// 退出会被容器反复拉起，日志里反而看不清原因；数据库恢复后重启一次服务即可
try {
  await migrate();
} catch (error) {
  logger.error("数据库初始化失败，请检查 DATABASE_URL:", error);
}

// 自动加载所有 Workers
const { workers, queues } = await loadWorkers();
setupWorkerShutdown(workers, queues);
const basePath = "/jobs";
serverAdapter.setBasePath(basePath);
// Bull Board 能看到所有会话内容，必须放在 Basic 认证后面
hono.use("/jobs/*", authMiddleware);
hono.use("/jobs", authMiddleware);
hono.get("/jobs/", (c) => {
  return c.redirect("/jobs");
});
hono.route(basePath, serverAdapter.registerPlugin());
// 管理页面的静态文件兜底，必须最后挂
mountWeb();

// 先启动 HTTP 服务，让 Coolify 的健康检查尽快通过；
// Telegram Webhook 的注册改为后台重试，Telegram 暂时连不上也不影响服务启动
try {
  const port = Bun.env.PORT ? parseInt(Bun.env.PORT) : 3000;
  Bun.serve({
    port,
    fetch: hono.fetch,
  });
  logger.info(`HTTP 服务已启动，端口: ${port}`);
  logger.info(`环境: ${Bun.env.NODE_ENV || "development"}`);
} catch (error) {
  // 端口被占用等无法自行恢复的错误，退出交给容器重启
  logger.error("HTTP 服务启动失败:", error);
  process.exit(1);
}

void setupWebhook();
