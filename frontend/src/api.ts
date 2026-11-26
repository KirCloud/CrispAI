export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

export function loginPath(next = location.pathname + location.search) {
  return `/login?next=${encodeURIComponent(next)}`;
}

export async function request<T = unknown>(
  path: string,
  { method = "GET", body, signal }: Options = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(45_000),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(
      (error as Error).name === "TimeoutError"
        ? "请求超时，请稍后重试"
        : "网络连接失败，请检查网络后重试",
      0,
    );
  }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/api/auth/login")) {
    location.replace(loginPath());
    throw new ApiError("登录已过期，请重新登录", 401);
  }
  if (!response.ok)
    throw new ApiError(result.message || "请求失败，请稍后重试", response.status);
  return result as T;
}

export const api = {
  get: <T>(path: string) => request<{ data: T }>(path).then((r) => r.data),
  post: <T = { message: string }>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body }),
  put: <T = { message: string }>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body }),
};

export const projectQuery = (id: string) => `/api/v1/project?id=${id}`;
export const scoped = (path: string, projectId: string) =>
  `${path}?project_id=${encodeURIComponent(projectId)}`;
