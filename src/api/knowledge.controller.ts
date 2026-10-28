import { Hono } from "hono";
import { z } from "zod";

type Entry = { id: string; project: string; name: string; raw: string };
type Dependencies = {
  list: (
    project: string,
  ) => Promise<{ id: string; name: string; indexed: boolean }[]>;
  get: (id: string) => Promise<Entry | null>;
  embed: (raw: string) => Promise<number[]>;
  ready: () => boolean;
  update: (entry: Entry, vector: number[]) => Promise<boolean>;
};
export function createKnowledgeRoutes(deps: Dependencies) {
  const app = new Hono();
  const projectId = z.string().uuid();
  app.get("/", async (c) => {
    const parsed = projectId.safeParse(c.req.query("project_id"));
    if (!parsed.success) return c.json({ message: "项目 ID 不正确" }, 400);
    return c.json({ data: await deps.list(parsed.data) });
  });
  app.post("/index", async (c) => {
    const parsed = z
      .object({ project_id: projectId, payload_id: z.string().uuid() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ message: "请检查项目和知识库条目" }, 400);
    if (!deps.ready())
      return c.json({ message: "请先选择向量模式并保存向量模型配置" }, 400);
    const entry = await deps.get(parsed.data.payload_id);
    if (!entry || entry.project !== parsed.data.project_id)
      return c.json({ message: "知识库条目不存在" }, 404);
    let vector: number[];
    try {
      vector = await deps.embed(entry.raw);
    } catch {
      return c.json(
        { message: "生成向量失败，请测试向量接口连接并确认输出为 1536 维" },
        502,
      );
    }
    if (vector.length !== 1536 || !vector.every(Number.isFinite))
      return c.json({ message: "向量模型必须输出 1536 维" }, 422);
    if (!(await deps.update(entry, vector)))
      return c.json({ message: "条目已修改，请刷新后重试" }, 409);
    return c.json({ message: "向量已生成" });
  });
  return app;
}
