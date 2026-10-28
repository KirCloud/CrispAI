import path from "path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { webhookCallback as telegramWebhook } from "grammy";

import { loggerMiddleware } from "@/middlewares/logger.middleware";
import { crispMiddleware } from "@/middlewares/crisp.middleware";
import { authMiddleware } from "@/middlewares/auth.middleware";
import bot, { WEBHOOK_SECRET } from "@/services/telegram.service";
import { crispWebhook } from "@/services/crisp.service";
import * as storage from "@/services/storage.service";
import logger from "@/services/logger.service";
import api from "@/api";
import { createConsoleRoutes } from "@/services/console.service";

// 管理页面的静态文件。前端源码不在这个仓库里，打包后的产物同步到 public/ 并随仓库提交
const WEB_DIR = Bun.env.WEB_DIR
  ? path.resolve(Bun.env.WEB_DIR)
  : path.join(import.meta.dir, "../../public");

const hono = new Hono();
hono.use("*", loggerMiddleware);
hono.use("/api/auth/*", bodyLimit({ maxSize: 16 * 1024 }));
hono.use("/api/v1/settings/*", bodyLimit({ maxSize: 32 * 1024 }));

hono.onError((error, c) => {
  // basicAuth 等中间件用 HTTPException 表达 401，要原样返回（带 WWW-Authenticate 头浏览器才会弹登录框）
  if (error instanceof HTTPException) return error.getResponse();

  logger.error("请求处理异常", {
    url: c.req.url,
    message: error.message,
    stack: error.stack,
  });
  return c.json({ message: "服务器开小差了，请稍后再试" }, 500);
});

// ---- 公开路由：各自带校验，不走 Basic 认证 ----
hono.get("/health", (c) => c.text("ok"));
hono.post(
  "/telegram",
  telegramWebhook(bot, "hono", { secretToken: WEBHOOK_SECRET }),
);
hono.post("/crisp", crispMiddleware, crispWebhook);
// Telegram 客服发的图片，Crisp 要从公网拉取
hono.get(`${storage.UPLOAD_ROUTE}/:name`, async (c) => {
  const file = await storage.getFile(c.req.param("name"));
  if (!file) return c.notFound();
  return new Response(file, {
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
});
// 访客网站引用的欢迎语脚本
hono.get("/intro.js", serveStatic({ root: WEB_DIR }));

// /api/v1 里除 intro 外都需要认证，见 api/index.ts
hono.route("/", createConsoleRoutes());
hono.route("/api/v1", api);

/**
 * 挂载管理页面。放在所有路由之后调用（index.ts 里 /jobs 挂完再调），
 * 这样静态文件兜底不会抢在其他路由前面
 */
export const mountWeb = () => {
  hono.use("*", authMiddleware);
  hono.use("*", serveStatic({ root: WEB_DIR }));
  hono.notFound((c) => c.text("Not Found", 404));
};

export { authMiddleware };
export default hono;
