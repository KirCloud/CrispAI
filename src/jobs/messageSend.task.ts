import { getAIProvider } from "@/services/openai.service";
import { AI_REPLY_FORMAT_GUIDE, normalizeCrispReply } from "@/utils/message-format";
import type { AIConfig } from "@/services/ai-config.service";
import { getKnowledgeContext } from "@/services/knowledge-runtime.service";
import { withKnowledgeContext } from "@/services/knowledge-context.service";
import * as db from "@/services/db.service";
import * as telegram from "@/services/telegram.service";
import * as crisp from "@/services/crisp.service";
import { Queue } from "bullmq";
import path from "path";
import { createResponse } from "@/utils/general";
import {
  createTelegramSession,
  emojiConverter,
  generateTelegramSession,
} from "@/utils/general";
import { GrammyError, InputFile } from "grammy";
import type { ChatCompletionMessageParam } from "openai/resources";
import type { Message } from "grammy/types";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import { connection } from "@/services/redis.service";

const currentFileName = path.basename(
  import.meta.url,
  path.extname(import.meta.url),
);
export default {
  name: currentFileName,
  queue: new Queue(currentFileName, {
    connection,
    defaultJobOptions: {
      // 任务成功完成后，只保留最新的 100 条（或 1000 条，看你需要）
      removeOnComplete: {
        count: 100,
        age: 24 * 3600, // (可选) 同时限制时间，例如只保留24小时内的
      },
      // 任务失败后，保留最新的 1000 条以便排查错误
      removeOnFail: {
        count: 100,
      },
    },
  }),
  concurrency: 100,
  processor: async (job: any) => {
    const { session_id, website_id } = job.data;
    const cleanSessionId = session_id.replace("session_", "");

    const project = await db.getProject(website_id);
    if (!project) {
      return createResponse(false, "未找到项目");
    }

    let session = await db.getSession(cleanSessionId);

    if (session) {
      const error = await updateTelegramSession(session, project);
      if (error) {
        session = null;
      }
    }
    if (!session) {
      session = await createTelegramSession(
        cleanSessionId,
        website_id,
        project,
      );
    }

    await crisp.composeMessage(website_id, session_id, true);

    const isText = job.data.type === "text";

    let telegramMessage;
    if (project.telegramId) {
      if (isText) {
        try {
          const flow: string[] = [
            "🧾<b>消息内容</b>：",
            emojiConverter(job.data.content),
          ];
          telegramMessage = await telegram.default.api.sendMessage(
            session.group_id!,
            flow.join("\n"),
            {
              message_thread_id: session.topic_id,
              parse_mode: "HTML",
            },
          );
        } catch {}
      } else if (job.data.content.type.includes("image")) {
        try {
          telegramMessage = await telegram.default.api.sendPhoto(
            session.group_id!,
            job.data.content.url,
            {
              message_thread_id: session.topic_id,
              parse_mode: "HTML",
            },
          );
        } catch {
          telegramMessage = undefined;
        }
      } else if (job.data.content.type.includes("audio")) {
        const converter = async (url: string) => {
          const output = url.split("/").pop()!.split(".")[0] + ".mp3";
          const response = await axios.get(url, { responseType: "stream" });
          return new Promise<string>((resolve, reject) => {
            ffmpeg(response.data)
              .toFormat("mp3")
              .on("error", (err) => {
                reject(err);
              })
              .on("end", () => {
                resolve(output);
              })
              .save(output);
          });
        };
        const file = await converter(job.data.content.url);
        try {
          await telegram.default.api.sendVoice(
            session.group_id!,
            new InputFile(file),
            {
              message_thread_id: session.topic_id,
              parse_mode: "HTML",
              caption: "🧾<b>语音消息</b>",
            },
          );
        } catch {
        } finally {
          await Bun.file(file).delete();
        }
      }
    }

    const options = await db.getOption(project.id);

    if (isText) {
      const content = await handleTextMessage(
        session,
        job.data,
        project,
        options,
      );
      if (project.telegramId) {
        await notifyTelegram(
          session,
          job.data.content,
          content,
          telegramMessage,
        );
      }
    } else if (job.data.content.type.includes("image")) {
      await handleImageMessage(session, job.data, project, telegramMessage);
    }
    await crisp.composeMessage(website_id, session_id, false);

    await db.updateSession(cleanSessionId, { thread: session.thread });
    return createResponse(true, "任务执行完成");
  },
};

async function updateTelegramSession(session: Session, project: any) {
  if (!project.telegramId) return null;

  const flow = await generateTelegramSession(
    session.session_id,
    session.website_id,
  );
  try {
    await telegram.default.api.editMessageText(
      project.telegramId,
      session.message_id!,
      flow.length > 0 ? flow.join("\n") : "无额外信息",
      {
        parse_mode: "HTML",
        reply_markup: telegram.changeAI(
          project.telegramId,
          session.topic_id!,
          project.enableAI,
        ),
      },
    );
  } catch (error) {
    if (error instanceof GrammyError) {
      if (error.description === "Bad Request: message to edit not found") {
        return error;
      }
    }
  }
}

const isJSON = (data: string) => {
  try {
    const json = JSON.parse(data);
    return (
      Array.isArray(json) && json.length > 0 && typeof json[0] === "string"
    );
  } catch {
    return false;
  }
};

const getKeyword = (input: string, keywords: any[]) => {
  if (!keywords?.length) return;
  return keywords.find((k) => k && new RegExp(k.keyword).test(input));
};

const formatDate = () => {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${
    date.getUTCMonth() + 1
  }-${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes()}:${date.getUTCSeconds()}`;
};

async function handleTextMessage(
  session: Session,
  body: any,
  project: any,
  options: any[],
) {
  let content: string | undefined;

  if (project.enableKeyword) {
    const replyOption = getKeyword(body.content, project.keyword);
    content = await handleKeywordReply(
      replyOption,
      session,
      body,
      project,
      options,
    );
  }

  if (!content && project.enableAI && session.enable_reply) {
    content = await handleAIReply(session, body, project);
  }

  return content;
}

async function handleKeywordReply(
  replyOption: any,
  session: Session,
  body: any,
  project: any,
  options: any[],
) {
  const { website_id, session_id } = body;
  if (!replyOption) return;

  if (replyOption.type === "text") {
    await crisp.sendMessage(
      website_id,
      session_id,
      replyOption.text,
      project.botName,
      project.botIcon,
    );
    return replyOption.text;
  }

  if (replyOption.type === "option") {
    const option = options.find((o) => o.id === replyOption.optionId);
    if (option) {
      await crisp.sendOption(
        website_id,
        session_id,
        option,
        project.botName,
        project.botIcon,
      );
      return option.text;
    }
  }

  if (replyOption.type === "closeAI" && session.enable_reply) {
    const msg = "已关闭智能回复，请等待人工客服接入...";
    await db.setSessionReply(session.session_id, false);
    await crisp.sendMessage(
      website_id,
      session_id,
      msg,
      project.botName,
      project.botIcon,
    );
    return msg;
  }
}
async function handleAIReply(session: Session, body: any, project: any) {
  const provider = getAIProvider();
  const messages = await buildMessages(session, body, project, provider);
  const { client, model } = provider;
  const completion = await client.chat.completions.create({
    messages,
    model,
  });

  const reply = completion.choices[0]?.message;
  if (!reply?.content) return;

  const content = normalizeCrispReply(reply.content);
  session.thread.push({ ...reply, content });

  await crisp.sendMessage(
    body.website_id,
    body.session_id,
    content,
    project.botName,
    project.botIcon,
  );

  return content;
}

async function buildMessages(
  session: Session,
  body: any,
  project: any,
  config: AIConfig,
): Promise<ChatCompletionMessageParam[]> {
  const messages: ChatCompletionMessageParam[] = [];

  if (isJSON(project.payload)) {
    JSON.parse(project.payload).forEach((p: string) =>
      messages.push({ role: "system", content: p }),
    );
  } else {
    messages.push({ role: "system", content: project.payload || "" });
  }

  messages.push({ role: "system", content: AI_REPLY_FORMAT_GUIDE });
  messages.push({
    role: "system",
    content: JSON.stringify(
      await crisp.getMetas(body.website_id, body.session_id),
    ),
  });

  session?.thread.forEach((msg: any) => messages.push(msg));

  if (body.content && typeof body.content === "string") {
    const msg: ChatCompletionMessageParam = {
      role: "user",
      content: body.content,
    };
    session.thread.push(msg);
    messages.push(msg);
  } else if (body.content?.type?.includes("image")) {
    messages.push({
      role: "user",
      content: [{ type: "image_url", image_url: { url: body.content.url } }],
    });
  }

  return withKnowledgeContext(
    messages,
    await getKnowledgeContext(
      project.id,
      typeof body.content === "string" ? body.content : "",
      config,
    ),
  );
}

async function handleImageMessage(
  session: Session,
  body: any,
  project: any,
  telegramMessage?: Message.TextMessage | Message.PhotoMessage,
) {
  if (!project.enableAI || !project.enableAIPic) return;

  const provider = getAIProvider();
  const messages = await buildMessages(session, body, project, provider);
  const { client, model } = provider;
  const completion = await client.chat.completions.create({
    messages,
    model,
  });

  if (!completion?.choices) return;

  const reply = completion.choices[0]?.message;
  const replyText = normalizeCrispReply(reply?.content ?? "无法识别该图片");
  if (reply) session.thread.push({ ...reply, content: replyText });
  await crisp.sendMessage(
    body.website_id,
    body.session_id,
    replyText,
    project.botName,
    project.botIcon,
  );

  if (project.telegramId) {
    if (telegramMessage) {
      try {
        await telegram.default.api.editMessageCaption(
          session.group_id!,
          telegramMessage.message_id,
          {
            caption: `💡<b>智能回复</b>：\n${replyText}`,
            parse_mode: "HTML",
          },
        );
      } catch {}
    } else {
      try {
        await telegram.default.api.sendPhoto(
          session.group_id!,
          body.content.url,
          {
            caption: `💡<b>智能回复</b>：\n${replyText}`,
            message_thread_id: session.topic_id,
            parse_mode: "HTML",
          },
        );
      } catch {}
    }
  }
}

async function notifyTelegram(
  session: Session,
  userContent: string,
  replyContent: string | undefined,
  telegramMessage?: Message.TextMessage | Message.PhotoMessage,
) {
  const flow: string[] = ["🧾<b>消息内容</b>：", emojiConverter(userContent)];
  if (replyContent) {
    flow.push("", "💡<b>智能回复</b>：", replyContent);
  }

  try {
    if (telegramMessage) {
      await telegram.default.api.editMessageText(
        session.group_id!,
        telegramMessage.message_id,
        flow.join("\n"),
        {
          parse_mode: "HTML",
        },
      );
    } else {
      await telegram.default.api.sendMessage(
        session.group_id!,
        flow.join("\n"),
        {
          message_thread_id: session.topic_id,
          parse_mode: "HTML",
        },
      );
    }
  } catch {}
}
