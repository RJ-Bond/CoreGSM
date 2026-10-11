FROM nginx:stable-bookworm
COPY templates/ /etc/nginx/templates/
COPY docker-entrypoint.d/40-reload-loop.sh /docker-entrypoint.d/40-reload-loop.sh
RUN chmod +x /docker-entrypoint.d/40-reload-loop.sh
