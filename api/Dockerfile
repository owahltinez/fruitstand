FROM node:lts

WORKDIR /var/www
COPY package.json .
COPY index.js .
COPY public /var/www/public
RUN npm install --omit=dev
CMD [ "node", "index.js" ]