-- Dismissal reasons. Dismissing a suggestion stays one gesture; afterwards a
-- transient strip offers four one-tap reasons ("not a task", "done already",
-- "not mine", "wrong details"). The reason is optional — null means Joshua
-- didn't say — and the extraction sweep feeds recent reasons back to the model
-- so dismissals teach it where its bar is wrong.
alter table public.suggestions add column if not exists dismissed_reason text
  check (dismissed_reason in ('not_a_task', 'already_done', 'not_mine', 'wrong_details', 'other'));
