FROM node:22-alpine
WORKDIR /app
COPY worker ./worker
COPY lib ./lib
EXPOSE 3001
CMD ["node", "--experimental-strip-types", "worker/index.mjs"]
