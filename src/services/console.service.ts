import path from "node:path";
import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { adminAuth, safeReturnPath } from "@/services/admin-auth.service";

export const CONSOLE_DIR = Bun.env.CONSOLE_DIR
  ? path.resolve(Bun.env.CONSOLE_DIR)
  : path.resolve(import.meta.dir, "../../frontend/dist");

// Bot avatars are arbitrary HTTPS URLs; HeroUI writes inline style attributes.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const STATIC_FILES = ["/favicon.ico", "/logo.png", "/theme-init.js"];
const APP_PAGES = ["/dashboard", "/dashboard/project", "/settings/ai"];

export function createConsoleRoutes(auth = adminAuth, root = CONSOLE_DIR) {
  const routes = new Hono();
  const app = async (c: Context) => {
    const file = Bun.file(path.join(root, "index.html"));
    if (!(await file.exists()))
      return c.text("管理后台尚未构建，请先在 frontend/ 运行 bun run build", 503);
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", CSP);
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    return c.html(await file.text());
  };

  routes.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.ok)
      c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  routes.get("/assets/*", serveStatic({ root }));
  for (const file of STATIC_FILES) routes.get(file, serveStatic({ root }));

  routes.route("/api/auth", auth.router);
  routes.get("/login", (c) =>
    auth.isSignedIn(c) ? c.redirect(safeReturnPath(c.req.query("next"))) : app(c),
  );
  routes.get("/", auth.middleware, (c) => c.redirect("/dashboard"));
  for (const page of APP_PAGES) {
    routes.get(page, auth.middleware, app);
    // Upstream's static export used trailing slashes; keep old bookmarks working.
    routes.get(page + "/", (c) =>
      c.redirect(page + new URL(c.req.url).search, 301),
    );
  }
  routes.get("/login/", (c) => c.redirect("/login" + new URL(c.req.url).search));
  return routes;
}
