FROM node:20-bookworm-slim

ARG BGUTIL_VERSION=1.3.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg git python3 python3-pip \
  && python3 -m pip install --break-system-packages -U "yt-dlp[default]" bgutil-ytdlp-pot-provider \
  && git clone --depth 1 --branch "${BGUTIL_VERSION}" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
  && cd /opt/bgutil-ytdlp-pot-provider/server \
  && npm ci \
  && npm audit fix \
  && npx tsc \
  && npm prune --omit=dev \
  && apt-get purge -y --auto-remove git \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
ENV YTDLP_BIN=yt-dlp
ENV FFMPEG_BIN=ffmpeg
ENV BGUTIL_POT_PROVIDER=true
ENV BGUTIL_PORT=4416

EXPOSE 10000

CMD ["sh", "-c", "if [ \"$BGUTIL_POT_PROVIDER\" = \"true\" ]; then node /opt/bgutil-ytdlp-pot-provider/server/build/main.js --port ${BGUTIL_PORT:-4416} & fi; node dist/server.js"]
