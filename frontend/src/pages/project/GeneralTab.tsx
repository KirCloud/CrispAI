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
  Skeleton,
  Snippet,
  Switch,
  useDisclosure,
} from "@heroui/react";
import { RiDeleteBinLine, RiDownload2Line } from "@remixicon/react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, scoped } from "../../api";
import { useDirty } from "../../dirty";
import { notify, PanelCard, Section, SettingRow, successSwitch } from "../../components/ui";
import type { ChatwootBinding, Welcome } from "../../types";
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
  const chatwoot = useQuery({
    queryKey: ["chatwoot", project.id],
    queryFn: () => api.get<ChatwootBinding>(scoped("/api/v1/chatwoot", project.id)),
  });
  if (chatwoot.isPending) return <Skeleton className="h-96 rounded-large" />;
  return <GeneralForm project={project} chatwoot={chatwoot} />;
}

function GeneralForm({ project, chatwoot }: TabProps & { chatwoot: UseQueryResult<ChatwootBinding> }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const refresh = useRefreshProject(project.id);
  const options = useOptionCards(project.id);
  const [draft, setDraft, generalDirty, resetGeneral] = useDraft({
    enabled: project.enabled,
    name: project.name ?? "",
    websiteId: project.websiteId ?? "",
    botName: project.botName ?? "",
    botIcon: project.botIcon ?? "",
    telegramId: project.telegramId?.toString() ?? "",
    timer: project.timer?.toString() ?? "1800",
    options: project.options ?? { type: "none" },
  });
  const [cw, setCw, chatwootDirty, resetChatwoot] = useDraft({
    enabled: chatwoot.data?.enabled ?? false,
    baseUrl: chatwoot.data?.baseUrl ?? "",
    inboxId: chatwoot.data?.inboxId?.toString() ?? "",
    botToken: "",
    webhookSecret: "",
  });
  const dirty = generalDirty || chatwootDirty;
  useDirty(dirty);
  const reset = () => {
    resetGeneral();
    resetChatwoot();
  };
  const chatwootPath = scoped("/api/v1/chatwoot", project.id);
  const setChatwoot = (patch: Partial<typeof cw>) => setCw((value) => ({ ...value, ...patch }));
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useDisclosure();
  const set = (patch: Partial<typeof draft>) =>
    setDraft((value) => ({ ...value, ...patch }));

  const telegramInvalid =
    draft.telegramId !== "" && !/^-?\d+$/.test(draft.telegramId.trim());
  const timerInvalid = !/^[1-9]\d*$/.test(draft.timer.trim());
  const inboxInvalid = cw.inboxId.trim() !== "" && !/^[1-9]\d*$/.test(cw.inboxId.trim());

  const save = async () => {
    if (telegramInvalid || timerInvalid || inboxInvalid) return notify.error("请检查标红的字段");
    setSaving(true);
    const failures: string[] = [];
    if (generalDirty) {
      try {
        await api.post("/api/v1/saveProjectGeneral", {
          id: project.id,
          enabled: draft.enabled,
          ...(draft.name.trim() && { name: draft.name.trim() }),
          websiteId: draft.websiteId.trim(),
          ...(draft.botName.trim() && { botName: draft.botName.trim() }),
          ...(draft.botIcon.trim() && { botIcon: draft.botIcon.trim() }),
          ...(draft.telegramId.trim() && { telegramId: Number(draft.telegramId) }),
          timer: Number(draft.timer),
          options: cleanTrigger(draft.options),
        });
        await refresh();
      } catch (error) {
        failures.push(`基础设置：${(error as Error).message}`);
      }
    }
    if (chatwootDirty) {
      try {
        const { botToken, webhookSecret, inboxId, ...rest } = cw;
        const { data } = await api.put<{ data: ChatwootBinding }>(chatwootPath, {
          ...rest,
          baseUrl: rest.baseUrl.trim(),
          inboxId: inboxId.trim() ? Number(inboxId) : null,
          ...(botToken.trim() && { botToken: botToken.trim() }),
          ...(webhookSecret.trim() && { webhookSecret: webhookSecret.trim() }),
        });
        client.setQueryData(["chatwoot", project.id], data);
        await client.invalidateQueries({ queryKey: ["projects"] });
      } catch (error) {
        failures.push(`Chatwoot：${(error as Error).message}`);
      }
    }
    setSaving(false);
    if (failures.length) failures.forEach((failure) => notify.error(failure));
    else notify.success("基础设置已保存");
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
      <SettingRow inline title="启用项目" description="配置完成后开启，项目才会处理 Crisp 和 Chatwoot 消息">
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
              的网站设置中获取；不接 Crisp 就留空
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

      <Section
        title="Chatwoot"
        description="在 Chatwoot「设置 → 机器人」新建机器人，Webhook 地址填下面这个，再到收件箱的「机器人配置」里选中它"
      >
        <SettingRow inline title="接入 Chatwoot" description="与 Crisp 共用本项目的提示词、关键词、选项卡片和知识库">
          <Switch
            classNames={successSwitch}
            isSelected={cw.enabled}
            isDisabled={!chatwoot.isSuccess}
            onValueChange={(enabled) => setChatwoot({ enabled })}
            aria-label="接入 Chatwoot"
          />
        </SettingRow>
        {chatwoot.data?.webhookUrl && (
          <SettingRow stacked title="Webhook 地址" description="填到 Chatwoot 机器人的 Webhook URL；请求带签名，必须是 Chatwoot 能访问到的公网 HTTPS 地址">
            <Snippet symbol="" variant="bordered" className="w-full" classNames={{ pre: "whitespace-pre-wrap break-all" }}>
              {chatwoot.data.webhookUrl}
            </Snippet>
          </SettingRow>
        )}
        {(cw.enabled || chatwoot.data?.baseUrl) && (
          <div className="grid gap-3 rounded-medium bg-content2 p-4 sm:grid-cols-2">
            <Input
              label="Chatwoot 地址"
              labelPlacement="outside"
              placeholder="https://chat.example.com"
              variant="bordered"
              type="url"
              value={cw.baseUrl}
              onValueChange={(baseUrl) => setChatwoot({ baseUrl })}
            />
            <Input
              label="收件箱 ID"
              labelPlacement="outside"
              placeholder="留空处理机器人连接的所有收件箱"
              variant="bordered"
              inputMode="numeric"
              value={cw.inboxId}
              onValueChange={(inboxId) => setChatwoot({ inboxId })}
              isInvalid={inboxInvalid}
              errorMessage="收件箱 ID 只能是正整数"
            />
            <Input
              label="机器人访问令牌"
              labelPlacement="outside"
              placeholder={chatwoot.data?.hasBotToken ? "已保存，留空不修改" : "机器人详情里的 Access Token"}
              variant="bordered"
              type="password"
              autoComplete="off"
              value={cw.botToken}
              onValueChange={(botToken) => setChatwoot({ botToken })}
            />
            <Input
              label="Webhook 密钥"
              labelPlacement="outside"
              placeholder={chatwoot.data?.hasWebhookSecret ? "已保存，留空不修改" : "机器人详情里的 Webhook Secret"}
              description="只保存在服务器；更换 Chatwoot 地址时需重新填写令牌和密钥"
              variant="bordered"
              type="password"
              autoComplete="off"
              value={cw.webhookSecret}
              onValueChange={(webhookSecret) => setChatwoot({ webhookSecret })}
            />
          </div>
        )}
      </Section>

      <Section title="回复身份">
        <SettingRow title="回复名称" description="访客看到的客服昵称，留空使用 Crisp 默认；Chatwoot 显示机器人自己的名称和头像">
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
          description="Crisp 需要把下面的脚本放进自定义脚本，并在 Crisp 之后加载；Chatwoot 不用脚本，但请关闭收件箱自带的问候语，免得发两遍"
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
