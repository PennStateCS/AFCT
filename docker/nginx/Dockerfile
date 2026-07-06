# nginx image for the AFCT reverse proxy. Pins the version and bakes in openssl
# (the entrypoint uses it to generate the self-signed fallback cert) so nothing
# needs fetching at container start.
FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY default.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
