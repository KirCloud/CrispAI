import * as db from "@/services/db.service";
import * as telegram from "@/services/telegram.service";
import * as crisp from "@/services/crisp.service";

export const createTelegramSession = async (
  session_id: string,
  website_id: string,
  project: any
): Promise<Session> => {
  const baseSession: Session = {
    website_id,
    session_id,
    enable_reply: project.enableAI,
    enable_time: new Date(),
    thread: [],
  };

  console.log("Creating Telegram session for", session_id, website_id);
  const initial = await db.upsertSession(baseSession);
  if (initial.topic_id && initial.message_id) {
    console.log(
      "Session already has topic and message, returning existing session"
    );
    return initial;
  }
  if (!project.telegramId) {
    console.error("Project does not have telegramId");
    return initial;
  }

  // 创建 Telegram 话题和消息
  const flow = await generateTelegramSession(session_id, website_id);
  try {
    const topic = await telegram.default.api.createForumTopic(
      project.telegramId,
      generateTelegramName(session_id, flow)
    );

    const message = await telegram.default.api.sendMessage(
      project.telegramId,
      flow.length > 0 ? flow.join("\n") : "无额外信息",
      {
        message_thread_id: topic.message_thread_id,
        parse_mode: "HTML",
        reply_markup: telegram.changeAI(
          project.telegramId,
          topic.message_thread_id,
          project.enableAI
        ),
      }
    );

    // 更新数据库里的 session，加上 group/topic/message 信息
    const update = {
      group_id: project.telegramId,
      topic_id: topic.message_thread_id,
      message_id: message.message_id,
    };

    return await db.updateSession(session_id, update);
  } catch (err) {
    console.error("创建 Telegram topic 或发送消息失败", err);
    // 如果失败，返回最少的 initial session，不至于中断
    return initial;
  }
};
const generateTelegramName = (session_id: string, flow: string[]) => {
  let nickname = session_id;
  for (let i = 0; i < flow.length; i++) {
    const line = flow[i];
    if (!line) continue;
    if (line.startsWith("👤")) {
      const nicknameMatch = line.match(/<code>(.*?)<\/code>/);
      if (nicknameMatch) nickname = nicknameMatch[1]!;
      break;
    } else if (line.startsWith("📧")) {
      const nicknameMatch = line.match(/<code>(.*?)<\/code>/);
      if (nicknameMatch) nickname = nicknameMatch[1]!;
      break;
    }
  }
  return nickname;
};

interface CacheItem {
  data: string[];
  timestamp: number;
  timer: NodeJS.Timeout;
}

const bufferMap: Record<string, CacheItem> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5分钟
const MAX_CACHE_SIZE = 1000; // 最大缓存条目数

export const generateTelegramSession = async (
  session_id: string,
  website_id: string
) => {
  try {
    const cached = bufferMap[session_id];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    if (cached) {
      clearTimeout(cached.timer);
      delete bufferMap[session_id];
    }

    const flow = [""];
    const meta = await crisp.getMetas(website_id, "session_" + session_id);
    if (meta && meta.length > 0) flow.push(...meta);
    const pages = await crisp.listPages(website_id, "session_" + session_id);
    if (pages && pages.length > 0) flow.push(...pages);

    if (flow.length > 1 || (flow.length === 1 && flow[0] !== "")) {
      // 检查缓存大小，清理最老的条目
      if (Object.keys(bufferMap).length >= MAX_CACHE_SIZE) {
        const oldestKey = Object.keys(bufferMap).sort(
          (a, b) => bufferMap[a]!.timestamp - bufferMap[b]!.timestamp
        )[0];
        if (oldestKey) {
          clearTimeout(bufferMap[oldestKey]!.timer);
          delete bufferMap[oldestKey];
        }
      }

      // 设置缓存
      const timer = setTimeout(() => {
        delete bufferMap[session_id];
      }, CACHE_TTL);

      bufferMap[session_id] = {
        data: flow,
        timestamp: Date.now(),
        timer,
      };
    }

    return flow;
  } catch (error) {
    throw error;
  }
};
export { convertStandaloneSmileys as emojiConverter } from "@/utils/message-format";

export const createResponse = (status: boolean, message: string) => {
  return {
    success: status,
    message: message,
  };
};
