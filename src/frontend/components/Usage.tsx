import type { ReactNode } from "react";

export function Usage({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-1 border border-border p-2.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
          {label}
        </span>
        <span className="font-medium tabular-nums">
          {value === null ? "-" : `${value.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-1.5 bg-muted">
        <div
          className="h-full bg-accent-brand transition-[width]"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {detail}
      </span>
    </div>
  );
}

export function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5 text-xs">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}
