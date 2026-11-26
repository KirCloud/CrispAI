import type { ReactNode } from "react";
import { addToast, Card, CardBody, CardHeader, cn } from "@heroui/react";

export const notify = {
  success: (title: string) => addToast({ title, color: "success" }),
  error: (error: unknown) =>
    addToast({
      title: error instanceof Error ? error.message : String(error),
      color: "danger",
    }),
  warning: (title: string) => addToast({ title, color: "warning" }),
};

export function PanelCard({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-2" radius="md" shadow="sm">
      <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-medium font-medium">{title}</p>
          {description && (
            <p className="text-small text-default-400">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">{children}</CardBody>
    </Card>
  );
}

export function SettingRow({
  title,
  description,
  children,
  stacked = false,
  inline = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full gap-3 rounded-medium bg-content2 p-4",
        stacked
          ? "flex-col"
          : inline
            ? "flex-row items-center justify-between"
            : "flex-col items-start sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-medium">{title}</p>
        {description && (
          <p className="text-tiny text-default-400">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  aside,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3 px-1 pt-2">
        <div>
          <h3 className="text-small font-semibold text-default-700">{title}</h3>
          {description && (
            <p className="text-tiny text-default-400">{description}</p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const successSwitch = {
  wrapper:
    "group-data-[selected=true]:bg-success dark:group-data-[selected=true]:bg-success",
};
