-- Task duration estimates. Capture filing already computes a normalized
-- estimate (file-capture pipeline); it now lands in a real column so the
-- calendar block length can read it instead of parsing body_md.
alter table public.tasks add column if not exists duration_minutes integer
  check (duration_minutes between 1 and 1440);
