import IORedis from "ioredis";

// 优先使用环境变量 REDIS_URL，格式：redis://:密码@主机:端口/库编号
// 未配置时回退到本机 127.0.0.1:6379 的 0 号库
const redisUrl = Bun.env.REDIS_URL;

export const connection = redisUrl
  ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
  : new IORedis({ maxRetriesPerRequest: null, db: 0 });
