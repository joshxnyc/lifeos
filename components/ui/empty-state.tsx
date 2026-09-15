// One line and one action, never an illustration (DESIGN_BRIEF §6).
// Canvas 2c: the line is Fraunces 22px in ink, centred, with the single
// action below it.
export function EmptyState({ line, action }: { line: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      <p className="display-lead text-ink">{line}</p>
      {action}
    </div>
  );
}
