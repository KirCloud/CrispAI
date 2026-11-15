import { Hono } from "hono";
import { z } from "zod";
import { abusePolicySchema } from "@/services/abuse-policy.service";
export function createAbusePolicyRoutes(deps: {
  exists: (project: string) => Promise<unknown>;
  read: (project: string) => Promise<{ enabled: boolean }>;
  save: (
    project: string,
    value: { enabled: boolean },
  ) => Promise<{ enabled: boolean }>;
}) {
  const routes = new Hono();
  routes.use("*", async (c, next) => {
    const id = c.req.query("project_id");
    if (!z.string().uuid().safeParse(id).success || !(await deps.exists(id!)))
      return c.json({ message: "项目不存在" }, 404);
    await next();
  });
  routes.get("/", async (c) =>
    c.json({ data: await deps.read(c.req.query("project_id")!) }),
  );
  routes.put("/", async (c) => {
    const parsed = abusePolicySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ message: "请检查辱骂警告开关" }, 400);
    return c.json({
      data: await deps.save(c.req.query("project_id")!, parsed.data),
      message: "辱骂警告设置已保存",
    });
  });
  return routes;
}
