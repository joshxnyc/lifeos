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
    <header className="mb-6 flex items-baseline justify-between gap-3 pt-6">
      <div className="min-w-0">
        <h1 className="display-title">{title}</h1>
        {subtitle ? <div className="mt-1 text-[13px] text-ink-2">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  );
}
