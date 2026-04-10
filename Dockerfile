FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV PORT=8787
ENV GENSPARK_USER_DATA_DIR=/data/playwright-user-data
ENV GENSPARK_HEADLESS=true

EXPOSE 8787

CMD ["npm", "start"]
