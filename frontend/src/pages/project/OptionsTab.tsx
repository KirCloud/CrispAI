import { useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  useDisclosure,
} from "@heroui/react";
import { RiAddLine, RiDeleteBin2Line, RiEdit2Line } from "@remixicon/react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { notify, PanelCard } from "../../components/ui";
import type { OptionCard } from "../../types";
import { cleanTrigger, formatTime, TriggerFields, useOptionCards, type TabProps } from "./shared";

const MAX_CHOICES = 10;
const blank = (): OptionCard => ({ name: "", text: "", options: [{ label: "", trigger: { type: "none" } }] });

function OptionEditor({
  projectId,
  initial,
  cards,
  isOpen,
  onOpenChange,
}: {
  projectId: string;
  initial: OptionCard;
  cards: OptionCard[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [card, setCard] = useState(initial);
  const [opened, setOpened] = useState<OptionCard | null>(null);
  const [saving, setSaving] = useState(false);
  if (isOpen && opened !== initial) {
    setOpened(initial);
    setCard(structuredClone(initial));
  }
  if (!isOpen && opened) setOpened(null);
  const setChoice = (index: number, patch: Partial<OptionCard["options"][number]>) =>
    setCard((value) => ({
      ...value,
      options: value.options.map((choice, position) => (position === index ? { ...choice, ...patch } : choice)),
    }));

  const save = async (close: () => void) => {
    if (!card.name.trim() || !card.text.trim()) return notify.error("请填写卡片名称和展示文字");
    if (card.options.some((choice) => !choice.label.trim())) return notify.error("请填写每个选项的文字");
    if (card.options.some((choice) => choice.trigger.type === "text" && !choice.trigger.text?.trim()))
      return notify.error("有选项未填写回复文字");
    if (card.options.some((choice) => choice.trigger.type === "option" && !choice.trigger.optionId))
      return notify.error("有选项未选择要跳转的卡片");
    setSaving(true);
    try {
      await api.post("/api/v1/saveProjectOption", {
        project_id: projectId,
        params: {
          ...(card.id && { id: card.id }),
          name: card.name.trim(),
          text: card.text,
          options: card.options.map((choice) => ({ ...choice, trigger: cleanTrigger(choice.trigger) })),
        },
      });
      await client.invalidateQueries({ queryKey: ["options", projectId] });
      notify.success("选项卡片已保存");
      close();
    } catch (error) {
      notify.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside" backdrop="blur" isDismissable={!saving}>
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>{card.id ? "编辑选项卡片" : "创建选项卡片"}</ModalHeader>
            <ModalBody className="gap-4">
              <Input label="卡片名称" labelPlacement="outside" placeholder="仅后台可见，用于在关键词和欢迎语里选择" variant="bordered" isRequired value={card.name} onValueChange={(name) => setCard((value) => ({ ...value, name }))} />
              <Textarea label="展示文字" labelPlacement="outside" placeholder="访客看到的提问，例如：请问需要什么帮助？" variant="bordered" isRequired minRows={2} value={card.text} onValueChange={(text) => setCard((value) => ({ ...value, text }))} />
              {card.options.map((choice, index) => (
                <div key={choice.id ?? `new-${index}`} className="flex flex-col gap-3 rounded-medium bg-content2 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-small text-default-500">选项 {index + 1}</span>
                    <Button
                      isIconOnly
                      size="sm"
                      color="danger"
                      variant="light"
                      aria-label="删除选项"
                      isDisabled={card.options.length <= 1}
                      onPress={() => setCard((value) => ({ ...value, options: value.options.filter((_, position) => position !== index) }))}
                    >
                      <RiDeleteBin2Line className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input label="选项文字" placeholder="访客点击的按钮文字" variant="bordered" value={choice.label} onValueChange={(label) => setChoice(index, { label })} />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <TriggerFields
                      value={choice.trigger}
                      onChange={(trigger) => setChoice(index, { trigger })}
                      options={cards.filter((other) => other.id !== card.id)}
                    />
                  </div>
                </div>
              ))}
              <Button
                variant="flat"
                className="self-start"
                startContent={<RiAddLine className="h-4 w-4" />}
                isDisabled={card.options.length >= MAX_CHOICES}
                onPress={() => setCard((value) => ({ ...value, options: [...value.options, { label: "", trigger: { type: "none" } }] }))}
              >
                添加选项{card.options.length >= MAX_CHOICES && `（最多 ${MAX_CHOICES} 个）`}
              </Button>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={saving} onPress={close}>
                取消
              </Button>
              <Button className="bg-foreground text-background" isLoading={saving} onPress={() => save(close)}>
                保存
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export function OptionsTab({ project }: TabProps) {
  const client = useQueryClient();
  const cards = useOptionCards(project.id);
  const editor = useDisclosure();
  const [editing, setEditing] = useState<OptionCard>(blank);
  const [deleting, setDeleting] = useState<string>();
  const open = (card: OptionCard) => {
    setEditing(card);
    editor.onOpen();
  };
  const remove = async (card: OptionCard) => {
    if (!confirm(`删除卡片「${card.name}」？引用它的关键词和欢迎语将失效。`)) return;
    setDeleting(card.id);
    try {
      await api.post("/api/v1/deleteProjectOption", { option_id: card.id });
      await client.invalidateQueries({ queryKey: ["options", project.id] });
      notify.success("已删除");
    } catch (error) {
      notify.error(error);
    } finally {
      setDeleting(undefined);
    }
  };

  return (
    <PanelCard
      title="选项卡片"
      description="以按钮形式提供给访客选择，可用于欢迎语、关键词回复或相互跳转"
      actions={
        <Button className="bg-foreground text-background" startContent={<RiAddLine className="h-4 w-4" />} onPress={() => open(blank())}>
          创建卡片
        </Button>
      }
    >
      {cards.data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.data.map((card) => (
            <li key={card.id}>
              <Card shadow="none" className="h-full bg-content2">
                <CardHeader className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{card.name}</p>
                    <p className="text-tiny text-default-400">创建于 {formatTime(card.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button isIconOnly size="sm" variant="light" aria-label="编辑" onPress={() => open(card)}>
                      <RiEdit2Line className="h-4 w-4" />
                    </Button>
                    <Button isIconOnly size="sm" variant="light" color="danger" aria-label="删除" isLoading={deleting === card.id} onPress={() => remove(card)}>
                      <RiDeleteBin2Line className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardBody className="gap-2 pt-0">
                  <p className="line-clamp-2 text-small text-default-500">{card.text}</p>
                  <div className="flex flex-wrap gap-1">
                    {card.options.map((choice, index) => (
                      <Chip key={choice.id ?? index} size="sm" variant="bordered">
                        {choice.label}
                      </Chip>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-small text-default-400">
          {cards.isPending ? "正在读取…" : cards.isError ? (cards.error as Error).message : "还没有选项卡片"}
        </p>
      )}
      <OptionEditor projectId={project.id} initial={editing} cards={cards.data ?? []} isOpen={editor.isOpen} onOpenChange={editor.onOpenChange} />
    </PanelCard>
  );
}
