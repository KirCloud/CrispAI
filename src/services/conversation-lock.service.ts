import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
const lease = 120_000;
// Serializes a conversation across workers and application replicas so warning
// order, history writes and the third-warning cutoff cannot race each other.
export async function withConversationLock<T>(
  redis: Redis,
  website: string,
  session: string,
  work: () => Promise<T>,
) {
  const key = `crispai:conversation-lock:${website}:${session.replace(/^session_/, "")}`;
  const token = randomUUID(),
    deadline = Date.now() + 120_000;
  while ((await redis.set(key, token, "PX", lease, "NX")) !== "OK") {
    if (Date.now() >= deadline)
      throw new Error("Conversation is busy; retry this message");
    await Bun.sleep(100);
  }
  const heartbeat = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) end return 0",
        1,
        key,
        token,
        String(lease),
      )
      .catch(() => {});
  }, 30_000);
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end return 0",
        1,
        key,
        token,
      )
      .catch(() => {});
  }
}
