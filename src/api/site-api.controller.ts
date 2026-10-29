import { Hono } from "hono";
import { z } from "zod";
import {
  siteAPIConfigSchema,
  getSiteInformation,
  type createSiteAPISettings,
} from "@/services/site-information.service";
export function createSiteAPIRoutes(
  settings: ReturnType<typeof createSiteAPISettings>,
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
    c.json({ data: await settings.read(c.req.query("project_id")!) }),
  );
  routes.put("/", async (c) => {
    const parsed = siteAPIConfigSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          message:
            "请填写 HTTPS API 地址（以 /api/v1 结尾）、官网地址和有效令牌",
        },
        400,
      );
    try {
      return c.json({
        data: await settings.save(c.req.query("project_id")!, parsed.data),
        message: "网站查询配置已保存并即时生效",
      });
    } catch {
      return c.json(
        { message: "保存失败；开启查询或更换接口地址时需填写对应的授权令牌" },
        400,
      );
    }
  });
  routes.post("/test", async (c) => {
    const config = await settings.load(c.req.query("project_id")!);
    if (!config?.enabled)
      return c.json({ message: "请先保存并开启网站查询" }, 400);
    const results = await Promise.all(
      (["plans", "notices", "payments", "site_config"] as const).map((topic) =>
        getSiteInformation(config, topic),
      ),
    );
    return c.json({
      data: results.map((r) => ({
        topic: r.topic,
        ok: r.ok,
        fetchedAt: r.fetchedAt,
      })),
      message: results.every((r) => r.ok)
        ? "四类只读接口全部通过；实际 AI 工具调用还取决于对话模型支持"
        : "部分接口读取失败，请检查授权令牌或网络",
    });
  });
  return routes;
}
