import type { Context, Next } from "hono";
import { basicAuth } from "hono/basic-auth";
import logger from "@/services/logger.service";

/**
 * 管理后台的 Basic 认证（单用户）
 *
 * 账号密码来自环境变量 `ADMIN_USER`（默认 admin）/ `ADMIN_PASSWORD`。
 * 没配置 `ADMIN_PASSWORD` 时后台整体拒绝访问，而不是放行或让进程退出：
 * Webhook 照常工作，只是管理页面打不开。
 */
const username = Bun.env.ADMIN_USER || "admin";
const password = Bun.env.ADMIN_PASSWORD;

if (!password) {
  logger.error("未配置 ADMIN_PASSWORD，管理后台和 /api/v1 已禁用");
}

const auth = password
  ? basicAuth({ username, password, realm: "CrispAI" })
  : null;

export const authMiddleware = async (c: Context, next: Next) => {
  if (!auth) {
    return c.json({ message: "未配置 ADMIN_PASSWORD，管理后台已禁用" }, 503);
  }
  return auth(c, next);
};
