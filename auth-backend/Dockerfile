# Backend de autenticacao (SSO Google + Postgres) — build TS -> runtime Node
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# migrations/seed sao SQL puro lidos em runtime pelos scripts compilados
COPY db ./db
EXPOSE 3000
# roda migrations (idempotentes) + seed antes de subir o servidor
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/scripts/seed.js && node dist/server.js"]
