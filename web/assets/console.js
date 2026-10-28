const dirtyForms = new Set();
let leaving = false;
const hasUnsavedChanges = () =>
  [...dirtyForms].some((form) => form.isConnected);

export async function request(
  path,
  { method = "GET", body, login = false } = {},
) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response
    .json()
    .catch(() => ({ message: "服务器返回了无法读取的响应" }));
  if (response.status === 401 && !login) {
    leaving = true;
    location.replace(
      `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
    );
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(result.message || "请求失败，请稍后重试");
  return result;
}

export async function logout(button) {
  if (hasUnsavedChanges() && !confirm("还有未保存的 AI 配置，确定退出吗？"))
    return;
  button.disabled = true;
  try {
    await request("/api/auth/logout", { method: "POST", body: {} });
    leaving = true;
    location.replace("/login");
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(
    "[data-reveal],[data-logout],[data-theme]",
  );
  if (!button) return;
  if (button.hasAttribute("data-logout")) {
    void logout(button);
    return;
  }
  if (button.hasAttribute("data-theme")) {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
    return;
  }
  const input = document.getElementById(button.dataset.reveal);
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  button.textContent = reveal ? "隐藏" : "显示";
  button.setAttribute("aria-pressed", String(reveal));
  button.setAttribute(
    "aria-label",
    (reveal ? "隐藏" : "显示") + (input.id.endsWith("key") ? "密钥" : "密码"),
  );
});
window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedChanges() && !leaving) {
    event.preventDefault();
    event.returnValue = "";
  }
});

export function mountAIForm(form) {
  if (form.dataset.mounted) return;
  form.dataset.mounted = "true";
  const $ = (selector) => form.querySelector(selector);
  const save = $("#save-ai");
  const test = $("#test-connection");
  let loaded = false;
  let busy = false;
  let hasSavedKey = false;
  let hasSavedEmbeddingKey = false;
  const message = (text, kind = "") => {
    $("#form-message").textContent = text;
    $("#form-message").className = `kc-message ${kind}`;
  };
  const setDirty = (dirty) => {
    if (dirty) dirtyForms.add(form);
    else dirtyForms.delete(form);
    $("#save-state").textContent = dirty
      ? "有未保存的修改"
      : "配置已同步，保存后即时生效";
  };
  const setBusy = (value) => {
    busy = value;
    form.querySelectorAll("input,button,select").forEach((input) => {
      input.disabled = value;
    });
    save.textContent = value ? "处理中…" : "保存配置";
    syncEmbedding();
  };
  const applyState = (config) => {
    hasSavedKey = config.hasApiKey;
    hasSavedEmbeddingKey = config.hasEmbeddingApiKey;
    $("#embedding-key-status").textContent = config.hasEmbeddingApiKey
      ? "已保存"
      : "尚未设置（同接口可复用对话密钥）";
    $("#embedding-api-key").placeholder = config.hasEmbeddingApiKey
      ? "留空保留现有向量密钥"
      : "独立服务商的 API 密钥";
    $("#config-status").textContent = config.configured ? "已配置" : "等待配置";
    $("#config-status").className =
      `kc-state ${config.configured ? "ready" : ""}`;
    $("#key-status").textContent = config.hasApiKey ? "已保存" : "尚未设置";
    $("#config-source").textContent =
      config.source === "database" ? "后台配置" : "环境变量";
    $("#api-key").placeholder = config.hasApiKey
      ? "留空保留现有密钥"
      : "输入 API 密钥";
    $("#key-help").textContent = config.hasApiKey
      ? "已保存的密钥不会回显，留空保留现有值，填写新值则替换。"
      : "密钥保存在服务器，读取时不会返回。";
  };
  function syncEmbedding() {
    const enabled = $("#enable-embedding").checked;
    $("#embedding-options").hidden = !enabled;
    $("#embedding-model").required = enabled;
    $("#embedding-options")
      .querySelectorAll("select,input,button")
      .forEach((input) => {
        input.disabled = busy || !enabled;
      });
    if (!enabled) $("#test-embedding").checked = false;
  }
  function optionsFor(select, models, selected = "") {
    select.replaceChildren(new Option("请选择模型", ""));
    if (selected && !models.some((model) => model.id === selected))
      select.add(new Option(selected + "（当前配置）", selected));
    for (const model of models)
      select.add(
        new Option(
          model.name !== model.id ? `${model.name} (${model.id})` : model.id,
          model.id,
        ),
      );
    select.value = selected;
  }
  async function readModels(target = "chat") {
    const embedding = target === "embedding";
    if (
      !loaded ||
      busy ||
      !$("#base-url").reportValidity() ||
      (embedding && !$("#embedding-base-url").reportValidity())
    )
      return;
    const connection = connectionValues();
    const separate =
      embedding &&
      connection.embeddingBaseUrl &&
      connection.embeddingBaseUrl.replace(/\/+$/, "") !==
        connection.baseUrl.replace(/\/+$/, "");
    const keyAvailable =
      (embedding && (connection.embeddingApiKey || hasSavedEmbeddingKey)) ||
      (!separate && (connection.apiKey || hasSavedKey));
    if (!keyAvailable) {
      message(
        embedding
          ? "请填写向量接口密钥，再读取模型列表。"
          : "请先填写 API 密钥，再读取模型列表。",
        "error",
      );
      return;
    }
    const select = embedding ? $("#embedding-model") : $("#chat-model");
    const selected = select.value;
    setBusy(true);
    message("正在从服务商读取模型列表…");
    try {
      const result = await request("/api/v1/settings/ai/models", {
        method: "POST",
        body: { ...connection, target },
      });
      optionsFor(select, result.data, selected);
      $(embedding ? "#embedding-models-help" : "#models-help").textContent =
        result.data.length
          ? `已从 /models 读取 ${result.data.length} 个模型，请选择${embedding ? "支持 Embeddings 且输出 1536 维的模型" : "对话模型"}。`
          : "服务商未返回可用模型。";
      $(
        embedding ? "#refresh-embedding-models" : "#refresh-models",
      ).textContent = embedding ? "刷新向量模型" : "刷新模型";
      message(
        result.data.length
          ? "模型列表已更新，尚未保存配置。"
          : "服务商未返回可用模型。",
        result.data.length ? "" : "error",
      );
    } catch (error) {
      message(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  const connectionValues = () => ({
    baseUrl: $("#base-url").value.trim(),
    apiKey: $("#api-key").value.trim(),
    embeddingBaseUrl: $("#embedding-base-url").value.trim(),
    embeddingApiKey: $("#embedding-api-key").value.trim(),
  });
  const values = () => ({
    ...connectionValues(),
    model: $("#chat-model").value.trim(),
    embeddingModel: $("#enable-embedding").checked
      ? $("#embedding-model").value
      : "",
  });
  setBusy(true);
  request("/api/v1/settings/ai")
    .then(({ data }) => {
      $("#base-url").value = data.baseUrl;
      $("#embedding-base-url").value = data.embeddingBaseUrl || "";
      optionsFor($("#chat-model"), [], data.configured ? data.model : "");
      optionsFor($("#embedding-model"), [], data.embeddingModel);
      $("#enable-embedding").checked =
        Boolean(data.embeddingModel) &&
        (data.configured || data.source === "database");
      applyState(data);
      loaded = true;
      setBusy(false);
      setDirty(false);
      if (data.configured) void readModels();
    })
    .catch((error) => {
      $("#save-state").textContent = "配置读取失败，请刷新重试";
      message(error.message, "error");
    });
  form.addEventListener("input", (event) => {
    if (
      loaded &&
      !event.target.closest("#knowledge-source") &&
      !["test-embedding", "reindex-all"].includes(event.target.id)
    ) {
      setDirty(true);
      message("");
      if (["base-url", "api-key"].includes(event.target.id)) {
        optionsFor($("#chat-model"), []);
        if (!$("#embedding-base-url").value)
          optionsFor($("#embedding-model"), []);
        $("#models-help").textContent = "连接参数已修改，请重新读取模型列表。";
      }
      if (
        ["embedding-base-url", "embedding-api-key"].includes(event.target.id)
      ) {
        optionsFor($("#embedding-model"), []);
        $("#embedding-models-help").textContent =
          "向量连接已修改，请重新读取向量模型列表。";
      }
    }
  });
  $("#enable-embedding").addEventListener("change", syncEmbedding);
  $("#refresh-models").addEventListener("click", () => {
    void readModels();
  });
  $("#refresh-embedding-models").addEventListener("click", () => {
    void readModels("embedding");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loaded || busy) return;
    const data = values();
    setBusy(true);
    message("正在保存配置…");
    try {
      const result = await request("/api/v1/settings/ai", {
        method: "PUT",
        body: data,
      });
      for (const id of ["api-key", "embedding-api-key"]) {
        $("#" + id).value = "";
        $("#" + id).type = "password";
        const reveal = $(`[data-reveal="${id}"]`);
        reveal.textContent = "显示";
        reveal.setAttribute("aria-label", "显示密钥");
        reveal.setAttribute("aria-pressed", "false");
      }
      $("#base-url").value = result.data.baseUrl;
      applyState(result.data);
      setDirty(false);
      message(
        "配置已保存并即时生效。项目的回复开关和提示词仍在「智能回复」中设置。",
        "success",
      );
    } catch (error) {
      message(error.message, "error");
    } finally {
      setBusy(false);
    }
  });
  test.addEventListener("click", async () => {
    if (!loaded || busy || !form.reportValidity()) return;
    const data = { ...values(), testEmbedding: $("#test-embedding").checked };
    setBusy(true);
    message("正在测试当前表单中的连接参数…");
    try {
      const result = await request("/api/v1/settings/ai/test", {
        method: "POST",
        body: data,
      });
      message(
        `${result.message} · ${result.latencyMs} ms${result.embeddingDimensions ? ` · ${result.embeddingDimensions} 维` : ""}。测试未保存配置。`,
        "success",
      );
    } catch (error) {
      message(error.message, "error");
    } finally {
      setBusy(false);
    }
  });
  const projectId = new URLSearchParams(location.search).get("id");
  if (/^[0-9a-f-]{36}$/i.test(projectId || "")) {
    $("#knowledge-tools").hidden = false;
    let entries = [];
    async function refreshKnowledge() {
      const result = await request(
        `/api/v1/knowledge?project_id=${encodeURIComponent(projectId)}`,
      );
      entries = result.data;
      const indexed = entries.filter((entry) => entry.indexed).length;
      $("#knowledge-status").textContent =
        `共 ${entries.length} 条，已生成向量 ${indexed} 条，待生成 ${entries.length - indexed} 条。`;
    }
    $("#refresh-knowledge").addEventListener("click", () => {
      void refreshKnowledge().catch((error) => {
        $("#knowledge-message").textContent = error.message;
      });
    });
    $("#index-knowledge").addEventListener("click", async () => {
      if (!loaded || busy) return;
      if (dirtyForms.has(form)) {
        $("#knowledge-message").textContent =
          "请先保存 AI 配置，再生成知识库向量。";
        return;
      }
      setBusy(true);
      try {
        await refreshKnowledge();
        const pending = entries.filter(
          (entry) => $("#reindex-all").checked || !entry.indexed,
        );
        for (let i = 0; i < pending.length; i++) {
          $("#knowledge-message").textContent =
            `正在生成 ${i + 1}/${pending.length}：${pending[i].name}`;
          await request("/api/v1/knowledge/index", {
            method: "POST",
            body: { project_id: projectId, payload_id: pending[i].id },
          });
        }
        $("#knowledge-message").textContent = pending.length
          ? `已完成 ${pending.length} 条向量，知识库可用于自动检索。`
          : "全部条目已生成向量。";
      } catch (error) {
        $("#knowledge-message").textContent =
          `${error.message}；已完成的条目会保留，再次点击可继续。`;
      } finally {
        await refreshKnowledge().catch(() => {});
        setBusy(false);
      }
    });
    const sourcePath = `/api/v1/knowledge/source?project_id=${encodeURIComponent(projectId)}`;
    function sourceStatus(data) {
      if (!data) return "尚未配置文档来源";
      return [
        data.syncing
          ? "正在后台同步…"
          : data.lastMessage || "来源已保存，等待同步",
        data.lastSuccess
          ? `最近成功：${new Date(data.lastSuccess).toLocaleString()}`
          : "",
        data.enabled
          ? `每 ${data.intervalMinutes} 分钟自动同步`
          : "定时同步未开启",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    async function readSource(fill = false) {
      const { data } = await request(sourcePath);
      $("#source-status").textContent = sourceStatus(data);
      if (fill && data) {
        $("#source-url").value = data.apiUrl;
        $("#source-docs-url").value = data.docsUrl;
        $("#source-interval").value = data.intervalMinutes;
        $("#source-enabled").checked = data.enabled;
        $("#source-token-state").textContent = data.hasAuthorization
          ? "令牌已保存，留空保留；不会返回浏览器。令牌失效时同步会停止并保留现有文档。"
          : "尚未保存令牌，公开接口可留空。";
      }
      return data;
    }
    $("#save-source").addEventListener("click", async () => {
      if (busy) return;
      setBusy(true);
      try {
        await request(sourcePath, {
          method: "PUT",
          body: {
            apiUrl: $("#source-url").value.trim(),
            docsUrl: $("#source-docs-url").value.trim(),
            authorization: $("#source-authorization").value.trim(),
            intervalMinutes: Number($("#source-interval").value),
            enabled: $("#source-enabled").checked,
          },
        });
        $("#source-authorization").value = "";
        await readSource(true);
      } catch (error) {
        $("#source-status").textContent = error.message;
      } finally {
        setBusy(false);
      }
    });
    $("#sync-source").addEventListener("click", async () => {
      if (busy) return;
      setBusy(true);
      try {
        await request(
          `/api/v1/knowledge/source/sync?project_id=${encodeURIComponent(projectId)}`,
          { method: "POST", body: {} },
        );
        let state = await readSource();
        while (state?.syncing && form.isConnected) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          state = await readSource();
        }
        await refreshKnowledge();
      } catch (error) {
        $("#source-status").textContent = error.message;
      } finally {
        setBusy(false);
      }
    });
    $("#refresh-knowledge").addEventListener("click", () => {
      void readSource().catch(() => {});
    });
    void readSource(true).catch((error) => {
      $("#source-status").textContent = error.message;
    });
    void refreshKnowledge().catch((error) => {
      $("#knowledge-status").textContent = error.message;
    });
  }
}

if (document.body.classList.contains("kc-console")) {
  let theme;
  try {
    theme = localStorage.getItem("theme");
  } catch {}
  const dark =
    theme === "dark" ||
    ((!theme || theme === "system") &&
      matchMedia("(prefers-color-scheme:dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  if (document.body.dataset.page === "ai")
    mountAIForm(document.getElementById("ai-form"));
  if (document.body.dataset.page === "login") {
    document
      .getElementById("login-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("login-submit");
        const message = document.getElementById("form-message");
        button.disabled = true;
        button.textContent = "正在登录…";
        message.textContent = "";
        try {
          const result = await request("/api/auth/login", {
            method: "POST",
            login: true,
            body: {
              username: document.getElementById("username").value.trim(),
              password: document.getElementById("password").value,
              next:
                new URLSearchParams(location.search).get("next") ||
                "/dashboard",
            },
          });
          document.getElementById("password").value = "";
          location.replace(result.redirect);
        } catch (error) {
          message.textContent = error.message;
          message.className = "kc-message error";
          button.disabled = false;
          button.textContent = "登录";
        }
      });
  }
}
