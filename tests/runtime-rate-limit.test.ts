import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClawbberCoreRuntime } from "../src/core/runtime.js";

describe("Runtime rate limiting", () => {
  let tempDir: string;
  let runtime: ClawbberCoreRuntime;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawbber-rate-test-"));

    runtime = new ClawbberCoreRuntime({
      modelProvider: "anthropic",
      model: "claude-sonnet-4-20250514",
      triggerPatterns: "@Pi,Pi",
      triggerMatch: "mention",
      dataDir: tempDir,
      authPath: undefined,
      agentContainerImage: "test",
      containerTimeoutMs: 60000,
      maxConcurrency: 2,
      rateLimitPerUser: 3, // 3 requests per window
      rateLimitWindowMs: 60000,
      chatSdkPort: 8787,
      chatSdkUserName: "clawbber",
      discordGatewayDurationMs: 600000,
      discordGatewaySecret: undefined,
      enableWhatsApp: false,
      admins: "",
      dbPath: path.join(tempDir, "state.db"),
      globalDir: path.join(tempDir, "global"),
      groupsDir: path.join(tempDir, "groups"),
      whatsappAuthDir: path.join(tempDir, "whatsapp-auth"),
    });

    // Mock the container runner to avoid actual container execution
    runtime.containerRunner.reply = mock(async () => "mocked reply");
  });

  afterEach(() => {
    runtime.rateLimiter.stopCleanup();
    runtime.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("allows requests under rate limit", async () => {
    const input = {
      groupId: "test-group",
      rawText: "@Pi hello",
      callerId: "user1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    // Should allow 3 requests
    const r1 = await runtime.handleRawInput(input);
    expect(r1.type).toBe("assistant");

    const r2 = await runtime.handleRawInput(input);
    expect(r2.type).toBe("assistant");

    const r3 = await runtime.handleRawInput(input);
    expect(r3.type).toBe("assistant");
  });

  test("blocks requests over rate limit", async () => {
    const input = {
      groupId: "test-group",
      rawText: "@Pi hello",
      callerId: "user1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    // Use up the limit
    await runtime.handleRawInput(input);
    await runtime.handleRawInput(input);
    await runtime.handleRawInput(input);

    // Fourth request should be denied
    const r4 = await runtime.handleRawInput(input);
    expect(r4.type).toBe("denied");
    expect(r4.reason).toBe("Rate limit exceeded. Try again shortly.");
  });

  test("different users have separate rate limits", async () => {
    const user1Input = {
      groupId: "test-group",
      rawText: "@Pi hello",
      callerId: "user1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    const user2Input = {
      groupId: "test-group",
      rawText: "@Pi hello",
      callerId: "user2",
      isDM: false,
      source: "chat-sdk" as const,
    };

    // Use up user1's limit
    await runtime.handleRawInput(user1Input);
    await runtime.handleRawInput(user1Input);
    await runtime.handleRawInput(user1Input);

    const r4 = await runtime.handleRawInput(user1Input);
    expect(r4.type).toBe("denied");

    // user2 should still be allowed
    const r5 = await runtime.handleRawInput(user2Input);
    expect(r5.type).toBe("assistant");
  });

  test("commands bypass rate limit", async () => {
    // Seed admin so stop command is allowed
    runtime.db.ensureGroup("test-group");
    runtime.db.setRole("test-group", "admin1", "admin", "test");

    const promptInput = {
      groupId: "test-group",
      rawText: "@Pi hello",
      callerId: "admin1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    const stopInput = {
      groupId: "test-group",
      rawText: "@Pi stop",
      callerId: "admin1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    // Use up the limit with prompts
    await runtime.handleRawInput(promptInput);
    await runtime.handleRawInput(promptInput);
    await runtime.handleRawInput(promptInput);

    // Next prompt should be rate limited
    const r4 = await runtime.handleRawInput(promptInput);
    expect(r4.type).toBe("denied");

    // But stop command should still work
    const stopResult = await runtime.handleRawInput(stopInput);
    expect(stopResult.type).toBe("command");
  });

  test("per-group rate limit override", async () => {
    const input = {
      groupId: "limited-group",
      rawText: "@Pi hello",
      callerId: "user1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    // Set a lower limit for this group
    runtime.db.ensureGroup("limited-group");
    runtime.db.setGroupConfig("limited-group", "rate_limit", "1", "test");

    // First request should be allowed
    const r1 = await runtime.handleRawInput(input);
    expect(r1.type).toBe("assistant");

    // Second request should be denied (limit is 1)
    const r2 = await runtime.handleRawInput(input);
    expect(r2.type).toBe("denied");
    expect(r2.reason).toBe("Rate limit exceeded. Try again shortly.");
  });

  test("ignored messages don't count toward rate limit", async () => {
    const ignoredInput = {
      groupId: "test-group",
      rawText: "just a regular message without trigger",
      callerId: "user1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    const triggeredInput = {
      groupId: "test-group",
      rawText: "@Pi hello",
      callerId: "user1",
      isDM: false,
      source: "chat-sdk" as const,
    };

    // Send many ignored messages
    for (let i = 0; i < 10; i++) {
      const result = await runtime.handleRawInput(ignoredInput);
      expect(result.type).toBe("ignore");
    }

    // Triggered messages should still be allowed (limit is 3)
    const r1 = await runtime.handleRawInput(triggeredInput);
    expect(r1.type).toBe("assistant");

    const r2 = await runtime.handleRawInput(triggeredInput);
    expect(r2.type).toBe("assistant");

    const r3 = await runtime.handleRawInput(triggeredInput);
    expect(r3.type).toBe("assistant");
  });
});
