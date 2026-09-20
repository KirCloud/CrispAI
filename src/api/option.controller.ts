import type { Context } from "hono";
import z from "zod";
import * as db from "@/services/db.service";
import { validate } from "@/api/validator";

export const listSchema = validate(
  "query",
  z.object({ project_id: z.string().uuid() }),
);
export const listController = async (c: Context) => {
  return c.json({ data: await db.getOption(c.req.query("project_id")!) });
};

export const saveSchema = validate(
  "json",
  z.object({
    project_id: z.string().uuid(),
    params: z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1),
      text: z.string().min(1),
      options: z
        .array(
          z.object({
            id: z.string().optional(),
            label: z.string().min(1),
            trigger: z.object({
              type: z.enum(["none", "text", "option", "closeAI"]),
              text: z.string().optional(),
              optionId: z.string().uuid().optional(),
            }),
          }),
        )
        .min(1),
    }),
  }),
);
export const saveController = async (c: Context) => {
  const { project_id, params } = await c.req.json();

  for (const option of params.options) {
    if (option.trigger.type === "text" && !option.trigger.text)
      return c.json({ message: "缺少选项触发文本" }, 400);
    if (option.trigger.type === "option" && !option.trigger.optionId)
      return c.json({ message: "缺少选项触发选项ID" }, 400);
    if (!option.id) {
      option.id = crypto.randomUUID();
    }
  }

  const project = await db.getProjectById(project_id);
  if (!project) return c.json({ message: "查询项目失败" }, 400);

  const data = {
    name: params.name,
    text: params.text,
    options: params.options,
  };
  if (params.id) {
    await db.updateOption(params.id, project_id, data);
  } else {
    await db.insertOption({ project_id, ...data });
  }
  return c.json({ message: "成功" });
};

export const deleteSchema = validate(
  "json",
  z.object({ option_id: z.string().uuid() }),
);
export const deleteController = async (c: Context) => {
  const { option_id } = await c.req.json();
  await db.deleteOption(option_id);
  return c.json({ message: "删除成功" });
};
