import { describe, expect, it } from "bun:test";
import {
  computeImageHash,
  generateDockerfile,
  mergeInstalls,
  parseInstallCommand,
  toRunStatements,
} from "../src/extensions/image-builder.js";
import type { ExtensionMeta } from "../src/extensions/types.js";

function makeMeta(
  name: string,
  ...clis: { name: string; install: string }[]
): ExtensionMeta {
  return {
    name,
    dir: `/fake/${name}`,
    clis,
    hooks: new Map(),
    jobs: new Map(),
    configs: new Map(),
    widgets: [],
    envVars: [],
  };
}

// ---------------------------------------------------------------------------
// parseInstallCommand
// ---------------------------------------------------------------------------
describe("parseInstallCommand", () => {
  it("parses apt-get install", () => {
    const result = parseInstallCommand(
      "apt-get update && apt-get install -y --no-install-recommends ffmpeg imagemagick && rm -rf /var/lib/apt/lists/*",
    );
    expect(result).toEqual([
      { type: "apt", packages: ["ffmpeg", "imagemagick"] },
    ]);
  });

  it("parses pip install", () => {
    const result = parseInstallCommand(
      "pip install --break-system-packages yt-dlp",
    );
    expect(result).toEqual([{ type: "pip", packages: ["yt-dlp"] }]);
  });

  it("parses python3 -m pip install", () => {
    const result = parseInstallCommand(
      "python3 -m pip install --break-system-packages pypdf pdfplumber",
    );
    expect(result).toEqual([
      { type: "pip", packages: ["pypdf", "pdfplumber"] },
    ]);
  });

  it("parses npm install -g", () => {
    const result = parseInstallCommand("npm install -g charts-cli");
    expect(result).toEqual([{ type: "npm", packages: ["charts-cli"] }]);
  });

  it("parses bun add -g", () => {
    const result = parseInstallCommand("bun add -g napkin-ai");
    expect(result).toEqual([{ type: "bun", packages: ["napkin-ai"] }]);
  });

  it("parses mixed command with shell parts", () => {
    const result = parseInstallCommand(
      "npm install -g agent-browser && npx playwright install --with-deps chromium",
    );
    expect(result).toEqual([
      { type: "npm", packages: ["agent-browser"] },
      { type: "shell", command: "npx playwright install --with-deps chromium" },
    ]);
  });

  it("handles complex pdf-tools install", () => {
    const cmd =
      "apt-get update && apt-get install -y --no-install-recommends poppler-utils qpdf tesseract-ocr && python3 -m pip install --break-system-packages pypdf pdfplumber pdf2image Pillow reportlab pytesseract pypdfium2 && echo '#!/bin/sh' > /usr/local/bin/pdf && echo 'echo \"pdf extension dependencies installed.\"' >> /usr/local/bin/pdf && chmod +x /usr/local/bin/pdf && rm -rf /var/lib/apt/lists/*";
    const result = parseInstallCommand(cmd);
    expect(result).toEqual([
      { type: "apt", packages: ["poppler-utils", "qpdf", "tesseract-ocr"] },
      {
        type: "pip",
        packages: [
          "pypdf",
          "pdfplumber",
          "pdf2image",
          "Pillow",
          "reportlab",
          "pytesseract",
          "pypdfium2",
        ],
      },
      {
        type: "shell",
        command: "echo '#!/bin/sh' > /usr/local/bin/pdf",
      },
      {
        type: "shell",
        command:
          "echo 'echo \"pdf extension dependencies installed.\"' >> /usr/local/bin/pdf",
      },
      { type: "shell", command: "chmod +x /usr/local/bin/pdf" },
    ]);
  });

  it("returns empty for empty string", () => {
    expect(parseInstallCommand("")).toEqual([]);
  });

  it("handles apt-get install with no packages (only flags)", () => {
    const result = parseInstallCommand(
      "apt-get install -y --no-install-recommends",
    );
    expect(result).toEqual([]);
  });

  it("handles bare apt-get update with no install", () => {
    const result = parseInstallCommand("apt-get update");
    expect(result).toEqual([]);
  });

  it("handles apt install (not apt-get)", () => {
    const result = parseInstallCommand("apt install -y ffmpeg");
    // Should fall to shell since we only match apt-get
    expect(result).toEqual([
      { type: "shell", command: "apt install -y ffmpeg" },
    ]);
  });

  it("handles pip3 instead of pip", () => {
    const result = parseInstallCommand("pip3 install yt-dlp");
    // Should fall to shell since we only match pip
    expect(result).toEqual([{ type: "shell", command: "pip3 install yt-dlp" }]);
  });

  it("handles pip with version specifiers", () => {
    const result = parseInstallCommand(
      "pip install --break-system-packages yt-dlp==2024.1.1 requests>=2.0",
    );
    expect(result).toEqual([
      { type: "pip", packages: ["yt-dlp==2024.1.1", "requests>=2.0"] },
    ]);
  });

  it("handles scoped npm packages", () => {
    const result = parseInstallCommand(
      "npm install -g @mermaid-js/mermaid-cli @googleworkspace/cli",
    );
    expect(result).toEqual([
      {
        type: "npm",
        packages: ["@mermaid-js/mermaid-cli", "@googleworkspace/cli"],
      },
    ]);
  });

  it("handles npm packages with version", () => {
    const result = parseInstallCommand("npm install -g charts-cli@1.2.3");
    expect(result).toEqual([{ type: "npm", packages: ["charts-cli@1.2.3"] }]);
  });

  it("handles curl pipe sh (falls to shell)", () => {
    const result = parseInstallCommand(
      "curl -fsSL https://d2lang.com/install.sh | sh",
    );
    expect(result).toEqual([
      {
        type: "shell",
        command: "curl -fsSL https://d2lang.com/install.sh | sh",
      },
    ]);
  });

  it("handles commands with pipes (not split on &&)", () => {
    const result = parseInstallCommand(
      "curl -fsSL https://example.com/install.sh | bash && npm install -g mytool",
    );
    expect(result).toEqual([
      {
        type: "shell",
        command: "curl -fsSL https://example.com/install.sh | bash",
      },
      { type: "npm", packages: ["mytool"] },
    ]);
  });

  it("handles && inside single-quoted strings", () => {
    const result = parseInstallCommand("echo 'run && done' > /tmp/test");
    expect(result).toEqual([
      { type: "shell", command: "echo 'run && done' > /tmp/test" },
    ]);
  });

  it("handles && inside double-quoted strings", () => {
    const result = parseInstallCommand('echo "hello && world" > /tmp/test');
    expect(result).toEqual([
      { type: "shell", command: 'echo "hello && world" > /tmp/test' },
    ]);
  });

  it("handles mixed quoted && and real &&", () => {
    const result = parseInstallCommand(
      "echo 'a && b' > /tmp/x && npm install -g foo",
    );
    expect(result).toEqual([
      { type: "shell", command: "echo 'a && b' > /tmp/x" },
      { type: "npm", packages: ["foo"] },
    ]);
  });

  it("handles multiple pip installs in one chain", () => {
    const result = parseInstallCommand(
      "pip install --break-system-packages foo && pip install --break-system-packages bar",
    );
    expect(result).toEqual([
      { type: "pip", packages: ["foo"] },
      { type: "pip", packages: ["bar"] },
    ]);
  });

  it("handles whitespace-only parts after split", () => {
    const result = parseInstallCommand(
      "npm install -g foo &&  && npm install -g bar",
    );
    expect(result).toEqual([
      { type: "npm", packages: ["foo"] },
      { type: "npm", packages: ["bar"] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// mergeInstalls — edge cases
// ---------------------------------------------------------------------------
describe("mergeInstalls edge cases", () => {
  it("deduplicates same package across extensions", () => {
    const result = mergeInstalls([
      { type: "apt", packages: ["ffmpeg"] },
      { type: "apt", packages: ["ffmpeg"] },
    ]);
    expect(result).toEqual([{ type: "apt", packages: ["ffmpeg"] }]);
  });

  it("handles conflicting pip versions (both kept, last wins at install)", () => {
    const result = mergeInstalls([
      { type: "pip", packages: ["foo==1.0"] },
      { type: "pip", packages: ["foo==2.0"] },
    ]);
    // Both are kept as separate set entries since strings differ
    expect(result).toEqual([
      { type: "pip", packages: ["foo==1.0", "foo==2.0"] },
    ]);
  });

  it("handles empty input", () => {
    expect(mergeInstalls([])).toEqual([]);
  });

  it("handles only shell commands", () => {
    const result = mergeInstalls([
      { type: "shell", command: "echo a" },
      { type: "shell", command: "echo b" },
    ]);
    expect(result).toEqual([
      { type: "shell", command: "echo a" },
      { type: "shell", command: "echo b" },
    ]);
  });

  it("preserves shell command order", () => {
    const result = mergeInstalls([
      { type: "shell", command: "first" },
      { type: "npm", packages: ["foo"] },
      { type: "shell", command: "second" },
      { type: "shell", command: "third" },
    ]);
    const shellCmds = result
      .filter((r) => r.type === "shell")
      .map((r) => (r as { type: "shell"; command: string }).command);
    expect(shellCmds).toEqual(["first", "second", "third"]);
  });
});

// ---------------------------------------------------------------------------
// mergeInstalls
// ---------------------------------------------------------------------------
describe("mergeInstalls", () => {
  it("merges apt packages from multiple commands", () => {
    const result = mergeInstalls([
      { type: "apt", packages: ["ffmpeg"] },
      { type: "apt", packages: ["imagemagick", "gh", "git"] },
      { type: "apt", packages: ["ffmpeg"] }, // duplicate
    ]);
    expect(result).toEqual([
      {
        type: "apt",
        packages: ["ffmpeg", "gh", "git", "imagemagick"],
      },
    ]);
  });

  it("merges npm packages and deduplicates shell commands", () => {
    const result = mergeInstalls([
      { type: "npm", packages: ["agent-browser"] },
      {
        type: "shell",
        command: "npx playwright install --with-deps chromium",
      },
      { type: "npm", packages: ["@mermaid-js/mermaid-cli"] },
      {
        type: "shell",
        command: "npx playwright install --with-deps chromium",
      }, // duplicate
    ]);
    expect(result).toEqual([
      {
        type: "npm",
        packages: ["@mermaid-js/mermaid-cli", "agent-browser"],
      },
      {
        type: "shell",
        command: "npx playwright install --with-deps chromium",
      },
    ]);
  });

  it("outputs in order: apt, pip, npm, bun, shell", () => {
    const result = mergeInstalls([
      { type: "shell", command: "echo hello" },
      { type: "bun", packages: ["napkin-ai"] },
      { type: "npm", packages: ["charts-cli"] },
      { type: "pip", packages: ["yt-dlp"] },
      { type: "apt", packages: ["ffmpeg"] },
    ]);
    expect(result.map((r) => r.type)).toEqual([
      "apt",
      "pip",
      "npm",
      "bun",
      "shell",
    ]);
  });
});

// ---------------------------------------------------------------------------
// toRunStatements
// ---------------------------------------------------------------------------
describe("toRunStatements", () => {
  it("generates apt RUN without cache mount", () => {
    const lines = toRunStatements([
      { type: "apt", packages: ["ffmpeg", "git"] },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("--mount");
    expect(lines[0]).toContain(
      "apt-get install -y --no-install-recommends ffmpeg git",
    );
  });

  it("generates pip RUN with cache mount", () => {
    const lines = toRunStatements([{ type: "pip", packages: ["yt-dlp"] }]);
    expect(lines[0]).toContain("--mount=type=cache,target=/root/.cache/pip");
    expect(lines[0]).toContain("pip install --break-system-packages yt-dlp");
  });

  it("generates npm RUN with cache mount", () => {
    const lines = toRunStatements([{ type: "npm", packages: ["charts-cli"] }]);
    expect(lines[0]).toContain("--mount=type=cache,target=/root/.npm");
    expect(lines[0]).toContain("npm install -g charts-cli");
  });

  it("generates bun RUN with cache mount", () => {
    const lines = toRunStatements([{ type: "bun", packages: ["napkin-ai"] }]);
    expect(lines[0]).toContain(
      "--mount=type=cache,target=/root/.bun/install/cache",
    );
    expect(lines[0]).toContain("bun add -g napkin-ai");
  });

  it("generates plain RUN for shell", () => {
    const lines = toRunStatements([
      { type: "shell", command: "npx playwright install --with-deps chromium" },
    ]);
    expect(lines[0]).toBe("RUN npx playwright install --with-deps chromium");
  });
});

// ---------------------------------------------------------------------------
// generateDockerfile
// ---------------------------------------------------------------------------
describe("generateDockerfile", () => {
  it("returns null when no extensions have CLIs", () => {
    const exts = [makeMeta("a"), makeMeta("b")];
    expect(generateDockerfile("base:latest", exts)).toBeNull();
  });

  it("returns null for empty extensions", () => {
    expect(generateDockerfile("base:latest", [])).toBeNull();
  });

  it("generates correct Dockerfile for one CLI extension", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const df = generateDockerfile(
      "ghcr.io/michaelliv/mercury-agent:latest",
      exts,
    );
    expect(df).toContain("# syntax=docker/dockerfile:1");
    expect(df).toContain("FROM ghcr.io/michaelliv/mercury-agent:latest");
    expect(df).toContain("bun add -g napkin-ai");
  });

  it("merges apt packages across extensions", () => {
    const exts = [
      makeMeta("media", {
        name: "ffmpeg",
        install:
          "apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*",
      }),
      makeMeta("github", {
        name: "gh",
        install:
          "apt-get update && apt-get install -y --no-install-recommends gh git && rm -rf /var/lib/apt/lists/*",
      }),
    ];
    const df = generateDockerfile("base:v1", exts)!;
    // Should have ONE apt-get RUN with all packages merged
    const aptLines = df
      .split("\n")
      .filter((l) => l.includes("apt-get install"));
    expect(aptLines).toHaveLength(1);
    expect(aptLines[0]).toContain("ffmpeg");
    expect(aptLines[0]).toContain("gh");
    expect(aptLines[0]).toContain("git");
  });

  it("deduplicates playwright install across extensions", () => {
    const exts = [
      makeMeta("web-browser", {
        name: "agent-browser",
        install:
          "npm install -g agent-browser && npx playwright install --with-deps chromium",
      }),
      makeMeta("diagrams", {
        name: "mmdc",
        install:
          "npm install -g @mermaid-js/mermaid-cli && npx playwright install --with-deps chromium",
      }),
    ];
    const df = generateDockerfile("base:v1", exts)!;
    // npm packages merged into one RUN
    const npmLines = df.split("\n").filter((l) => l.includes("npm install"));
    expect(npmLines).toHaveLength(1);
    expect(npmLines[0]).toContain("agent-browser");
    expect(npmLines[0]).toContain("@mermaid-js/mermaid-cli");
    // Playwright runs only once
    const playwrightLines = df
      .split("\n")
      .filter((l) => l.includes("playwright"));
    expect(playwrightLines).toHaveLength(1);
  });

  it("generates full realistic Dockerfile", () => {
    const exts = [
      makeMeta(
        "media",
        {
          name: "ffmpeg",
          install:
            "apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*",
        },
        {
          name: "convert",
          install:
            "apt-get update && apt-get install -y --no-install-recommends imagemagick && rm -rf /var/lib/apt/lists/*",
        },
        {
          name: "yt-dlp",
          install: "pip install --break-system-packages yt-dlp",
        },
      ),
      makeMeta("charts", {
        name: "charts",
        install: "npm install -g charts-cli",
      }),
      makeMeta("knowledge", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
      makeMeta("web-browser", {
        name: "agent-browser",
        install:
          "npm install -g agent-browser && npx playwright install --with-deps chromium",
      }),
      makeMeta("no-cli"),
    ];
    const df = generateDockerfile("base:latest", exts)!;
    const lines = df.split("\n");

    // Syntax directive + FROM + apt + pip + npm + bun + playwright = 7 lines
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("# syntax=docker/dockerfile:1");
    expect(lines[1]).toBe("FROM base:latest");
    // apt: ffmpeg + imagemagick merged
    expect(lines[2]).toContain("ffmpeg");
    expect(lines[2]).toContain("imagemagick");
    // pip: yt-dlp
    expect(lines[3]).toContain("yt-dlp");
    // npm: agent-browser + charts-cli merged
    expect(lines[4]).toContain("agent-browser");
    expect(lines[4]).toContain("charts-cli");
    // bun: napkin-ai
    expect(lines[5]).toContain("napkin-ai");
    // shell: playwright once
    expect(lines[6]).toContain("playwright");
  });
});

// ---------------------------------------------------------------------------
// computeImageHash
// ---------------------------------------------------------------------------
describe("computeImageHash", () => {
  it("returns a 12-char hex string", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const hash = computeImageHash("base:latest", exts);
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const h1 = computeImageHash("base:latest", exts);
    const h2 = computeImageHash("base:latest", exts);
    expect(h1).toBe(h2);
  });

  it("changes when base image changes", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const h1 = computeImageHash("base:v1", exts);
    const h2 = computeImageHash("base:v2", exts);
    expect(h1).not.toBe(h2);
  });

  it("changes when install commands change", () => {
    const e1 = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const e2 = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai@2.0",
      }),
    ];
    const h1 = computeImageHash("base:latest", e1);
    const h2 = computeImageHash("base:latest", e2);
    expect(h1).not.toBe(h2);
  });

  it("is order-independent (sorted internally)", () => {
    const e1 = [
      makeMeta("a", { name: "a", install: "install-a" }),
      makeMeta("b", { name: "b", install: "install-b" }),
    ];
    const e2 = [
      makeMeta("b", { name: "b", install: "install-b" }),
      makeMeta("a", { name: "a", install: "install-a" }),
    ];
    expect(computeImageHash("base:latest", e1)).toBe(
      computeImageHash("base:latest", e2),
    );
  });

  it("ignores extensions without CLIs", () => {
    const e1 = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const e2 = [
      makeMeta("no-cli"),
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
      makeMeta("also-no-cli"),
    ];
    expect(computeImageHash("base:latest", e1)).toBe(
      computeImageHash("base:latest", e2),
    );
  });
});
