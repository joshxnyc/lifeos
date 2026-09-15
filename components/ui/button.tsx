import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

// Canvas: actions are 999px pills — accent fill on paper for the primary,
// a hairline outline for the secondary, plain accent text for the ghost.
const styles: Record<Variant, string> = {
  primary: "bg-accent text-paper active:opacity-90",
  secondary: "border border-line text-ink active:bg-line/50",
  ghost: "text-accent hover:opacity-80",
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
        "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
