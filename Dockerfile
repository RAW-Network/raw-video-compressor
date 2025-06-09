FROM node:18-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads compressed

EXPOSE 3000

CMD [ "node", "server.js" ]
