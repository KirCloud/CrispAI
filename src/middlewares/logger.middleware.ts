import type { Context, Next } from "hono";
import logger from "@/services/logger.service";

export const loggerMiddleware = async (c: Context, next: Next) => {
  const start = Date.now();
  const method = c.req.method;
  const url = c.req.url;
  const ip =
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "Unknown";

  try {
    await next();

    const ms = Date.now() - start;
    const status = c.res.status;

    // 记录响应信息
    const logData = {
      method,
      url,
      status,
      responseTime: `${ms}ms`,
      ip,
    };

    if (status >= 500) {
      logger.error("服务器错误", logData);
    } else if (status >= 400) {
      logger.warn("客户端错误", logData);
    }
  } catch (error) {
    const ms = Date.now() - start;
    logger.error("请求处理异常", {
      method,
      url,
      error: error instanceof Error ? error.message : String(error),
      responseTime: `${ms}ms`,
      ip,
    });
    throw error;
  }
};
