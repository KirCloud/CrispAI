import { Hono } from "hono";
import {
  chatwootBindingSchema,
  type createChatwootBindings,
} from "@/services/chatwoot-binding.service";
import { isProjectId } from "@/utils/conversation-id";

export function createChatwootRoutes(
  bindings: Pick<ReturnType<typeof createChatwootBindings>, "read" | "save">,
  exists: (project: string) => Promise<unknown>,
  publicUrl: () => string,
) {
  const routes = new Hono();
  const view = async (project: string, binding: object) => ({
    ...binding,
    webhookUrl: `${publicUrl().replace(/\/+$/, "")}/chatwoot/${project}`,
  });
  routes.use("*", async (c, next) => {
    const id = c.req.query("project_id");
    if (!isProjectId(id) || !(await exists(id)))
      return c.json({ message: "项目不存在" }, 404);
    await next();
  });
  routes.get("/", async (c) => {
    const project = c.req.query("project_id")!;
    return c.json({ data: await view(project, await bindings.read(project)) });
  });
  routes.put("/", async (c) => {
    const project = c.req.query("project_id")!;
    const parsed = chatwootBindingSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        { message: "请填写 HTTPS 的 Chatwoot 地址，收件箱 ID 只能是正整数" },
        400,
      );
    try {
      return c.json({
        data: await view(project, await bindings.save(project, parsed.data)),
        message: "Chatwoot 接入已保存",
      });
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400);
    }
  });
  return routes;
}
