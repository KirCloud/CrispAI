import path from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import { adminAuth, safeReturnPath } from "@/services/admin-auth.service";

export const CONSOLE_DIR = path.resolve(import.meta.dir, "../../web");
export const ORIGINAL_DIR = path.resolve(import.meta.dir, "../../public");

export function mountOriginalConsole(
  app: Hono,
  auth = adminAuth,
  root = ORIGINAL_DIR,
) {
  app.use("*", auth.middleware);
  app.use("*", extendOriginalConsole);
  app.use("*", serveStatic({ root }));
}

// Add our independent extension at response time. Upstream's public/ files
// remain byte-for-byte unchanged, including its project editor and dashboard.
export const extendOriginalConsole: MiddlewareHandler = async (c, next) => {
  await next();
  if (
    c.res.status !== 200 ||
    !/^\/dashboard(?:\/|$)/.test(c.req.path) ||
    !c.res.headers.get("Content-Type")?.includes("text/html")
  )
    return;
  c.res = new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(
          '<link rel="stylesheet" href="/console-assets/console.css?v=2"><script type="module" src="/console-assets/extension.js?v=2"></script>',
          { html: true },
        );
      },
    })
    .transform(c.res);
};

export function createConsoleRoutes(auth = adminAuth) {
  const routes = new Hono();
  const page = async (name: string, c: Context) => {
    c.header("Cache-Control", "no-store");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    let html = await Bun.file(path.join(CONSOLE_DIR, name + ".html")).text();
    if (name === "ai")
      html = html.replace(
        "<!-- AI_PANEL -->",
        await Bun.file(path.join(CONSOLE_DIR, "ai-panel.html")).text(),
      );
    return c.html(html);
  };
  routes.use("/console-assets/*", async (c, next) => {
    c.header("Cache-Control", "no-cache");
    await next();
  });
  routes.get(
    "/console-assets/*",
    serveStatic({
      root: CONSOLE_DIR,
      rewriteRequestPath: (value) =>
        value.replace(/^\/console-assets/, "/assets"),
    }),
  );
  routes.get("/login", (c) =>
    auth.isSignedIn(c)
      ? c.redirect(safeReturnPath(c.req.query("next")))
      : page("login", c),
  );
  routes.get("/login/", (c) =>
    c.redirect("/login" + new URL(c.req.url).search),
  );
  routes.route("/api/auth", auth.router);
  routes.get("/console-logo.png", async (c) =>
    c.body(
      await Bun.file(path.join(ORIGINAL_DIR, "logo-simple.png")).arrayBuffer(),
      200,
      { "Content-Type": "image/png" },
    ),
  );
  routes.get("/api/console/ai-panel", auth.middleware, (c) =>
    page("ai-panel", c),
  );
  routes.get("/", auth.middleware, (c) => c.redirect("/dashboard"));
  for (const route of ["/settings/ai", "/settings/ai/"])
    routes.get(route, auth.middleware, (c) => page("ai", c));
  return routes;
}
