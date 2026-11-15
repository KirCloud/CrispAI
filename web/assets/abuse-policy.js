export async function mountAbusePolicy(section, projectId, request, onDirty) {
  const enabled = section.querySelector("input"),
    button = section.querySelector("button"),
    status = section.querySelector('[role="status"]');
  const path = `/api/v1/settings/abuse?project_id=${encodeURIComponent(projectId)}`;
  let loaded = false,
    busy = false;
  function controls() {
    enabled.disabled = busy || !loaded;
    button.disabled = busy;
  }
  async function read() {
    busy = true;
    controls();
    status.textContent = "正在读取警告设置…";
    try {
      const { data } = await request(path);
      enabled.checked = data.enabled;
      loaded = true;
      button.textContent = "保存警告设置";
      status.textContent = data.enabled
        ? "已开启：累计第三次警告后静默冷却 1 小时。"
        : "尚未开启辱骂警告。";
      onDirty(false);
    } catch (error) {
      button.textContent = "重新读取";
      status.textContent = `读取失败：${error.message}`;
    } finally {
      busy = false;
      controls();
    }
  }
  enabled.addEventListener("change", () => {
    onDirty(true);
    status.textContent = "有未保存的修改。";
  });
  button.addEventListener("click", async () => {
    if (busy) return;
    if (!loaded) return read();
    busy = true;
    controls();
    status.textContent = "正在保存…";
    try {
      const { data } = await request(path, {
        method: "PUT",
        body: { enabled: enabled.checked },
      });
      enabled.checked = data.enabled;
      status.textContent = data.enabled
        ? "已保存并开启，累计第三次警告后静默冷却 1 小时。"
        : "已保存并关闭；已有冷却保留到到期或人工解除。";
      onDirty(false);
    } catch (error) {
      status.textContent = `保存失败：${error.message}`;
    } finally {
      busy = false;
      controls();
    }
  });
  return read();
}
