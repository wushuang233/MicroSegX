FROM local.microsegx/microsegx/manager:7da8c6d3-bylw

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx-light \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default

ENTRYPOINT ["nginx", "-g", "daemon off;"]
