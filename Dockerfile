FROM node:22-alpine AS build
WORKDIR /atlas

COPY app/package.json app/package-lock.json ./app/
RUN npm ci --prefix app

COPY app/index.html ./app/
COPY app/scripts/ ./app/scripts/
COPY app/src/ ./app/src/
COPY app/test/ ./app/test/
COPY evidence/*.csv ./evidence/
RUN npm test --prefix app && npm run build --prefix app

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /atlas/demo.html /usr/share/nginx/html/demo.html

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/demo.html || exit 1
