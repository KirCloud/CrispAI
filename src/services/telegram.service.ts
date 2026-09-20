import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { ChatMemberAdministrator } from "grammy/types";
import telegramCallbackTask from "@/jobs/telegramCallback.task";
import telegramReplyTask from "@/jobs/telegramReply.task";
import logger from "@/services/logger.service";
import { enqueue } from "@/utils/queue";

const TOKEN = Bun.env.TELEGRAM_TOKEN || "";
const bot = new Bot(TOKEN);
bot.api.config.use(autoRetry());

// 处理更新出错时只记录日志并正常返回 200。
// grammY 默认会把错误重新抛出，Webhook 返回 500 后 Telegram 会不断重发同一条更新
bot.catch((err) => {
  const error = err.error;
  logger.error("Telegram 更新处理失败", {
    updateId: err.ctx?.update?.update_id,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

bot.command("start", (ctx) => ctx.reply("请输入 /ping 获取群组 ID"));
bot.command("ping", async (ctx) => {
  try {
    const isTopicGroup = ctx.chat.is_forum || ctx.message?.chat.is_forum;
    if (!isTopicGroup) {
      await ctx.reply("该群不是话题群");
      return;
    }

    const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
    const me = admins.find(
      (admin) => admin.user.id === ctx.me.id
    ) as ChatMemberAdministrator;
    if (!me || !me.can_manage_topics) {
      await ctx.reply("请将管理话题权限赋予我");
      return;
    }
    await ctx.reply(`群组 ID: \`${ctx.chat.id}\`\n请复制到网页内保存`, {
      parse_mode: "MarkdownV2",
    });
  } catch (e) {
    logger.error("处理 /ping 命令失败:", e);
  }
});
bot.on("callback_query:data", async (ctx) => {
  // 先入队再应答：应答失败（例如按钮点击已过期）不影响任务执行
  enqueue(telegramCallbackTask.queue, "telegramCallback", ctx.callbackQuery.data);
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    logger.warn("应答 callback query 失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
bot.on("msg:text", async (ctx) => {
  if (!ctx.message?.is_topic_message) return;
  enqueue(telegramReplyTask.queue, "telegramReply", ctx.message);
});
bot.on("msg:photo", async (ctx) => {
  if (!ctx.message?.is_topic_message) return;
  enqueue(telegramReplyTask.queue, "telegramReply", ctx.message);
});
bot.on("msg:sticker", async (ctx) => {
  if (!ctx.message?.is_topic_message) return;
  enqueue(telegramReplyTask.queue, "telegramReply", ctx.message);
});

export const changeAI = (groupId: number, topicId: number, bool: boolean) => {
  const text = bool ? "暂时关闭 AI 回复" : "开启 AI 回复";
  const callback_data = bool
    ? `close_${groupId}_${topicId}`
    : `open_${groupId}_${topicId}`;
  return {
    inline_keyboard: [[{ text, callback_data }]],
  };
};

// 注册 Webhook 失败后的重试间隔
const WEBHOOK_RETRY_DELAY = 30_000;
// 单次注册请求的最长等待时间（含 auto-retry 内部的重试等待）
const WEBHOOK_TIMEOUT = 20_000;

/**
 * 注册 Telegram Webhook，在后台不断重试直到成功。
 * 之前是在启动时同步调用、失败即 process.exit(1)，Telegram 一抖动就进入崩溃重启循环；
 * 现在失败只记录日志并稍后重试，不阻塞 HTTP 服务启动，也不会退出进程。
 */
// Webhook 校验用的 secret：Telegram 每次回调都会带在 X-Telegram-Bot-Api-Secret-Token 头里，
// 没有它任何人都能向 /telegram 伪造消息。没单独配置时由 bot token 派生，不需要额外的环境变量
export const WEBHOOK_SECRET =
  Bun.env.TELEGRAM_SECRET ||
  new Bun.CryptoHasher("sha256")
    .update("crispai-webhook:" + (Bun.env.TELEGRAM_TOKEN ?? ""))
    .digest("hex");

export const setupWebhook = async () => {
  // 默认用 PUBLIC_URL 拼，反向代理路径特殊时可以用 TELEGRAM_ENDPOINT 单独指定
  const publicUrl = (Bun.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  const endpoint =
    Bun.env.TELEGRAM_ENDPOINT || (publicUrl ? `${publicUrl}/telegram` : "");
  if (!endpoint) {
    logger.error("未配置 PUBLIC_URL，跳过 Telegram Webhook 注册");
    return;
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await bot.api.setWebhook(
        endpoint,
        { drop_pending_updates: true, secret_token: WEBHOOK_SECRET },
        // grammY 的类型声明用的是 abort-controller 包里的 AbortSignal，
        // 与运行时的标准 AbortSignal 只是类型不兼容，实际可以直接使用
        AbortSignal.timeout(WEBHOOK_TIMEOUT) as any
      );
      logger.info("Telegram Webhook 设置成功");
      return;
    } catch (error) {
      logger.error(
        `设置 Telegram Webhook 失败（第 ${attempt} 次），${
          WEBHOOK_RETRY_DELAY / 1000
        } 秒后重试:`,
        error
      );
      await Bun.sleep(WEBHOOK_RETRY_DELAY);
    }
  }
};

export default bot;
