import type { Task } from "@/lib/types";

/** Minimal open task; override only what the assertion is about. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    user_id: "user-1",
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    domain_id: "domain-personal",
    project_id: null,
    person_id: null,
    title: "Do the thing",
    body_md: null,
    status: "open",
    priority: 0,
    due_date: null,
    due_time: null,
    scheduled_date: null,
    completed_at: null,
    dropped_reason: null,
    recurrence_rule: null,
    owner: "me",
    origin: "manual",
    origin_id: null,
    source_item_id: null,
    calendar_event_id: null,
    is_mirror: false,
    sort_order: 0,
    ...overrides,
  };
}
