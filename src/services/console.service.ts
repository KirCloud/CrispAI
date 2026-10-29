import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import { adminAuth, safeReturnPath } from "@/services/admin-auth.service";

export const CONSOLE_DIR = path.resolve(import.meta.dir, "../../web");
export const ORIGINAL_DIR = path.resolve(import.meta.dir, "../../public");
// Put the version in the URL path: CDNs can cache scripts despite no-cache,
// and some configurations ignore query parameters when choosing cache keys.
export function consoleAssetVersion(root = CONSOLE_DIR) {
  const hash = createHash("sha256");
  for (const file of [
    "ai-panel.html",
    ...readdirSync(path.join(root, "assets"))
      .sort()
      .map((name) => "assets/" + name),
  ]) {
    hash.update(file + "\0").update(readFileSync(path.join(root, file)));
  }
  return hash.digest("hex").slice(0, 16);
}
export const CONSOLE_ASSET_PREFIX = `/console-assets/${consoleAssetVersion()}`;

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
  // Buffer the small HTML document before handing it back to Hono. Bun 1.3
  // aborts a transformed file stream when Hono wraps the response body.
  const original = c.res;
  const rewritten = new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(
          `<link rel="stylesheet" href="${CONSOLE_ASSET_PREFIX}/console.css"><script type="module" src="${CONSOLE_ASSET_PREFIX}/extension.js"></script>`,
          { html: true },
        );
      },
    })
    .transform(new Response(await original.text()));
  const html = await rewritten.text();
  original.headers.delete("Content-Length");
  original.headers.set("Cache-Control", "no-store");
  c.res = new Response(html, {
    status: original.status,
    headers: original.headers,
  });
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
    html = html.replaceAll("__CONSOLE_ASSETS__", CONSOLE_ASSET_PREFIX);
    return c.html(html);
  };
  routes.get("/console-assets/:version/:file", async (c) => {
    const file = c.req.param("file");
    if (
      `/console-assets/${c.req.param("version")}` !== CONSOLE_ASSET_PREFIX ||
      !["console.js", "site-api.js", "extension.js", "console.css"].includes(
        file,
      )
    )
      return c.notFound();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    c.header(
      "Content-Type",
      file.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/javascript; charset=utf-8",
    );
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(
      await Bun.file(path.join(CONSOLE_DIR, "assets", file)).arrayBuffer(),
    );
  });
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
