# Mercury Agent Container
FROM oven/bun:1.3

# Install Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 \
    libxcomposite1 libxdamage1 libxfixes3 libxi6 \
    libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 \
    libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 \
    libfontconfig1 libdbus-1-3 libnss3 libnspr4 libatk-bridge2.0-0 \
    libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 libxshmfence1 libgbm1 \
    && rm -rf /var/lib/apt/lists/*

# Install CLIs
RUN bun add -g @mariozechner/pi-coding-agent agent-browser napkin-ai

# Set HOME to /home/node for playwright (container-runner uses this)
ENV HOME=/home/node
RUN mkdir -p /home/node/.cache && bunx playwright install chromium

WORKDIR /app

COPY src/agent/container-entry.ts /app/src/agent/container-entry.ts
COPY src/cli/mercury-ctl.ts /app/src/cli/mercury-ctl.ts
COPY src/types.ts /app/src/types.ts

RUN echo '#!/bin/sh\nbun run /app/src/cli/mercury-ctl.ts "$@"' > /usr/local/bin/mercury-ctl && \
    chmod +x /usr/local/bin/mercury-ctl

ENTRYPOINT ["bun", "run", "/app/src/agent/container-entry.ts"]
