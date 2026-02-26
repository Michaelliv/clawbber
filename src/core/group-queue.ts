type Work<T> = () => Promise<T>;

export class GroupQueue {
  private readonly perGroupPending = new Map<string, Array<() => void>>();
  private readonly activeGroups = new Set<string>();
  private activeGlobal = 0;

  constructor(private readonly maxConcurrency: number) {}

  enqueue<T>(groupId: string, work: Work<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.activeGlobal += 1;
        this.activeGroups.add(groupId);
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        } finally {
          this.activeGlobal -= 1;
          this.activeGroups.delete(groupId);
          this.startNext(groupId);
          this.drainOtherGroups();
        }
      };

      const queue = this.perGroupPending.get(groupId) ?? [];
      queue.push(run);
      this.perGroupPending.set(groupId, queue);
      this.drainOtherGroups();
    });
  }

  cancelPending(groupId: string): number {
    const queue = this.perGroupPending.get(groupId);
    if (!queue || queue.length === 0) return 0;
    const count = queue.length;
    this.perGroupPending.delete(groupId);
    return count;
  }

  isActive(groupId: string): boolean {
    return this.activeGroups.has(groupId);
  }

  private canStart(groupId: string): boolean {
    return (
      this.activeGlobal < this.maxConcurrency && !this.activeGroups.has(groupId)
    );
  }

  private startNext(groupId: string): void {
    const queue = this.perGroupPending.get(groupId);
    if (!queue || queue.length === 0 || !this.canStart(groupId)) return;
    const next = queue.shift();
    if (queue.length === 0) this.perGroupPending.delete(groupId);
    next?.();
  }

  private drainOtherGroups(): void {
    for (const groupId of this.perGroupPending.keys()) {
      if (this.activeGlobal >= this.maxConcurrency) return;
      this.startNext(groupId);
    }
  }
}
