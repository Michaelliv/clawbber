# Clawsome Agent Container
# Pre-built image with pi CLI and all dependencies baked in

FROM oven/bun:1.3

# Install pi CLI globally (the main cost we're eliminating per-request)
RUN bun add -g @mariozechner/pi-coding-agent

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global

# Copy container-entry source
COPY src/agent/container-entry.ts /app/container-entry.ts
COPY src/cli/clawsome-ctl.ts /app/clawsome-ctl.ts

WORKDIR /app

ENTRYPOINT ["bun", "run", "/app/container-entry.ts"]
