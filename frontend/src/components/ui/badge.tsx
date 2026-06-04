import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-bg text-text-secondary border border-border",
        primary: "bg-primary-subtle text-primary",
        success: "bg-success-subtle text-success border border-success/40",
        warning: "bg-warning-subtle text-warning border border-warning/40",
        error: "bg-error-subtle text-error border border-error/40",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

/** Three-tier badge by score thresholds (context / healthScore / cost). */
export function tierToTone(tier: "green" | "yellow" | "red") {
  return tier === "green" ? "success" : tier === "yellow" ? "warning" : "error";
}
