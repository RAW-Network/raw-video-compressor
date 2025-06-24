FROM node:18-alpine

RUN apk add --no-cache \
    ffmpeg \
    libva \
    libdrm \
    mesa-dri-gallium \
    mesa-va-gallium \
    libva-intel-driver \
    pciutils \
    su-exec \
    tzdata

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads compressed
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
