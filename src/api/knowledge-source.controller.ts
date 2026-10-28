import { Hono } from "hono";
import { z } from "zod";
import { sourceSchema } from "@/services/knowledge-source.service";
import type { createKnowledgeSync } from "@/services/knowledge-sync.service";
export function createKnowledgeSourceRoutes(
  sync: ReturnType<typeof createKnowledgeSync>,
  exists: (project: string) => Promise<unknown>,
) {
  const routes = new Hono();
  routes.use("*", async (c, next) => {
    const id = c.req.query("project_id");
    if (!z.string().uuid().safeParse(id).success || !(await exists(id!)))
      return c.json({ message: "项目不存在" }, 404);
    await next();
  });
  routes.get("/", async (c) =>
    c.json({ data: await sync.read(c.req.query("project_id")!) }),
  );
  routes.put("/", async (c) => {
    const result = sourceSchema.safeParse(await c.req.json().catch(() => null));
    if (!result.success)
      return c.json(
        { message: "请检查来源地址、令牌和同步频率（15～10080 分钟）" },
        400,
      );
    try {
      return c.json({
        data: await sync.save(c.req.query("project_id")!, result.data),
        message: "来源配置已保存",
      });
    } catch {
      return c.json({ message: "来源保存失败，可能正在同步，请稍后重试" }, 409);
    }
  });
  routes.post("/sync", async (c) => {
    if (!(await sync.read(c.req.query("project_id")!)))
      return c.json({ message: "请先保存文档来源" }, 400);
    void sync.run(c.req.query("project_id")!).catch(() => {});
    return c.json({ message: "后台同步已开始，请稍后刷新状态" }, 202);
  });
  return routes;
}
