# syntax=docker/dockerfile:1
# Bridge AI on an always-on machine (a cloud server, a Mac mini, a Raspberry Pi): the server only,
# no app window. Your phone reaches it through your own relay, which this machine connects out
# to, so no port is published. See "Run it on an always-on machine" in README.md and
# docker-compose.yml.
#
#   docker build -t bridge-ai .
#   docker build -t bridge-ai --build-arg AGENTS="@anthropic-ai/claude-code @openai/codex opencode-ai" .
#
# AGENTS: agent CLIs to bake into the image (npm packages). Leave it empty and install them from
# Bridge AI instead (Settings › Agents, or `npm install -g <package>` in a terminal tab): those
# go in your home folder volume, so they survive image updates and can update themselves.

# Node.js 22, by digest: a tag can be pointed at another image, a digest can't. Dependabot moves
# both FROM lines on together when the image gets fixes (.github/dependabot.yml).

# ---------- Build: dependencies (node-pty is compiled here, for this CPU) and the UI ----------
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts/install-hooks.js scripts/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------- Run ----------
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
ARG AGENTS=""
ARG UID=1000
ARG GID=1000

# git and ssh for your repos, gh for pull requests, ripgrep for search, tini to pass signals on
# and reap the processes agents leave behind, tzdata so TZ can set your time zone.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client ripgrep tini procps less nano tzdata \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Agent CLIs baked in (optional, see above). Installed system-wide, before npm points at the home folder.
RUN if [ -n "$AGENTS" ]; then npm install -g --no-audit --no-fund $AGENTS && npm cache clean --force; fi

# Your user, not root. Home holds every agent's sign-in (~/.claude, ~/.claude.json, ~/.codex,
# ~/.config), git and gh settings, SSH keys and agents you install yourself.
RUN userdel -r node \
 && groupadd -g "$GID" bridge \
 && useradd -m -u "$UID" -g "$GID" -s /bin/bash bridge \
 && install -d -o bridge -g bridge /home/bridge/.bridge-ai /home/bridge/code /home/bridge/.npm-global /home/bridge/.local /home/bridge/.local/bin /home/bridge/.local/share \
 && printf '%s\n' '# Agents you install yourself (npm install -g, or an installer using ~/.local/bin) live in your home' \
      '# folder, which is a volume, so they survive image updates.' \
      'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' > /etc/profile.d/bridge-ai.sh

WORKDIR /app
COPY --from=build /app /app
RUN chmod +x scripts/cli.js && ln -s /app/scripts/cli.js /usr/local/bin/bridge-ai

USER bridge
ENV HOME=/home/bridge \
    SHELL=/bin/bash \
    LANG=C.UTF-8 \
    BRIDGE_HOME=/home/bridge/.bridge-ai \
    BRIDGE_DOCKER=1 \
    NPM_CONFIG_PREFIX=/home/bridge/.npm-global \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH=/home/bridge/.local/bin:/home/bridge/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /home/bridge

# The server listens on 127.0.0.1 inside the container. Nothing is published: phones come in
# through the relay connection this machine opens. See docker-compose.yml for local browser access.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRIDGE_PORT||7420)+'/api/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server/index.js"]
