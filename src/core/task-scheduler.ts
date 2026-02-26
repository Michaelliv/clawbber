import { CronExpressionParser } from "cron-parser";
import { logger } from "../logger.js";
import type { Db } from "../storage/db.js";

type TaskHandler = (task: {
  id: number;
  groupId: string;
  prompt: string;
  createdBy: string;
}) => Promise<void>;

export class TaskScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly pollIntervalMs = 5_000,
  ) {}

  start(handler: TaskHandler) {
    if (this.timer) return;

    const tick = async () => {
      try {
        const due = this.db.getDueTasks(Date.now());
        for (const task of due) {
          const next = this.computeNextRun(task.cron);
          this.db.updateTaskNextRun(task.id, next);
          try {
            await handler({
              id: task.id,
              groupId: task.groupId,
              prompt: task.prompt,
              createdBy: task.createdBy,
            });
          } catch (error) {
            logger.error(
              "scheduler task handler failed",
              { taskId: task.id, groupId: task.groupId },
              error,
            );
          }
        }
      } catch (error) {
        logger.error("scheduler error", error);
      } finally {
        this.timer = setTimeout(tick, this.pollIntervalMs);
      }
    };

    this.timer = setTimeout(tick, this.pollIntervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  computeNextRun(cron: string, from = new Date()): number {
    const interval = CronExpressionParser.parse(cron, { currentDate: from });
    return interval.next().getTime();
  }
}
