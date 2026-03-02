# Mercury Agent Container
FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install dev tools and language runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core tools (already in base: git, curl, wget, jq, vim, zsh, ssh, gpg)
    build-essential \
    # Python
    python3 python3-pip python3-venv \
    # Chromium deps for Playwright
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (required for pi/napkin/agent-browser shebangs)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Install Go
RUN curl -fsSL https://go.dev/dl/go1.24.1.linux-$(dpkg --print-architecture).tar.gz | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:$PATH"

# Install CLIs
RUN bun add -g @mariozechner/pi-coding-agent agent-browser napkin-ai

# Install Playwright Chromium
RUN bunx playwright install chromium

WORKDIR /app

COPY src/agent/container-entry.ts /app/src/agent/container-entry.ts
COPY src/cli/mercury-ctl.ts /app/src/cli/mercury-ctl.ts
COPY src/types.ts /app/src/types.ts

RUN echo '#!/bin/sh\nbun run /app/src/cli/mercury-ctl.ts "$@"' > /usr/local/bin/mercury-ctl && \
    chmod +x /usr/local/bin/mercury-ctl

ENTRYPOINT ["bun", "run", "/app/src/agent/container-entry.ts"]
