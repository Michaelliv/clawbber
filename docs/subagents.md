# Subagents

Clawbber supports delegating tasks to specialized sub-agents using pi's subagent extension. Each sub-agent runs in its own isolated context window, keeping the main conversation clean.

## How It Works

When the agent invokes the `subagent` tool, it spawns a separate `pi` process with:
- Its own context window (isolated from main conversation)
- A specific system prompt (from the agent definition)
- Optionally a different model (e.g., Haiku for fast recon)

```
Main Agent
  │
  └─► subagent tool
        │
        ├─► Spawn pi process
        │     • --mode json
        │     • --model <agent-model>
        │     • --tools <agent-tools>
        │     • --append-system-prompt <agent.md>
        │
        ├─► Stream messages back
        │
        └─► Return final output to main agent
```

## Built-in Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `explore` | Fast codebase reconnaissance | Haiku | read, grep, find, ls, bash |
| `worker` | General-purpose tasks | Sonnet | all |

### explore

Quickly investigates a codebase and returns structured findings. Outputs:
- Files retrieved with line ranges
- Key code snippets (types, interfaces, functions)
- Architecture overview
- Where to start

### worker

General-purpose agent with full capabilities. Works autonomously and reports:
- What was done
- Files changed
- Notes for handoff

## Execution Modes

### Single Agent

Delegate one task to one agent:

```
"Use explore to find all rate limiting code"
```

### Parallel Execution

Run multiple agents concurrently (max 8 tasks, 4 concurrent):

```
"Run 2 workers in parallel: one to refactor the router, one to update tests"
```

### Chained Workflow

Sequential execution where each agent receives the previous output via `{previous}`:

```
"Use a chain: first have explore find the auth code, then have worker add rate limiting"
```

## File Locations

After `clawbber init`, subagent files are scaffolded to:

```
.clawbber/global/
├── extensions/subagent/
│   ├── index.ts      # Subagent tool implementation
│   └── agents.ts     # Agent discovery logic
└── agents/
    ├── explore.md    # Explorer agent definition
    └── worker.md     # Worker agent definition
```

## Adding Custom Agents

Create a new `.md` file in `.clawbber/global/agents/`:

```markdown
---
name: researcher
description: Deep research specialist for complex questions
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
---

You are a research specialist. Thoroughly investigate questions and provide comprehensive answers.

## Strategy
1. Break down the question
2. Search for relevant information
3. Synthesize findings

## Output Format
- Summary
- Key findings
- Sources
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier (used in subagent calls) |
| `description` | Yes | Brief description of the agent's purpose |
| `tools` | No | Comma-separated list of allowed tools |
| `model` | No | Model to use (defaults to current model) |

The body after the frontmatter becomes the agent's system prompt.

## Agent Discovery

Agents are discovered from:
1. **User agents**: `~/.pi/agent/agents/` (default scope)
2. **Project agents**: `.clawbber/global/agents/` (requires `agentScope: "both"`)

Project agents require user confirmation before running (security measure for repo-controlled code).

## Configuration

The subagent tool accepts these parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent` | string | Agent name (single mode) |
| `task` | string | Task description (single mode) |
| `tasks` | array | Array of `{agent, task}` (parallel mode) |
| `chain` | array | Array of `{agent, task}` (chain mode) |
| `agentScope` | string | `"user"`, `"project"`, or `"both"` |
| `cwd` | string | Working directory for the agent |

## Limits

| Limit | Value |
|-------|-------|
| Max parallel tasks | 8 |
| Max concurrency | 4 |

## Example Usage

In the chat, users can request subagent work naturally:

```
@Clawbber Use explore to find how authentication works in this codebase

@Clawbber Run a chain: explore finds the database models, then worker adds a new "status" field to the User model

@Clawbber Run 2 workers in parallel: one fixes the bug in router.ts, one adds a test for it
```

The main agent interprets these requests and invokes the subagent tool accordingly.
