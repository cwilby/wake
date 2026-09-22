FROM node:24-alpine

RUN apk add --no-cache iputils

WORKDIR /app

COPY package.json ./
COPY main.js ./
COPY app ./app
COPY database ./database

RUN npm install

ENV NODE_ENV=production

CMD ["npm", "start"]
