import { zValidator } from "@hono/zod-validator";
import type { ZodSchema } from "zod";

/**
 * 统一处理 zod 校验失败响应，避免在每个 schema 里重复写同样的错误分支。
 */
export const validate = <T extends ZodSchema>(
  target: "json" | "query",
  schema: T,
  defaultMessage = "请求参数格式不正确",
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ message: defaultMessage }, 400);
    }
  });
