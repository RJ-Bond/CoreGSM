FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:stable-bookworm
# system packages of the base image come with the latest fixes (a fixable CRITICAL finding of Trivy fails the build, see ci.yml)
RUN apt-get update && apt-get -y upgrade && rm -rf /var/lib/apt/lists/*
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf csp.conf /etc/nginx/snippets/
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
