import { describe, expect, test } from "bun:test";
import { ContainerError } from "../src/agent/container-error.js";

describe("ContainerError", () => {
  test("timeout creates correct error", () => {
    const err = ContainerError.timeout("group-1");
    expect(err.reason).toBe("timeout");
    expect(err.exitCode).toBeNull();
    expect(err.message).toContain("group-1");
    expect(err.message).toContain("timed out");
    expect(err.name).toBe("ContainerError");
  });

  test("oom creates correct error", () => {
    const err = ContainerError.oom("group-2", 137);
    expect(err.reason).toBe("oom");
    expect(err.exitCode).toBe(137);
    expect(err.message).toContain("group-2");
    expect(err.message).toContain("OOM");
    expect(err.message).toContain("137");
  });

  test("aborted creates correct error", () => {
    const err = ContainerError.aborted("group-3");
    expect(err.reason).toBe("aborted");
    expect(err.exitCode).toBeNull();
    expect(err.message).toContain("group-3");
    expect(err.message).toContain("aborted");
  });

  test("error creates correct error with truncated output", () => {
    const longOutput = "x".repeat(1000);
    const err = ContainerError.error(1, longOutput);
    expect(err.reason).toBe("error");
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain("exit code 1");
    // Output should be truncated to 500 chars
    expect(err.message.length).toBeLessThan(600);
  });

  test("ContainerError is instanceof Error", () => {
    const err = ContainerError.timeout("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ContainerError);
  });
});
