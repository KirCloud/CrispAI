import * as db from "@/services/db.service";
import axios from "axios";
import type { Context } from "hono";
import logger from "./logger.service";
import messageSendTask from "@/jobs/messageSend.task";
import messageReceivedTask from "@/jobs/messageReceived.task";
import messageUpdatedTask from "@/jobs/messageUpdated.task";
import { enqueue } from "@/utils/queue";

const crisp = axios.create({
  baseURL: "https://api.crisp.chat/v1",
  timeout: 15000,
  headers: {
    "X-Crisp-Tier": "plugin",
    "Content-Type": "application/json",
    Authorization:
      "Basic " + btoa(Bun.env.CRISP_ID! + ":" + Bun.env.CRISP_KEY!),
  },
});

crisp.interceptors.response.use(
  (response) => response,
  (error) => {
    const cfg = error.config ?? {};
    const res = error.response;
    logger.error("crisp api failed", {
      method: cfg.method?.toUpperCase(),
      url: cfg.url,
      status: res?.status,
      statusText: res?.statusText,
      data: res?.data,
      code: error.code,
      message: error.message,
    });
    return Promise.reject(error);
  },
);

type MessageBuffer = {
  messages: any[];
  timer: NodeJS.Timeout | null;
  // 已轮询次数
  ticks: number;
};

const bufferMap: Record<string, MessageBuffer> = {};
const INTERVAL = parseInt(Bun.env.MSG_BUFFER_INTERVAL || "3000", 10);
// 等待 session 建好的最长时间，超时后直接把剩余消息投递出去并停止轮询。
// 之前 session 一直建不出来（项目不存在/被禁用）时定时器会永远跑下去，每 3 秒查一次数据库，
// 越积越多，最后查询报错变成未处理的 Promise 拒绝把进程打挂
const MAX_WAIT = parseInt(Bun.env.MSG_BUFFER_MAX_WAIT || "60000", 10);
const MAX_TICKS = Math.max(1, Math.ceil(MAX_WAIT / INTERVAL));

const createJob = (data: any) =>
  enqueue(messageSendTask.queue, "messageSend", data);

// 停掉定时器并删除缓存，返回尚未投递的消息
const clearBuffer = (sessionId: string) => {
  const buf = bufferMap[sessionId];
  if (!buf) return [];
  if (buf.timer) clearInterval(buf.timer);
  delete bufferMap[sessionId];
  return buf.messages.splice(0);
};

// 停掉定时器，把剩余消息全部投递出去
const flushBuffer = (sessionId: string, reason: string) => {
  const buffered = clearBuffer(sessionId);
  logger.info(reason, { sessionId, count: buffered.length });
  for (const msg of buffered) {
    createJob(msg);
  }
};

export const bufferMessage = async (data: any) => {
  const cleanSessionId = data.session_id.replace("session_", "");

  // 初始化 buffer
  const buf = (bufferMap[cleanSessionId] ??= {
    messages: [],
    timer: null,
    ticks: 0,
  });
  buf.messages.push(data);

  // 如果已经有定时器，说明之前在等，不要重复设置
  if (buf.timer) {
    return;
  }

  // 启动定时器检查
  buf.timer = setInterval(async () => {
    const buf = bufferMap[cleanSessionId];
    if (!buf) return;
    buf.ticks += 1;

    try {
      const session = await db.getSession(cleanSessionId);

      if (session) {
        // ✅ session 已建好 → flush 剩下的消息
        flushBuffer(cleanSessionId, "Session ready, flushing remaining messages");
        return;
      }

      // ❌ 没有 session → 取第一条出来建，其他消息继续留在队列里，等下次检查
      const firstMsg = buf.messages.shift();
      if (firstMsg) {
        logger.info("No session, using first message to create", {
          sessionId: cleanSessionId,
        });
        createJob(firstMsg);
      }

      if (buf.messages.length === 0) {
        // 没有需要等待投递的消息了，停止轮询；后续再来消息会重新建 buffer
        clearBuffer(cleanSessionId);
        return;
      }

      if (buf.ticks >= MAX_TICKS) {
        logger.warn("Session not ready in time", {
          sessionId: cleanSessionId,
          waitedMs: buf.ticks * INTERVAL,
        });
        flushBuffer(cleanSessionId, "Session wait timeout, flushing remaining messages");
      }
    } catch (error) {
      // 查询失败（网络抖动、数据库短暂不可用）只记录日志，下一轮继续
      logger.error("检查 session 失败", {
        sessionId: cleanSessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      if (buf.ticks >= MAX_TICKS) {
        flushBuffer(cleanSessionId, "Session check kept failing, flushing remaining messages");
      }
    }
  }, INTERVAL);
};

export const crispWebhook = async (c: Context) => {
  const body = await c.req.json();

  switch (body.event) {
    case "message:send":
      await bufferMessage(body.data);
      break;
    case "message:received":
      const { origin } = body.data;
      if (origin === Bun.env.CRISP_URN) {
        return c.json({ ok: true, skipped: true });
      }
      enqueue(messageReceivedTask.queue, "messageReceived", body.data);
      break;
    case "message:updated":
      const { content } = body.data;
      const isPicker = content.id ? true : false;
      if (!isPicker) {
        return c.json({ ok: true, skipped: true });
      }
      enqueue(messageUpdatedTask.queue, "messageUpdated", body.data);
      break;
    default:
      logger.warn("Unhandled Crisp event:", body.event);
      break;
  }
  return c.json({ ok: true });
};

export const getMetas = async (website_id: string, session_id: string) => {
  try {
    const {
      data: { data },
    } = await crisp.get(
      `/website/${website_id}/conversation/${session_id}/meta`
    );
    const flow = [];
    if (data.nickname)
      flow.push(`👤<b>用户</b>：<code>${data.nickname}</code>`);
    if (data.email) flow.push(`📧<b>邮箱</b>：<code>${data.email}</code>`);
    if (data.device) {
      if (data.device.geolocation && data.device.geolocation.country) {
        flow.push("");
        flow.push(
          `📍<b>地理位置</b>：${data.device.geolocation.country} ${data.device.geolocation.city}`
        );
      }
      const system = data.device.system;
      if (system && system.os && system.os.name) {
        flow.push("");
        flow.push(`🖥<b>操作系统</b>：${system.os.name}`);
      }
      if (system && system.browser && system.browser.name) {
        flow.push("");
        flow.push(`🌐<b>浏览器</b>：${system.browser.name}`);
      }
      if (data.data) {
        flow.push("");
        flow.push("📄<b>附加信息</b>：");
        flow.push("<pre>" + JSON.stringify(data.data) + "</pre>");
      }
    }
    return flow;
  } catch (error) {
    throw error;
  }
};
export const listPages = async (website_id: string, session_id: string) => {
  try {
    const {
      data: { data },
    } = await crisp.get(
      `/website/${website_id}/conversation/${session_id}/pages/1`
    );
    const flow = [];
    if (data && data.length > 0) {
      flow.push("");
      flow.push("📄<b>访问历史</b>：");
      for (let i = 0; i < data.length; i++) {
        const page = data[i];
        flow.push(
          `${i === 0 ? "<blockquote expandable>" : ""}<a href="${
            page.page_url
          }">${page.page_url}</a>`
        );
        if (page.page_referrer) {
          flow.push(
            `来源：<a href="${page.page_referrer}">${page.page_referrer}</a>`
          );
        }
        if (i === data.length - 1) flow.push("</blockquote>");
      }
    }
    return flow;
  } catch (error) {
    return [];
  }
};

export const composeMessage = async (
  website_id: string,
  session_id: string,
  action: boolean
) => {
  try {
    await crisp.patch(
      `/website/${website_id}/conversation/${session_id}/compose`,
      {
        type: action ? "start" : "stop",
        from: "operator",
      }
    );
  } catch {
    return false;
  }
  return true;
};
export const sendMessage = async (
  website_id: string,
  session_id: string,
  message: string,
  botName: string,
  botURL: string
) => {
  try {
    await crisp.post(
      `/website/${website_id}/conversation/${session_id}/message`,
      {
        type: "text",
        content: message,
        from: "operator",
        origin: Bun.env.CRISP_URN ?? "chat",
        user: {
          type: "website",
          nickname: botName ?? "智能客服",
          avatar: botURL ?? "https://img.icons8.com/officel/80/bot.png",
        },
      }
    );
    return true;
  } catch (error) {
    throw error;
  }
};
export const sendOption = async (
  website_id: string,
  session_id: string,
  option: any,
  botName: string,
  botURL: string
) => {
  try {
    await crisp.post(
      `/website/${website_id}/conversation/${session_id}/message`,
      {
        type: "picker",
        content: {
          id: option.id,
          text: option.text,
          choices: option.options.map((choice: any) => {
            return {
              value: choice.id,
              label: choice.label,
              selected: false,
            };
          }),
        },
        from: "operator",
        origin: Bun.env.CRISP_URN ?? "chat",
        user: {
          type: "website",
          nickname: botName ?? "智能客服",
          avatar: botURL ?? "https://img.icons8.com/officel/80/bot.png",
        },
      }
    );
    return true;
  } catch (error) {
    throw error;
  }
};

export const checkSession = async (website_id: string, session_id: string) => {
  try {
    await crisp.head(`/website/${website_id}/conversation/${session_id}`);
    return true;
  } catch (error) {
    return false;
  }
};
export const getMessages = async (website_id: string, session_id: string) => {
  try {
    const result = await checkSession(website_id, session_id);
    if (!result) return [];
    const {
      data: { data },
    } = await crisp.get(
      `/website/${website_id}/conversation/${session_id}/messages`
    );
    return data;
  } catch (error) {
    throw error;
  }
};
