FROM node:22-alpine
WORKDIR /app
COPY monitor/package.json monitor/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY lib ./lib
COPY scripts ./scripts
COPY monitor ./monitor
COPY tests/external-reliability-monitor.test.mjs ./tests/
RUN node --experimental-strip-types tests/external-reliability-monitor.test.mjs
EXPOSE 3001
CMD ["node", "--experimental-strip-types", "monitor/index.mjs"]
