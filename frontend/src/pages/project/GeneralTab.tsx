import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Button,
  Input,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Snippet,
  Switch,
  useDisclosure,
} from "@heroui/react";
import { RiDeleteBinLine, RiDownload2Line } from "@remixicon/react";
import { api } from "../../api";
import { useDirty } from "../../dirty";
import { notify, PanelCard, Section, SettingRow, successSwitch } from "../../components/ui";
import type { Welcome } from "../../types";
import {
  cleanTrigger,
  TriggerFields,
  useDraft,
  useOptionCards,
  useRefreshProject,
  type TabProps,
} from "./shared";

const field = "w-full sm:w-72";

export function GeneralTab({ project }: TabProps) {
  const navigate = useNavigate();
  const refresh = useRefreshProject(project.id);
  const options = useOptionCards(project.id);
  const [draft, setDraft, dirty, reset] = useDraft({
    enabled: project.enabled,
    name: project.name ?? "",
    websiteId: project.websiteId ?? "",
    botName: project.botName ?? "",
    botIcon: project.botIcon ?? "",
    telegramId: project.telegramId?.toString() ?? "",
    timer: project.timer?.toString() ?? "1800",
    options: project.options ?? { type: "none" },
  });
  useDirty(dirty);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useDisclosure();
  const set = (patch: Partial<typeof draft>) =>
    setDraft((value) => ({ ...value, ...patch }));

  const telegramInvalid =
    draft.telegramId !== "" && !/^-?\d+$/.test(draft.telegramId.trim());
  const timerInvalid = !/^[1-9]\d*$/.test(draft.timer.trim());

  const save = async () => {
    if (telegramInvalid || timerInvalid) return notify.error("请检查标红的字段");
    setSaving(true);
    try {
      await api.post("/api/v1/saveProjectGeneral", {
        id: project.id,
        enabled: draft.enabled,
        ...(draft.name.trim() && { name: draft.name.trim() }),
        ...(draft.websiteId.trim() && { websiteId: draft.websiteId.trim() }),
        ...(draft.botName.trim() && { botName: draft.botName.trim() }),
        ...(draft.botIcon.trim() && { botIcon: draft.botIcon.trim() }),
        ...(draft.telegramId.trim() && { telegramId: Number(draft.telegramId) }),
        timer: Number(draft.timer),
        options: cleanTrigger(draft.options),
      });
      await refresh();
      notify.success("基础设置已保存");
    } catch (error) {
      notify.error(error);
    } finally {
      setSaving(false);
    }
  };

  const exportProject = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/v1/exportProject?id=${project.id}`, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error((await response.json().catch(() => ({}))).message || "导出失败");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name || "project"}.crispai.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(error);
    } finally {
      setExporting(false);
    }
  };

  const deleteProject = async () => {
    setDeleting(true);
    try {
      await api.post("/api/v1/deleteProject", { project_id: project.id });
      reset();
      notify.success("项目已删除");
      navigate("/dashboard", { replace: true });
    } catch (error) {
      notify.error(error);
      setDeleting(false);
    }
  };

  return (
    <PanelCard
      title={
        <span className="flex items-center gap-3">
          <Avatar src={project.botIcon ?? undefined} name={project.name} radius="sm" size="md" />
          <span className="flex flex-col">
            <span>{project.name}</span>
            <span className="text-tiny font-normal text-default-400">{project.id}</span>
          </span>
        </span>
      }
      actions={
        <>
          {dirty && (
            <Button variant="light" onPress={reset} isDisabled={saving}>
              撤销修改
            </Button>
          )}
          <Button
            className="bg-foreground text-background"
            isDisabled={!dirty}
            isLoading={saving}
            onPress={save}
          >
            保存设置
          </Button>
        </>
      }
    >
      <SettingRow inline title="启用项目" description="配置完成后开启，项目才会处理 Crisp 消息">
        <Switch
          classNames={successSwitch}
          isSelected={draft.enabled}
          onValueChange={(enabled) => set({ enabled })}
          aria-label="启用项目"
        />
      </SettingRow>

      <Section title="站点与通知">
        <SettingRow title="项目名称" description="仅用于在仪表盘区分项目">
          <Input className={field} variant="bordered" value={draft.name} onValueChange={(name) => set({ name })} aria-label="项目名称" />
        </SettingRow>
        <SettingRow
          title="Crisp 网站 ID"
          description={
            <>
              在{" "}
              <Link href="https://app.crisp.chat/website/" isExternal showAnchorIcon size="sm" className="text-tiny">
                Crisp 后台
              </Link>{" "}
              的网站设置中获取
            </>
          }
        >
          <Input className={field} variant="bordered" value={draft.websiteId} onValueChange={(websiteId) => set({ websiteId })} aria-label="Crisp 网站 ID" />
        </SettingRow>
        <SettingRow title="Telegram 群 ID" description="把机器人拉进话题群并设为管理员，发送 /ping 获取群 ID">
          <Input
            className={field}
            variant="bordered"
            inputMode="numeric"
            placeholder="-100…"
            value={draft.telegramId}
            onValueChange={(telegramId) => set({ telegramId })}
            isInvalid={telegramInvalid}
            errorMessage="群 ID 只能是数字"
            aria-label="Telegram 群 ID"
          />
        </SettingRow>
      </Section>

      <Section title="回复身份">
        <SettingRow title="回复名称" description="访客看到的客服昵称，留空使用 Crisp 默认">
          <Input className={field} variant="bordered" value={draft.botName} onValueChange={(botName) => set({ botName })} aria-label="回复名称" />
        </SettingRow>
        <SettingRow title="回复头像" description="头像图片的 HTTPS 地址">
          <Input
            className={field}
            variant="bordered"
            type="url"
            placeholder="https://…"
            value={draft.botIcon}
            onValueChange={(botIcon) => set({ botIcon })}
            startContent={draft.botIcon ? <Avatar src={draft.botIcon} className="h-5 w-5 shrink-0" /> : null}
            aria-label="回复头像"
          />
        </SettingRow>
        <SettingRow title="人工接管后恢复自动回复" description="客服在 Telegram 回复后，经过这段时间再交还给自动回复">
          <Input
            className="w-full sm:w-40"
            variant="bordered"
            inputMode="numeric"
            value={draft.timer}
            onValueChange={(timer) => set({ timer })}
            isInvalid={timerInvalid}
            errorMessage="请输入正整数"
            endContent={<span className="text-small text-default-400">秒</span>}
            aria-label="恢复自动回复的秒数"
          />
        </SettingRow>
      </Section>

      <Section title="欢迎语">
        <SettingRow
          stacked
          title="访客打开聊天窗口时的动作"
          description="需要把下面的脚本放进 Crisp 的自定义脚本，并确保在 Crisp 之后加载"
        >
          <Snippet symbol="" variant="bordered" className="w-full" classNames={{ pre: "whitespace-pre-wrap break-all" }}>
            {`<script src="${location.origin}/intro.js"></script>`}
          </Snippet>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
            <TriggerFields
              value={draft.options}
              onChange={(value) => set({ options: value as Welcome })}
              options={options.data ?? []}
              types={["none", "text", "option"]}
            />
          </div>
        </SettingRow>
      </Section>

      <Section title="数据">
        <SettingRow title="导出项目" description="导出配置、选项卡片和知识库，可在其他实例导入">
          <Button
            variant="flat"
            isLoading={exporting}
            startContent={!exporting && <RiDownload2Line className="h-4 w-4" />}
            onPress={exportProject}
          >
            导出
          </Button>
        </SettingRow>
        <SettingRow title="删除项目" description="同时删除选项、知识库和会话记录，无法恢复">
          <Button color="danger" variant="flat" startContent={<RiDeleteBinLine className="h-4 w-4" />} onPress={confirmDelete.onOpen}>
            删除
          </Button>
        </SettingRow>
      </Section>

      <Modal isOpen={confirmDelete.isOpen} onOpenChange={confirmDelete.onOpenChange} backdrop="blur" isDismissable={!deleting}>
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>删除项目「{project.name}」？</ModalHeader>
              <ModalBody>
                <p className="text-small text-default-500">
                  项目的选项、知识库和会话记录会一并删除，无法恢复。需要保留请先导出。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" isDisabled={deleting} onPress={close}>
                  取消
                </Button>
                <Button color="danger" isLoading={deleting} onPress={deleteProject}>
                  确认删除
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </PanelCard>
  );
}
