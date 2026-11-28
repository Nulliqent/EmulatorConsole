FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

# The UI is bundled; the server needs the AWS SDK's protocol packages at run time, so only the production
# dependencies are installed (no dev tools, no install scripts, no npm cache left in the image).
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# The Service Model index is generated from the reference clones and committed (npm run model-index); the
# clones are not in the build context.
COPY data/model-index ./data/model-index
# The user is set by compose (the host's uid, so the Emulator's 0600 files are readable).
USER node
EXPOSE 9298
CMD ["node", "dist/server/main.js"]
