import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const styles: Record<Variant, string> = {
  primary: "bg-accent text-white active:opacity-90",
  secondary: "border border-line bg-paper-2 text-ink active:bg-line/50",
  ghost: "text-ink-2 hover:text-ink",
  danger: "border border-danger/40 text-danger active:bg-danger/10",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-card px-4 text-[14px] font-medium transition-colors disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
