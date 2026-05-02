# syntax=docker/dockerfile:1.7

# ===== Stage 1: build do bundle Vite =====
FROM node:20-alpine AS build

WORKDIR /app

# VITE_N8N_BASE_URL é injetada no bundle no momento do build.
# Passe via --build-arg ou docker compose `build.args`. Vazio = modo mock.
ARG VITE_N8N_BASE_URL=""
ENV VITE_N8N_BASE_URL=$VITE_N8N_BASE_URL

# Instala deps com cache eficiente (só refaz npm ci se package*.json mudar)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ===== Stage 2: nginx servindo a SPA =====
FROM nginx:alpine AS runtime

# Config nginx pronta pra SPA + catch-all server_name
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Bundle gerado no stage anterior
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine já vem com CMD adequado, não precisamos sobrescrever.
