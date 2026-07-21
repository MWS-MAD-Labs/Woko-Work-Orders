FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/tsconfig.json ./packages/domain/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html ./apps/web/
RUN npm install
COPY packages/domain/src ./packages/domain/src
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
RUN npm run build -w @woko/domain && npm run build -w @woko/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
