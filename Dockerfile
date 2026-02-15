FROM ubuntu:22.04

ARG NODE_VERSION=24.13.0
ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/root/.nvm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl git build-essential python3 python3-distutils procps \
     gnupg2 apt-transport-https \
     ca-certificates \
     sudo \
     lsb-release \
     ca-certificates \
     bash \
     net-tools \
     iproute2 \
     tini \
  && rm -rf /var/lib/apt/lists/*

# Устанавливаем nvm
RUN set -ex \
  && mkdir -p $NVM_DIR \
  && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash \
  && . "$NVM_DIR/nvm.sh" \
  && nvm install ${NODE_VERSION} \
  && nvm alias default ${NODE_VERSION} \
  && echo "export NVM_DIR=\"$NVM_DIR\"" >> /etc/profile.d/nvm.sh \
  && echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /etc/profile.d/nvm.sh \
  && chmod +x /etc/profile.d/nvm.sh

WORKDIR /srv

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ARG APP_PORT=3000
EXPOSE ${APP_PORT}

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
