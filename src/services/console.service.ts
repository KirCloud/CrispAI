import path from "node:path";
import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { adminAuth, safeReturnPath } from "@/services/admin-auth.service";

export const CONSOLE_DIR = path.resolve(import.meta.dir, "../../web");

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
    return c.html(
      await Bun.file(path.join(CONSOLE_DIR, name + ".html")).text(),
    );
  };
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
  routes.get("/", auth.middleware, (c) => c.redirect("/dashboard"));
  for (const route of ["/dashboard", "/dashboard/"])
    routes.get(route, auth.middleware, (c) => page("dashboard", c));
  for (const route of ["/settings/ai", "/settings/ai/"])
    routes.get(route, auth.middleware, (c) => page("ai", c));
  return routes;
}
