import type { Context } from "hono";
import z from "zod";
import * as db from "@/services/db.service";
import { validate } from "@/api/validator";

const triggerType = z.enum(["none", "text", "option", "closeAI"]);

// Postgres 唯一索引冲突（project_website_id_key）
const isUniqueViolation = (error: unknown) =>
  (error as any)?.errno === "23505" || (error as any)?.code === "23505";

export const listController = async (c: Context) => {
  return c.json({ data: await db.listProjects() });
};

export const getSchema = validate("query", z.object({ id: z.string().uuid() }));
export const getController = async (c: Context) => {
  const project = await db.getProjectById(c.req.query("id")!);
  if (!project) return c.json({ message: "项目不存在" }, 404);
  return c.json({ data: project });
};

export const createSchema = validate(
  "json",
  z.object({ name: z.string().min(1, "项目名称不能为空") }),
);
export const createController = async (c: Context) => {
  const { name } = await c.req.json();
  const project = await db.createProject(name);
  return c.json({ data: [{ id: project.id }] });
};

export const deleteSchema = validate(
  "json",
  z.object({ project_id: z.string().uuid() }),
);
export const deleteController = async (c: Context) => {
  const { project_id } = await c.req.json();
  await db.deleteProject(project_id);
  return c.json({ message: "删除成功" });
};

export const saveGeneralSchema = validate(
  "json",
  z.object({
    id: z.string().uuid(),
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    websiteId: z.string().optional(),
    botName: z.string().optional(),
    botIcon: z.string().optional(),
    telegramId: z.number().int().optional(),
    options: z
      .object({
        type: z.enum(["none", "text", "option"]).optional(),
        text: z.string().optional(),
        optionId: z.string().optional(),
      })
      .optional(),
    timer: z.number().int().positive().optional(),
  }),
);
export const saveGeneralController = async (c: Context) => {
  const data = await c.req.json();

  const project = await db.getProjectById(data.id);
  if (!project) return c.json({ message: "查询项目失败" }, 400);

  const patch: Record<string, unknown> = { enabled: data.enabled };
  if (data.name) patch["name"] = data.name;
  if (data.websiteId) patch["websiteId"] = data.websiteId;
  if (data.botName) patch["botName"] = data.botName;
  if (data.botIcon) patch["botIcon"] = data.botIcon;
  if (data.telegramId) patch["telegramId"] = data.telegramId;
  if (data.options) patch["options"] = data.options;
  if (data.timer) patch["timer"] = data.timer;

  try {
    await db.updateProject(data.id, patch);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ message: "该 Website ID 已被其他项目使用" }, 400);
    }
    throw error;
  }
  return c.json({ message: "成功" });
};

export const saveAISchema = validate(
  "json",
  z.object({
    project_id: z.string().uuid(),
    enable: z.boolean(),
    enablePic: z.boolean(),
    data: z.string().max(5000, "内容过长，无法保存").optional(),
  }),
);
export const saveAIController = async (c: Context) => {
  const { project_id, enable, enablePic, data: payload } = await c.req.json();

  const project = await db.getProjectById(project_id);
  if (!project) return c.json({ message: "查询项目失败" }, 400);

  await db.updateProject(project_id, {
    enableAI: enable,
    enableAIPic: enablePic,
    payload,
  });
  return c.json({ message: "成功" });
};

export const saveKeywordSchema = validate(
  "json",
  z.object({
    project_id: z.string().uuid(),
    enable: z.boolean(),
    data: z
      .array(
        z.object({
          keyword: z.string(),
          type: triggerType,
          text: z.string().optional(),
          optionId: z.string().uuid().optional(),
        }),
      )
      .optional(),
  }),
);
export const saveKeywordController = async (c: Context) => {
  const { project_id, enable, data: payload = [] } = await c.req.json();

  const project = await db.getProjectById(project_id);
  if (!project) return c.json({ message: "查询项目失败" }, 400);

  for (const keyword of payload) {
    // 关键词在 worker 里是当正则用的（new RegExp），写错的正则会让每条消息的任务都失败
    try {
      new RegExp(keyword.keyword);
    } catch {
      return c.json({ message: `关键词不是合法的正则：${keyword.keyword}` }, 400);
    }
    if (keyword.type === "text" && !keyword.text)
      return c.json({ message: "未填写回复文本" }, 400);
    if (keyword.type === "option" && !keyword.optionId)
      return c.json({ message: "未选择回复选项" }, 400);
  }

  await db.updateProject(project_id, {
    enableKeyword: enable,
    keyword: payload,
  });
  return c.json({ message: "成功" });
};
