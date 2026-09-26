FROM node:24-alpine

RUN apk add --no-cache iputils openssh-client

WORKDIR /app

COPY package.json package-lock.json ./
COPY main.js ./
COPY app ./app
COPY database ./database

RUN npm ci --omit=dev

ENV NODE_ENV=production

CMD ["npm", "start"]
