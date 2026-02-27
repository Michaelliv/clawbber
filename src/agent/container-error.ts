export type ContainerFailureReason = "timeout" | "oom" | "aborted" | "error";

export class ContainerError extends Error {
  readonly reason: ContainerFailureReason;
  readonly exitCode: number | null;

  constructor(
    reason: ContainerFailureReason,
    exitCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ContainerError";
    this.reason = reason;
    this.exitCode = exitCode;
  }

  static timeout(groupId: string): ContainerError {
    return new ContainerError(
      "timeout",
      null,
      `Container timed out for group ${groupId}`,
    );
  }

  static oom(groupId: string, exitCode: number): ContainerError {
    return new ContainerError(
      "oom",
      exitCode,
      `Container was killed for group ${groupId} (exit code ${exitCode}, possibly out of memory)`,
    );
  }

  static aborted(groupId: string): ContainerError {
    return new ContainerError(
      "aborted",
      null,
      `Container aborted for group ${groupId}`,
    );
  }

  static error(exitCode: number, output: string): ContainerError {
    return new ContainerError(
      "error",
      exitCode,
      `Container failed (exit code ${exitCode}): ${output.slice(0, 500)}`,
    );
  }
}
