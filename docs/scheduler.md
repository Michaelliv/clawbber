# Scheduler

Mercury includes a task scheduler for recurring automated prompts. Tasks run on cron schedules and execute in the context of a specific group.

## Silent Tasks

Tasks can be marked as **silent** to execute without posting results to the chat. This is useful for:

- **Maintenance tasks** — cleanup, archiving, or housekeeping
- **Health checks** — periodic monitoring without noise
- **Background updates** — knowledge base updates, data syncing

The task executes normally but no message is sent to the group.

```bash
# Create a silent task
mercury-ctl tasks create --cron "0 3 * * *" --prompt "Run nightly maintenance" --silent
```

## How It Works

```
TaskScheduler.start()
  │
  └─► Poll loop (every 5 seconds)
        │
        ├─► Query DB for due tasks (active=1, next_run_at <= now)
        │
        ├─► For each due task:
        │     ├─► Compute next run time from cron expression
        │     ├─► Update next_run_at in DB
        │     └─► Execute handler (sends prompt to group)
        │
        └─► Schedule next poll
```

Tasks are processed sequentially within a poll cycle. Each task runs as if the `createdBy` user sent the prompt.

## Creating Tasks

The agent creates tasks via `mercury-ctl`:

```bash
# Daily standup at 9am
mercury-ctl tasks create --cron "0 9 * * *" --prompt "Good morning! What's on the agenda today?"

# Weekly summary on Fridays at 5pm
mercury-ctl tasks create --cron "0 17 * * 5" --prompt "Generate a summary of this week's discussions."

# Every 6 hours
mercury-ctl tasks create --cron "0 */6 * * *" --prompt "Check for any pending items."

# Silent nightly cleanup (no chat output)
mercury-ctl tasks create --cron "0 3 * * *" --prompt "Clean up old temp files" --silent
```

## Managing Tasks

```bash
# List all tasks in the current group
mercury-ctl tasks list

# Pause a task (stops execution, keeps definition)
mercury-ctl tasks pause <id>

# Resume a paused task
mercury-ctl tasks resume <id>

# Delete a task permanently
mercury-ctl tasks delete <id>
```

## Cron Format

Standard 5-field cron expressions:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

Examples:

| Expression | Description |
|------------|-------------|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 */6 * * *` | Every 6 hours |
| `0 17 * * 5` | Fridays at 5:00 PM |
| `0 0 1 * *` | First day of each month at midnight |

Mercury uses [cron-parser](https://www.npmjs.com/package/cron-parser) for parsing.

## Task Execution

When a task fires:

1. The prompt is sent to the group as if from the task creator
2. Runs through the normal routing (trigger check bypassed for scheduled tasks)
3. Caller ID is the `createdBy` user
4. Permissions are checked against the creator's role at execution time

Tasks run with `system` caller privileges for the routing layer, but the prompt is attributed to the original creator.

## Storage

Tasks are stored in SQLite:

```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  silent INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_next ON tasks(active, next_run_at);
```

| Column | Description |
|--------|-------------|
| `silent` | If 1, task runs but doesn't post results to chat |

## Permissions

Task management requires specific permissions:

| Permission | Action |
|------------|--------|
| `tasks.list` | View scheduled tasks |
| `tasks.create` | Create new tasks |
| `tasks.pause` | Pause a task |
| `tasks.resume` | Resume a paused task |
| `tasks.delete` | Delete a task |

By default, only `admin` has these permissions. Grant to other roles:

```bash
mercury-ctl permissions set member prompt,tasks.list
mercury-ctl permissions set moderator prompt,tasks.list,tasks.pause,tasks.resume
```

## Lifecycle

```
mercury run
  │
  ├─► runtime.initialize()
  │
  ├─► scheduler.start(handler)
  │     └─► Poll loop begins
  │
  ├─► ... running ...
  │
  └─► SIGTERM/SIGINT
        └─► scheduler.stop()
              └─► Poll loop ends (graceful)
```

The scheduler stops cleanly on shutdown — no orphaned timers.

## API

### `TaskScheduler`

```typescript
const scheduler = new TaskScheduler(db, pollIntervalMs);

scheduler.start(handler);    // Begin polling
scheduler.stop();            // Stop polling
scheduler.computeNextRun(cron, from);  // Get next run time
```

### Handler Signature

```typescript
type TaskHandler = (task: {
  id: number;
  groupId: string;
  prompt: string;
  createdBy: string;
  silent: boolean;
}) => Promise<void>;
```

### Database Methods

```typescript
db.createTask(groupId, cron, prompt, nextRunAt, createdBy, silent);  // Returns task ID
db.listTasks(groupId?);      // List tasks (optionally filter by group)
db.getDueTasks(now);         // Get tasks ready to run
db.getTask(id);              // Get single task
db.setTaskActive(id, active); // Pause/resume
db.deleteTask(id, groupId);  // Delete task
db.updateTaskNextRun(id, nextRunAt);  // Update next execution time
```

## Error Handling

If a task handler fails:
- Error is logged
- Task is not retried in the same cycle
- `next_run_at` is already updated, so it will run again at the next scheduled time
- Other tasks in the cycle continue to execute
