import * as db from "@/services/db.service";
import * as storage from "@/services/storage.service";
import * as telegram from "@/services/telegram.service";
import * as crisp from "@/services/crisp.service";
import { Queue } from "bullmq";
import path from "path";
import { createResponse } from "@/utils/general";
import axios from "axios";
import { connection } from "@/services/redis.service";

const currentFileName = path.basename(
  import.meta.url,
  path.extname(import.meta.url)
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
    const group_id = job.data.chat.id;
    const topic_id = job.data.message_thread_id!;

    const data = await db.getSessionByTopic(group_id, topic_id);
    if (!data) {
      return createResponse(false, "会话不存在");
    }

    const project = await db.getProject(data.website_id);
    if (!project) {
      return createResponse(false, "未找到项目");
    }
    const msg = job.data.caption || job.data.text;
    // 发送文本内容到 Crisp
    if (msg) {
      await crisp.composeMessage(
        data.website_id,
        "session_" + data.session_id,
        true
      );
      await crisp.sendMessage(
        project.websiteId,
        "session_" + data.session_id,
        msg,
        project.botName,
        project.botIcon
      );
      await crisp.composeMessage(
        data.website_id,
        "session_" + data.session_id,
        false
      );

      try {
        await telegram.default.api.setMessageReaction(
          group_id,
          job.data.message_id,
          [
            {
              type: "emoji",
              emoji: "👌",
            },
          ]
        );
      } catch {}
    }

    // 如果开启智能回复，则关闭
    if (data.enable_reply) {
      await db.setSessionReplyByTopic(group_id, topic_id, false);
      try {
        await telegram.default.api.editMessageReplyMarkup(
          group_id,
          data.message_id,
          {
            reply_markup: telegram.changeAI(group_id, topic_id, false),
          }
        );
      } catch {}
    }
    // 如果有图片，则发送图片到 Crisp
    if (job.data.photo) {
      await crisp.composeMessage(
        data.website_id,
        "session_" + data.session_id,
        true
      );
      const photo = job.data.photo.pop();
      if (!photo) {
        return createResponse(false, "图片不存在");
      }

      const markdownImage = await uploadFile(photo.file_id);

      await crisp.sendMessage(
        project.websiteId,
        "session_" + data.session_id,
        markdownImage,
        project.botName,
        project.botIcon
      );
      await crisp.composeMessage(
        data.website_id,
        "session_" + data.session_id,
        false
      );
      if (!msg) {
        try {
          await telegram.default.api.setMessageReaction(
            group_id,
            job.data.message_id,
            [
              {
                type: "emoji",
                emoji: "👌",
              },
            ]
          );
        } catch {}
      }
    }

    if (job.data.sticker) {
      if (job.data.sticker.is_animated || job.data.sticker.is_video) {
        return createResponse(false, "不支持发送动图或视频贴纸");
      }

      await crisp.composeMessage(
        data.website_id,
        "session_" + data.session_id,
        true
      );
      const sticker = job.data.sticker;
      if (!sticker) {
        return createResponse(false, "贴纸不存在");
      }
      if (sticker.is_animated || sticker.is_video) {
        return createResponse(false, "不支持发送动图或视频贴纸");
      }

      const markdownImage = await uploadFile(sticker.file_id);

      await crisp.sendMessage(
        project.websiteId,
        "session_" + data.session_id,
        markdownImage,
        project.botName,
        project.botIcon
      );
      await crisp.composeMessage(
        data.website_id,
        "session_" + data.session_id,
        false
      );
      if (!msg) {
        try {
          await telegram.default.api.setMessageReaction(
            group_id,
            job.data.message_id,
            [
              {
                type: "emoji",
                emoji: "👌",
              },
            ]
          );
        } catch {}
      }
    }
    return createResponse(true, "任务执行成功");
  },
};

const uploadFile = async (fileId: string) => {
  const file = await telegram.default.api.getFile(fileId);
  const response = await axios.get<ArrayBuffer>(
    `https://api.telegram.org/file/bot${Bun.env.TELEGRAM_TOKEN}/${file.file_path}`,
    { responseType: "arraybuffer" }
  );
  // 带上原始扩展名（照片是 .jpg，贴纸是 .webp），对外提供时才能给出正确的 Content-Type
  const ext = path.extname(file.file_path ?? "") || ".jpg";
  const url = await storage.saveFile(
    fileId + ext,
    new Uint8Array(response.data)
  );
  return `![image](${url})`;
};
