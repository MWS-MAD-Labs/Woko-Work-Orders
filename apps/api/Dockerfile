FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/tsconfig.json ./packages/domain/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
RUN npm install
COPY packages/domain/src ./packages/domain/src
COPY apps/api/src ./apps/api/src
COPY apps/api/migrations ./apps/api/migrations
RUN npm run build -w @woko/domain && npm run build -w @woko/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
