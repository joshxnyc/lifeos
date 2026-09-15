// One line and one action, never an illustration (DESIGN_BRIEF §6).
export function EmptyState({ line, action }: { line: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <p className="font-display text-[17px] text-ink-2">{line}</p>
      {action}
    </div>
  );
}
