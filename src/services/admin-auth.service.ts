import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const COOKIE = "crispai_session";
const BROWSER_COOKIE = "crispai_browser";
const SESSION_SECONDS = 12 * 60 * 60;
const equal = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );

export function safeReturnPath(value: string | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    return "/dashboard";
  try {
    const url = new URL(value, "https://console.invalid");
    return url.origin === "https://console.invalid" &&
      url.pathname !== "/login" &&
      url.pathname !== "/login/"
      ? url.pathname + url.search
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export function createAdminAuth(options: {
  credentials: () => { username: string; password?: string };
  publicUrl?: string;
  trustProxy?: boolean;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, { expires: number; identity: string }>();
  const failures = new Map<string, { count: number; until: number }>();
  const identity = () => {
    const { username, password } = options.credentials();
    return createHash("sha256")
      .update(username + "\0" + password)
      .digest("hex");
  };
  const originFor = (c: Context) =>
    new URL(options.publicUrl || c.req.url).origin;
  const sameOrigin = (c: Context) => c.req.header("origin") === originFor(c);
  const prune = () => {
    for (const [key, session] of sessions)
      if (session.expires <= now()) sessions.delete(key);
    for (const [key, failure] of failures)
      if (failure.until <= now()) failures.delete(key);
  };
  const sessionFor = (c: Context) => {
    const token = getCookie(c, COOKIE);
    const session = token ? sessions.get(token) : undefined;
    if (
      !session ||
      session.expires <= now() ||
      session.identity !== identity()
    ) {
      if (token) sessions.delete(token);
      return undefined;
    }
    return session;
  };
  const basicMatches = (c: Context) => {
    // Explicit Basic auth remains available to command-line integrations.
    // Browsers use a revocable session, including after a former native login.
    if (
      c.req.header("sec-fetch-mode") ||
      c.req.header("accept")?.includes("text/html") ||
      getCookie(c, BROWSER_COOKIE) === "1"
    )
      return false;
    const header = c.req.header("authorization") || "";
    if (!header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const index = decoded.indexOf(":");
    const credentials = options.credentials();
    const userOK = equal(decoded.slice(0, index), credentials.username);
    const passwordOK = equal(
      decoded.slice(index + 1),
      credentials.password || "",
    );
    return index >= 0 && userOK && passwordOK;
  };
  const router = new Hono();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  router.post("/login", async (c) => {
    if (!options.credentials().password)
      return c.json({ message: "管理员尚未配置登录密码" }, 503);
    if (!sameOrigin(c)) return c.json({ message: "请求来源不匹配" }, 403);
    if (!c.req.header("content-type")?.startsWith("application/json"))
      return c.json({ message: "请使用 JSON 请求" }, 415);
    prune();
    const address =
      (options.trustProxy ? c.req.header("x-real-ip") : undefined) ||
      (c.env as { remoteAddress?: string } | undefined)?.remoteAddress ||
      "local";
    const failure = failures.get(address);
    if (failure && failure.count >= 10) {
      c.header(
        "Retry-After",
        String(Math.ceil((failure.until - now()) / 1000)),
      );
      return c.json({ message: "登录尝试过多，请稍后再试" }, 429);
    }
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "请求格式不正确" }, 400);
    }
    if (
      typeof body?.username !== "string" ||
      typeof body?.password !== "string" ||
      body.username.length > 256 ||
      body.password.length > 8192
    )
      return c.json({ message: "请输入账号和密码" }, 400);
    const credentials = options.credentials();
    const userOK = equal(body.username, credentials.username);
    const passwordOK = equal(body.password, credentials.password!);
    if (!userOK || !passwordOK) {
      if (failures.size >= 5000 && !failure)
        failures.delete(failures.keys().next().value!);
      failures.set(address, {
        count: (failure?.count ?? 0) + 1,
        until: failure?.until ?? now() + 15 * 60_000,
      });
      return c.json({ message: "账号或密码不正确" }, 401);
    }
    failures.delete(address);
    const previous = getCookie(c, COOKIE);
    if (previous) sessions.delete(previous);
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, {
      expires: now() + SESSION_SECONDS * 1000,
      identity: identity(),
    });
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: originFor(c).startsWith("https:"),
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    setCookie(c, BROWSER_COOKIE, "1", {
      httpOnly: true,
      secure: originFor(c).startsWith("https:"),
      sameSite: "Strict",
      path: "/",
      maxAge: 30 * 86400,
    });
    return c.json({
      redirect: safeReturnPath(
        typeof body.next === "string" ? body.next : undefined,
      ),
    });
  });
  router.get("/session", (c) =>
    sessionFor(c)
      ? c.json({ username: options.credentials().username })
      : c.json({ message: "请先登录" }, 401),
  );
  router.post("/logout", (c) => {
    if (!sameOrigin(c)) return c.json({ message: "请求来源不匹配" }, 403);
    const token = getCookie(c, COOKIE);
    if (token) sessions.delete(token);
    deleteCookie(c, COOKIE, {
      path: "/",
      secure: originFor(c).startsWith("https:"),
      httpOnly: true,
      sameSite: "Strict",
    });
    setCookie(c, BROWSER_COOKIE, "1", {
      httpOnly: true,
      secure: originFor(c).startsWith("https:"),
      sameSite: "Strict",
      path: "/",
      maxAge: 30 * 86400,
    });
    return c.json({ message: "已退出登录" });
  });
  const middleware: MiddlewareHandler = async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!options.credentials().password)
      return c.json({ message: "未配置 ADMIN_PASSWORD，管理后台已禁用" }, 503);
    const session = sessionFor(c);
    const basic = !session && basicMatches(c);
    if (!session && !basic) {
      return c.req.path.startsWith("/api/")
        ? c.json({ message: "登录已过期，请重新登录" }, 401)
        : c.redirect(
            "/login?next=" +
              encodeURIComponent(c.req.path + new URL(c.req.url).search),
          );
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      if ((session || c.req.header("origin")) && !sameOrigin(c))
        return c.json({ message: "请求来源不匹配" }, 403);
    }
    await next();
  };
  return {
    router,
    middleware,
    isSignedIn: (c: Context) => Boolean(sessionFor(c)),
  };
}

export const adminAuth = createAdminAuth({
  credentials: () => ({
    username: Bun.env.ADMIN_USER || "admin",
    password: Bun.env.ADMIN_PASSWORD,
  }),
  publicUrl: Bun.env.PUBLIC_URL,
  trustProxy: Bun.env.TRUST_PROXY === "true",
});
