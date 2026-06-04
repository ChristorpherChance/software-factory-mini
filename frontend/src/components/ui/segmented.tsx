"use client";

import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-md bg-bg-subtle p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs transition-colors",
            value === o.value
              ? "border border-border bg-bg-elevated font-semibold text-text"
              : "text-text-secondary hover:text-text"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
