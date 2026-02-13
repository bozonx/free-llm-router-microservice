ARG NODE_MAJOR=24
FROM node:${NODE_MAJOR}-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV LISTEN_HOST=0.0.0.0
ENV LISTEN_PORT=8080
ENV TZ=UTC
ENV LOG_LEVEL=warn

# Install tini for better signal handling
RUN apk add --no-cache tini

# Install pnpm
RUN corepack enable

# Copy source
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.spec.json ./
COPY src ./src
COPY public ./public

# Copy runtime config defaults (can be overridden by volume mounts)
COPY config.yaml models.yaml ./

# Install dependencies, build, then prune to production
RUN pnpm install --frozen-lockfile --prefer-offline || pnpm install --prefer-offline
RUN pnpm build
RUN pnpm prune --prod

EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/src/main.js"]
