import { useState } from "react";
import { Alert, Button, Chip, Input, Link, Skeleton, Switch, Textarea } from "@heroui/react";
import { RiCheckLine, RiCloseLine } from "@remixicon/react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, scoped } from "../../api";
import { useDirty } from "../../dirty";
import { notify, PanelCard, Section, SettingRow, successSwitch } from "../../components/ui";
import type { AIConfig, SiteAPI } from "../../types";
import { useDraft, useRefreshProject, type TabProps } from "./shared";

const PROMPT_LIMIT = 5000;

function promptText(payload: string | null) {
  try {
    const parsed = JSON.parse(payload ?? "");
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed.join("\n\n");
  } catch {}
  return payload ?? "";
}

const topicLabels: Record<string, string> = {
  plans: "套餐",
  notices: "公告",
  payments: "支付方式",
  site_config: "站点设置",
};

type TestResult = { topic: string; ok: boolean }[];

export function AITab({ project }: TabProps) {
  const abuse = useQuery({
    queryKey: ["abuse", project.id],
    queryFn: () => api.get<{ enabled: boolean }>(scoped("/api/v1/settings/abuse", project.id)),
  });
  const site = useQuery({
    queryKey: ["site-api", project.id],
    queryFn: () => api.get<SiteAPI | null>(scoped("/api/v1/site-api", project.id)),
  });
  if (abuse.isPending || site.isPending) return <Skeleton className="h-96 rounded-large" />;
  return <AIForm project={project} abuse={abuse} site={site} />;
}

function AIForm({
  project,
  abuse,
  site,
}: TabProps & {
  abuse: UseQueryResult<{ enabled: boolean }>;
  site: UseQueryResult<SiteAPI | null>;
}) {
  const client = useQueryClient();
  const refresh = useRefreshProject(project.id);
  const model = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => api.get<AIConfig>("/api/v1/settings/ai"),
  });
  const abusePath = scoped("/api/v1/settings/abuse", project.id);
  const sitePath = scoped("/api/v1/site-api", project.id);

  const [reply, setReply, replyDirty, resetReply] = useDraft({
    enable: project.enableAI,
    enablePic: project.enableAIPic,
    prompt: promptText(project.payload),
  });
  const [guard, setGuard, guardDirty, resetGuard] = useDraft({
    enabled: abuse.data?.enabled ?? false,
  });
  const [tool, setTool, toolDirty, resetTool] = useDraft({
    enabled: site.data?.enabled ?? false,
    apiBaseUrl: site.data?.apiBaseUrl ?? "",
    siteUrl: site.data?.siteUrl ?? "",
    authorization: "",
  });
  const dirty = replyDirty || guardDirty || toolDirty;
  useDirty(dirty);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<TestResult>();

  const reset = () => {
    resetReply();
    resetGuard();
    resetTool();
  };

  const save = async () => {
    if (reply.prompt.length > PROMPT_LIMIT) return notify.error(`提示词最多 ${PROMPT_LIMIT} 字`);
    setSaving(true);
    const failures: string[] = [];
    if (replyDirty) {
      try {
        await api.post("/api/v1/saveProjectAI", {
          project_id: project.id,
          enable: reply.enable,
          enablePic: reply.enablePic,
          data: reply.prompt,
        });
        await refresh();
      } catch (error) {
        failures.push(`回复设置：${(error as Error).message}`);
      }
    }
    if (guardDirty) {
      try {
        const { data } = await api.put<{ data: { enabled: boolean } }>(abusePath, guard);
        client.setQueryData(["abuse", project.id], data);
      } catch (error) {
        failures.push(`辱骂防护：${(error as Error).message}`);
      }
    }
    if (toolDirty) {
      try {
        const { authorization, ...rest } = tool;
        const { data } = await api.put<{ data: SiteAPI }>(sitePath, {
          ...rest,
          ...(authorization.trim() && { authorization: authorization.trim() }),
        });
        client.setQueryData(["site-api", project.id], data);
        setTested(undefined);
      } catch (error) {
        failures.push(`网站实时查询：${(error as Error).message}`);
      }
    }
    setSaving(false);
    if (failures.length) failures.forEach((failure) => notify.error(failure));
    else notify.success("智能回复已保存");
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await api.post<{ data: TestResult; message: string }>(
        scoped("/api/v1/site-api/test", project.id),
        {},
      );
      setTested(result.data);
      (result.data.every((item) => item.ok) ? notify.success : notify.warning)(result.message);
    } catch (error) {
      notify.error(error);
    } finally {
      setTesting(false);
    }
  };

  const tooLong = reply.prompt.length > PROMPT_LIMIT;

  return (
    <PanelCard
      title="智能回复"
      description="关键词没有命中时，由模型结合提示词和知识库回答"
      actions={
        <>
          {dirty && (
            <Button variant="light" onPress={reset} isDisabled={saving}>
              撤销修改
            </Button>
          )}
          <Button className="bg-foreground text-background" isDisabled={!dirty} isLoading={saving} onPress={save}>
            保存设置
          </Button>
        </>
      }
    >
      {model.data && !model.data.configured && (
        <Alert
          color="warning"
          title="模型服务还没有配置"
          description="开启 AI 回复前，先填写对话接口和模型。"
          endContent={
            <Button as={Link} href="/settings/ai" size="sm" color="warning" variant="flat">
              去配置
            </Button>
          }
        />
      )}

      <Section
        title="回复行为"
        aside={
          model.data?.configured && (
            <Link href="/settings/ai" size="sm" className="text-tiny">
              模型：{model.data.model}
            </Link>
          )
        }
      >
        <SettingRow inline title="启用 AI 回复" description="每次回复都会调用对话模型">
          <Switch classNames={successSwitch} isSelected={reply.enable} onValueChange={(enable) => setReply((value) => ({ ...value, enable }))} aria-label="启用 AI 回复" />
        </SettingRow>
        <SettingRow inline title="识别图片" description="访客发图时交给模型识别，需要模型支持视觉输入，费用更高">
          <Switch classNames={successSwitch} isSelected={reply.enablePic} onValueChange={(enablePic) => setReply((value) => ({ ...value, enablePic }))} aria-label="识别图片" />
        </SettingRow>
        <SettingRow inline
          title="辱骂防护"
          description="针对客服的辱骂或威胁会收到警告，第三次后 AI 对该访客静默 1 小时；人工仍可接待"
        >
          <Switch
            classNames={successSwitch}
            isSelected={guard.enabled}
            isDisabled={!abuse.isSuccess}
            onValueChange={(enabled) => setGuard({ enabled })}
            aria-label="辱骂防护"
          />
        </SettingRow>
      </Section>

      <Section
        title="提示词"
        description="告诉模型它是谁、能回答什么、遇到问题如何转人工"
        aside={
          <Chip size="sm" variant="flat" color={tooLong ? "danger" : "default"}>
            {reply.prompt.length} / {PROMPT_LIMIT}
          </Chip>
        }
      >
        <Textarea
          variant="bordered"
          minRows={6}
          maxRows={24}
          placeholder="例如：你是 XX 的客服助手，只根据知识库回答，不确定时请访客等待人工客服。"
          value={reply.prompt}
          onValueChange={(prompt) => setReply((value) => ({ ...value, prompt }))}
          isInvalid={tooLong}
          errorMessage={tooLong && `最多 ${PROMPT_LIMIT} 字`}
          aria-label="提示词"
        />
      </Section>

      <Section title="网站实时查询" description="模型按需读取 V2Board 的套餐、公告、支付方式和站点设置；只读，不访问用户订单与订阅">
        <SettingRow inline title="启用实时查询" description="需要对话模型支持工具调用">
          <Switch
            classNames={successSwitch}
            isSelected={tool.enabled}
            isDisabled={!site.isSuccess}
            onValueChange={(enabled) => setTool((value) => ({ ...value, enabled }))}
            aria-label="启用实时查询"
          />
        </SettingRow>
        {(tool.enabled || site.data) && (
          <div className="grid gap-3 rounded-medium bg-content2 p-4 sm:grid-cols-2">
            <Input
              label="网站 API 地址"
              labelPlacement="outside"
              placeholder="https://api.example.com/api/v1"
              variant="bordered"
              type="url"
              value={tool.apiBaseUrl}
              onValueChange={(apiBaseUrl) => setTool((value) => ({ ...value, apiBaseUrl }))}
            />
            <Input
              label="官网地址"
              labelPlacement="outside"
              placeholder="https://example.com"
              variant="bordered"
              type="url"
              value={tool.siteUrl}
              onValueChange={(siteUrl) => setTool((value) => ({ ...value, siteUrl }))}
            />
            <Input
              className="sm:col-span-2"
              label="Authorization 令牌"
              labelPlacement="outside"
              placeholder={site.data?.hasAuthorization ? "已保存，留空不修改" : "专用普通账号的令牌"}
              description="只保存在服务器。请用普通账号，不要用管理员令牌；更换 API 地址需重新填写。"
              variant="bordered"
              type="password"
              autoComplete="off"
              value={tool.authorization}
              onValueChange={(authorization) => setTool((value) => ({ ...value, authorization }))}
            />
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button size="sm" variant="flat" isLoading={testing} isDisabled={toolDirty || !site.data?.enabled} onPress={test}>
                测试已保存的接口
              </Button>
              {toolDirty && <span className="text-tiny text-default-400">保存后再测试</span>}
              {tested?.map((item) => (
                <Chip
                  key={item.topic}
                  size="sm"
                  variant="flat"
                  color={item.ok ? "success" : "danger"}
                  startContent={item.ok ? <RiCheckLine className="h-3 w-3" /> : <RiCloseLine className="h-3 w-3" />}
                >
                  {topicLabels[item.topic] ?? item.topic}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </Section>
    </PanelCard>
  );
}
