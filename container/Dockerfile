# Mercury — single deployment image
# Contains the full Mercury process: ingress adapters + agent (pi subprocess)
FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Dev tools and language runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 python3-pip python3-venv \
    bubblewrap \
    && rm -rf /var/lib/apt/lists/*

# Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Go
RUN curl -fsSL https://go.dev/dl/go1.24.1.linux-$(dpkg --print-architecture).tar.gz | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:$PATH"

# pi CLI
RUN bun add -g @mariozechner/pi-coding-agent

# Playwright Chromium
RUN npx playwright install --with-deps chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN ln -sf $(find /root/.cache/ms-playwright -name chrome -type f | head -1) /usr/local/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium
RUN echo '{"args":["--no-sandbox"]}' > /root/.puppeteerrc.json
ENV CHROMIUM_FLAGS="--no-sandbox"

# Mercury source
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/
COPY resources/ ./resources/
COPY tsconfig.json ./

# mrctl helper
RUN echo '#!/bin/sh\nbun run /app/src/cli/mrctl.ts "$@"' > /usr/local/bin/mrctl && \
    chmod +x /usr/local/bin/mrctl

# Pi agent dir → persisted data dir (symlink resolves at runtime when volume is mounted)
RUN mkdir -p /root/.pi && ln -s /app/.mercury/pi-agent /root/.pi/agent

# Data directory is mounted separately (persisted across deploys)
VOLUME /data



ENTRYPOINT ["bun", "run", "/app/src/main.ts"]
