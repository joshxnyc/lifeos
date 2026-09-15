export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-3 pt-6">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? <div className="mt-0.5 text-[13px] text-ink-2">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
