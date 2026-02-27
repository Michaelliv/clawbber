# Mercury Agent Container
# Pre-built image with pi CLI and all dependencies baked in

FROM oven/bun:1.3

# Install pi CLI and napkin-ai globally at build time
RUN bun add -g @mariozechner/pi-coding-agent
RUN bun add -g napkin-ai

WORKDIR /app

# Copy container-entry source
COPY src/agent/container-entry.ts /app/src/agent/container-entry.ts
COPY src/cli/mercury-ctl.ts /app/src/cli/mercury-ctl.ts
COPY src/types.ts /app/src/types.ts

ENTRYPOINT ["bun", "run", "/app/src/agent/container-entry.ts"]
