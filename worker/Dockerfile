FROM node:22-alpine
WORKDIR /app
COPY worker ./worker
COPY lib ./lib
COPY scripts/verify-production-release.mjs ./scripts/verify-production-release.mjs
COPY tests/worker-recovery.test.mjs tests/worker-heartbeat.test.mjs tests/parallel-worker.test.mjs ./tests/
RUN node --experimental-strip-types tests/worker-recovery.test.mjs && node --experimental-strip-types tests/worker-heartbeat.test.mjs && node --experimental-strip-types tests/parallel-worker.test.mjs
EXPOSE 3001
CMD ["node", "--experimental-strip-types", "worker/index.mjs"]
