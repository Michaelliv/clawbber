import { describe, expect, test } from "bun:test";
import { matchTrigger } from "../src/core/trigger.js";
import type { TriggerConfig, TriggerMatch } from "../src/types.js";

function cfg(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    match: "mention",
    patterns: ["@Pi", "Pi"],
    caseSensitive: false,
    ...overrides,
  };
}

describe("matchTrigger — mention mode", () => {
  test("matches @Pi at start", () => {
    const r = matchTrigger("@Pi hello world", cfg(), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello world");
  });

  test("matches @Pi at end", () => {
    const r = matchTrigger("hello @Pi", cfg(), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello");
  });

  test("matches @Pi in middle", () => {
    const r = matchTrigger("hey @Pi do stuff", cfg(), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hey do stuff");
  });

  test("matches Pi as standalone word", () => {
    const r = matchTrigger("Pi what is 2+2", cfg(), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("what is 2+2");
  });

  test("does not match Pi inside a word", () => {
    const r = matchTrigger("Pizza is great", cfg(), false);
    expect(r.matched).toBe(false);
  });

  test("does not match Pi as substring", () => {
    const r = matchTrigger("Pixel art is cool", cfg(), false);
    expect(r.matched).toBe(false);
  });

  test("case insensitive by default", () => {
    const r = matchTrigger("@pi hello", cfg(), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello");
  });

  test("case sensitive when configured", () => {
    const r = matchTrigger("@pi hello", cfg({ caseSensitive: true }), false);
    expect(r.matched).toBe(false);

    const r2 = matchTrigger("@Pi hello", cfg({ caseSensitive: true }), false);
    expect(r2.matched).toBe(true);
  });

  test("prefers longest pattern match", () => {
    const r = matchTrigger(
      "@Pi hello",
      cfg({ patterns: ["Pi", "@Pi"] }),
      false,
    );
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello");
  });

  test("no match returns empty prompt", () => {
    const r = matchTrigger("hello world", cfg(), false);
    expect(r.matched).toBe(false);
    expect(r.prompt).toBe("");
  });

  test("empty text returns no match", () => {
    const r = matchTrigger("", cfg(), false);
    expect(r.matched).toBe(false);
  });

  test("trigger only (no additional text) returns trigger text", () => {
    const r = matchTrigger("@Pi", cfg(), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("@Pi");
  });
});

describe("matchTrigger — prefix mode", () => {
  test("matches prefix at start", () => {
    const r = matchTrigger("@Pi hello", cfg({ match: "prefix" }), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello");
  });

  test("does not match prefix in middle", () => {
    const r = matchTrigger("hey @Pi hello", cfg({ match: "prefix" }), false);
    expect(r.matched).toBe(false);
  });

  test("requires space after prefix", () => {
    const r = matchTrigger(
      "Pixel art",
      cfg({ match: "prefix", patterns: ["Pi"] }),
      false,
    );
    expect(r.matched).toBe(false);
  });

  test("prefix with no trailing text", () => {
    const r = matchTrigger("@Pi", cfg({ match: "prefix" }), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("");
  });
});

describe("matchTrigger — always mode", () => {
  test("always matches", () => {
    const r = matchTrigger("hello world", cfg({ match: "always" }), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello world");
  });

  test("does not strip trigger", () => {
    const r = matchTrigger("@Pi hello", cfg({ match: "always" }), false);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("@Pi hello");
  });

  test("empty text does not match", () => {
    const r = matchTrigger("  ", cfg({ match: "always" }), false);
    expect(r.matched).toBe(false);
  });
});

describe("matchTrigger — DM behavior", () => {
  test("DMs always match even without trigger", () => {
    const r = matchTrigger("hello world", cfg(), true);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello world");
  });

  test("DMs strip trigger when present", () => {
    const r = matchTrigger("@Pi hello", cfg(), true);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello");
  });

  test("DMs with prefix mode strip prefix when present", () => {
    const r = matchTrigger("@Pi hello", cfg({ match: "prefix" }), true);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello");
  });

  test("DMs with prefix mode pass through without prefix", () => {
    const r = matchTrigger("hello world", cfg({ match: "prefix" }), true);
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("hello world");
  });
});

describe("matchTrigger — invalid match mode", () => {
  test("unknown match mode does not match", () => {
    const r = matchTrigger(
      "@Pi hello",
      cfg({ match: "invalid" as TriggerMatch }),
      false,
    );
    expect(r.matched).toBe(false);
  });
});

describe("matchTrigger — custom patterns", () => {
  test("custom alias patterns", () => {
    const r = matchTrigger(
      "Nano do something",
      cfg({ patterns: ["Nano", "@Nano"] }),
      false,
    );
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("do something");
  });

  test("multiple custom patterns — first match wins (longest)", () => {
    const r = matchTrigger(
      "@NanoPi help",
      cfg({ patterns: ["@NanoPi", "Nano", "Pi"] }),
      false,
    );
    expect(r.matched).toBe(true);
    expect(r.prompt).toBe("help");
  });
});
