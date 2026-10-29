// Kept independent from model discovery: a slow /models call must not block
// loading, saving or testing this project's website configuration.
export function mountSiteAPI(section, projectId, request, onDirty = () => {}) {
  const $ = (id) => section.querySelector("#" + id);
  const path = `/api/v1/site-api?project_id=${encodeURIComponent(projectId)}`;
  const status = $("site-api-status");
  const save = $("save-site-api"),
    test = $("test-site-api"),
    reload = $("reload-site-api");
  let loaded = false,
    busy = false,
    dirty = false;
  const setBusy = (value) => {
    busy = value;
    section.querySelectorAll("input,button").forEach((control) => {
      control.disabled = value || (!loaded && control !== reload);
    });
    save.textContent = value ? "处理中…" : "保存网站查询";
    test.textContent = value ? "处理中…" : "测试已保存接口";
  };
  function fill(data) {
    $("site-api-base").value = data?.apiBaseUrl || "";
    $("site-api-url").value = data?.siteUrl || "";
    $("site-api-enabled").checked = Boolean(data?.enabled);
    $("site-api-token").value = "";
    $("site-api-token").placeholder = data?.hasAuthorization
      ? "令牌已保存，留空保留；不会回显"
      : "填写普通专用账号的 Authorization 令牌";
    $("site-api-token-state").textContent = data?.hasAuthorization
      ? "令牌已保存在服务器。刷新后输入框留空属于正常现象，无需重复填写；不会发送给模型。更换 API 地址时需重新填写。"
      : "尚未保存令牌。请填写普通专用账号令牌，不要使用管理员令牌。";
    dirty = false;
    onDirty(false);
    return data
      ? `${data.enabled ? "实时查询已开启" : "实时查询已关闭"} · ${data.hasAuthorization ? "令牌已保存" : "尚未保存令牌"}`
      : "尚未配置，请填写后保存";
  }
  async function read() {
    if (busy) return;
    setBusy(true);
    status.textContent = "正在读取服务器已保存的配置…";
    try {
      const { data } = await request(path);
      loaded = true;
      status.textContent = fill(data);
    } catch (error) {
      status.textContent = `配置读取失败：${error.message}。请点击“重新读取”，避免覆盖服务器配置。`;
    } finally {
      setBusy(false);
    }
  }
  section.addEventListener("input", () => {
    if (!loaded || busy) return;
    dirty = true;
    onDirty(true);
    status.textContent = "网站查询有未保存的修改，请点击“保存网站查询”。";
  });
  save.addEventListener("click", async () => {
    if (!loaded || busy) return;
    if (
      !["site-api-base", "site-api-url"].every(
        (id) => $(id).value.trim() && $(id).reportValidity(),
      )
    ) {
      status.textContent = "请填写有效的网站 API 地址和官网地址。";
      return;
    }
    setBusy(true);
    status.textContent = "正在保存到服务器…";
    try {
      const { data } = await request(path, {
        method: "PUT",
        body: {
          apiBaseUrl: $("site-api-base").value.trim(),
          siteUrl: $("site-api-url").value.trim(),
          authorization: $("site-api-token").value.trim(),
          enabled: $("site-api-enabled").checked,
        },
      });
      status.textContent = `保存成功 · ${fill(data)}，刷新后会重新读取。`;
    } catch (error) {
      status.textContent = `保存失败：${error.message}。输入内容已保留，请重试或重新读取确认。`;
    } finally {
      setBusy(false);
    }
  });
  test.addEventListener("click", async () => {
    if (!loaded || busy) return;
    if (dirty) {
      status.textContent = "有未保存的修改，请先保存网站查询，再测试。";
      return;
    }
    setBusy(true);
    status.textContent = "正在测试服务器已保存的接口，通常需要数秒…";
    try {
      const result = await request(
        `/api/v1/site-api/test?project_id=${encodeURIComponent(projectId)}`,
        { method: "POST", body: {} },
      );
      const labels = {
        plans: "套餐",
        notices: "公告",
        payments: "支付方式",
        site_config: "站点设置",
      };
      status.textContent =
        result.message +
        (result.data
          ? " · " +
            result.data
              .map(
                (r) =>
                  `${labels[r.topic] || r.topic}：${r.ok ? "通过" : "失败"}`,
              )
              .join(" / ")
          : "");
    } catch (error) {
      status.textContent = `测试失败：${error.message}`;
    } finally {
      setBusy(false);
    }
  });
  reload.addEventListener("click", () => {
    if (dirty) {
      status.textContent = "请先保存修改；刷新页面会放弃未保存的输入。";
      return;
    }
    void read();
  });
  return read();
}
