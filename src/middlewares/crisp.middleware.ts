import type { Context, Next } from "hono";
import Crypto from "crypto";
import logger from "@/services/logger.service";

export const crispMiddleware = async (c: Context, next: Next) => {
  const body = await c.req.json();
  const timestamp = c.req.header("x-crisp-request-timestamp") ?? "";
  const signature = c.req.header("x-crisp-signature") ?? "";
  const secret = Bun.env.CRISP_SECRET;

  if (
    !secret ||
    !signature ||
    !body ||
    typeof body !== "object" ||
    !timestamp ||
    isNaN(parseInt(timestamp)) === true
  ) {
    logger.warn("Hook verification failed", {
      secret: !!secret,
      signature: !!signature,
      body: !!body,
      timestamp,
    });
    return c.json({ message: "无效的请求" }, 400);
  }

  const localTrace = "[" + timestamp + ";" + JSON.stringify(body) + "]";
  const localMac = Crypto.createHmac("sha256", secret);
  localMac.update(localTrace);
  const localSignature = localMac.digest("hex");
  const isValid = signature === localSignature;
  if (!isValid) {
    logger.warn("Signature verification failed", {
      expected: localSignature,
      received: signature,
    });
    return c.json({ message: "无效的请求" }, 400);
  }

  await next();
};
