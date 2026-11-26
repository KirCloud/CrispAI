import { useState } from "react";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Chip,
  Input,
  Radio,
  RadioGroup,
  Skeleton,
} from "@heroui/react";
import { RiRefreshLine } from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useDirty } from "../dirty";
import { notify, PanelCard, Section } from "../components/ui";
import type { AIConfig, KnowledgeMode, Model } from "../types";
import { useDraft } from "./project/shared";
import { PageHeader } from "./Dashboard";

const field = "rounded-medium bg-content2 p-4";

function ModelPicker({
  label,
  value,
  onChange,
  models,
  loading,
  onLoad,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  models: Model[];
  loading: boolean;
  onLoad: () => void;
  description: string;
}) {
  const items = models.some((model) => model.id === value) || !value ? models : [{ id: value, name: value }, ...models];
  return (
    <div className="flex items-end gap-2">
      <Autocomplete
        className="flex-1"
        label={label}
        labelPlacement="outside"
        placeholder="读取列表后选择，或直接输入模型名"
        description={description}
        variant="bordered"
        allowsCustomValue
        defaultItems={items}
        inputValue={value}
        onInputChange={onChange}
        onSelectionChange={(key) => key && onChange(String(key))}
      >
        {(model) => (
          <AutocompleteItem key={model.id} textValue={model.id}>
            {model.name === model.id ? model.id : `${model.name} (${model.id})`}
          </AutocompleteItem>
        )}
      </Autocomplete>
      <Button variant="flat" className="mb-6" isLoading={loading} startContent={!loading && <RiRefreshLine className="h-4 w-4" />} onPress={onLoad}>
        读取列表
      </Button>
    </div>
  );
}

function SettingsForm({ config }: { config: AIConfig }) {
  const client = useQueryClient();
  const [draft, setDraft, dirty, reset] = useDraft({
    baseUrl: config.baseUrl ?? "",
    apiKey: "",
    model: config.model ?? "",
    knowledgeMode: config.knowledgeMode,
    knowledgeMaxChars: String(config.knowledgeMaxChars),
    embeddingBaseUrl: config.embeddingBaseUrl ?? "",
    embeddingApiKey: "",
    embeddingModel: config.embeddingModel ?? "",
  });
  useDirty(dirty);
  const set = (patch: Partial<typeof draft>) => setDraft((value) => ({ ...value, ...patch }));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<{ chat: Model[]; embedding: Model[] }>({ chat: [], embedding: [] });
  const [loadingModels, setLoadingModels] = useState<"chat" | "embedding">();
  const vector = draft.knowledgeMode === "vector";
  const maxChars = Number(draft.knowledgeMaxChars);
  const maxCharsInvalid = !Number.isInteger(maxChars) || maxChars < 2000 || maxChars > 64000;

  const body = () => ({
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    knowledgeMode: draft.knowledgeMode,
    knowledgeMaxChars: maxChars,
    embeddingModel: vector ? draft.embeddingModel.trim() : config.embeddingModel ?? "",
    embeddingBaseUrl: draft.embeddingBaseUrl.trim(),
    ...(draft.apiKey.trim() && { apiKey: draft.apiKey.trim() }),
    ...(draft.embeddingApiKey.trim() && { embeddingApiKey: draft.embeddingApiKey.trim() }),
  });

  const loadModels = async (target: "chat" | "embedding") => {
    setLoadingModels(target);
    try {
      const { baseUrl, apiKey, embeddingBaseUrl, embeddingApiKey } = body();
      const { data } = await api.post<{ data: Model[] }>("/api/v1/settings/ai/models", {
        target,
        baseUrl,
        ...(apiKey && { apiKey }),
        ...(embeddingBaseUrl && { embeddingBaseUrl }),
        ...(embeddingApiKey && { embeddingApiKey }),
      });
      setModels((value) => ({ ...value, [target]: data }));
      notify.success(`读取到 ${data.length} 个模型`);
    } catch (error) {
      notify.error(error);
    } finally {
      setLoadingModels(undefined);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await api.post<{ message: string; latencyMs: number }>("/api/v1/settings/ai/test", {
        ...body(),
        testEmbedding: vector,
      });
      notify.success(`${result.message}，耗时 ${(result.latencyMs / 1000).toFixed(1)} 秒`);
    } catch (error) {
      notify.error(error);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (maxCharsInvalid) return notify.error("资料长度上限需在 2000～64000 之间");
    setSaving(true);
    try {
      const { data, message } = await api.put<{ data: AIConfig; message: string }>("/api/v1/settings/ai", body());
      client.setQueryData(["ai-settings"], data);
      notify.success(message);
    } catch (error) {
      notify.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title={
        <span className="flex items-center gap-2">
          接口与模型
          <Chip size="sm" variant="flat" color={config.configured ? "success" : "warning"}>
            {config.configured ? "已配置" : "未配置"}
          </Chip>
          {config.source === "environment" && (
            <Chip size="sm" variant="flat">
              来自环境变量
            </Chip>
          )}
        </span>
      }
      description="保存后立即生效；测试会发送一次简短请求，可能产生少量费用"
      actions={
        <>
          {dirty && (
            <Button variant="light" onPress={reset} isDisabled={saving}>
              撤销修改
            </Button>
          )}
          <Button variant="flat" isLoading={testing} onPress={test}>
            测试连接
          </Button>
          <Button className="bg-foreground text-background" isDisabled={!dirty} isLoading={saving} onPress={save}>
            保存设置
          </Button>
        </>
      }
    >
      <Section title="对话模型" description="任何 OpenAI 兼容接口，例如 DeepSeek：https://api.deepseek.com">
        <div className={`${field} grid gap-4 sm:grid-cols-2`}>
          <Input label="API 地址" labelPlacement="outside" placeholder="https://api.example.com/v1" variant="bordered" type="url" value={draft.baseUrl} onValueChange={(baseUrl) => set({ baseUrl })} />
          <Input
            label="API 密钥"
            labelPlacement="outside"
            placeholder={config.hasApiKey ? "已保存，留空不修改" : "sk-…"}
            variant="bordered"
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            onValueChange={(apiKey) => set({ apiKey })}
          />
          <div className="sm:col-span-2">
            <ModelPicker
              label="模型"
              value={draft.model}
              onChange={(model) => set({ model })}
              models={models.chat}
              loading={loadingModels === "chat"}
              onLoad={() => loadModels("chat")}
              description="开启网站实时查询时，模型需要支持工具调用"
            />
          </div>
        </div>
      </Section>

      <Section title="知识库检索" description="所有项目共用的检索方式">
        <div className={`${field} flex flex-col gap-4`}>
          <RadioGroup
            aria-label="知识库模式"
            value={draft.knowledgeMode}
            onValueChange={(knowledgeMode) => set({ knowledgeMode: knowledgeMode as KnowledgeMode })}
            classNames={{ wrapper: "gap-3" }}
          >
            <Radio value="full" description="把资料原文直接交给模型，无需向量接口，适合几十篇以内的资料">
              全文模式
            </Radio>
            <Radio value="vector" description="先用 Embeddings 检索最相关的 3 条，适合大量资料；需要 1536 维向量模型">
              向量检索
            </Radio>
            <Radio value="off" description="只用提示词和聊天记录回答">
              不使用知识库
            </Radio>
          </RadioGroup>
          {draft.knowledgeMode !== "off" && (
            <Input
              className="sm:w-64"
              label="每次引用的资料上限"
              labelPlacement="outside"
              variant="bordered"
              inputMode="numeric"
              value={draft.knowledgeMaxChars}
              onValueChange={(knowledgeMaxChars) => set({ knowledgeMaxChars })}
              isInvalid={maxCharsInvalid}
              errorMessage="2000～64000"
              description="超出部分会被省略；越长 Token 用量越高"
              endContent={<span className="whitespace-nowrap text-small text-default-400">字符</span>}
            />
          )}
        </div>
      </Section>

      {vector && (
        <Section title="向量模型" description="可使用另一家服务商；不同服务商不会共用对话密钥">
          <div className={`${field} grid gap-4 sm:grid-cols-2`}>
            <Input label="向量 API 地址" labelPlacement="outside" placeholder="留空使用对话接口" variant="bordered" type="url" value={draft.embeddingBaseUrl} onValueChange={(embeddingBaseUrl) => set({ embeddingBaseUrl })} />
            <Input
              label="向量 API 密钥"
              labelPlacement="outside"
              placeholder={config.hasEmbeddingApiKey ? "已保存，留空不修改" : "同一接口可留空"}
              variant="bordered"
              type="password"
              autoComplete="off"
              value={draft.embeddingApiKey}
              onValueChange={(embeddingApiKey) => set({ embeddingApiKey })}
            />
            <div className="sm:col-span-2">
              <ModelPicker
                label="向量模型"
                value={draft.embeddingModel}
                onChange={(embeddingModel) => set({ embeddingModel })}
                models={models.embedding}
                loading={loadingModels === "embedding"}
                onLoad={() => loadModels("embedding")}
                description="更换后需要在各项目的知识库里重新生成索引"
              />
            </div>
          </div>
        </Section>
      )}
    </PanelCard>
  );
}

export function ModelSettingsPage() {
  const config = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => api.get<AIConfig>("/api/v1/settings/ai"),
  });
  return (
    <>
      <PageHeader title="模型服务" description="所有项目共用的对话接口和知识库检索方式；各项目的回复开关在「智能回复」里" />
      {config.data ? (
        <SettingsForm config={config.data} />
      ) : config.isError ? (
        <p className="py-20 text-center text-default-400">{(config.error as Error).message}</p>
      ) : (
        <Skeleton className="h-96 rounded-large" />
      )}
    </>
  );
}
