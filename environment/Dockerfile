# environment/Dockerfile
FROM node:26-alpine

WORKDIR /app

# Kopiujemy całą zorganizowaną strukturę src do kontenera
COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=3000
# Informujemy kod bazodanowy, że pracuje w Dockerze, aby zmapował bazę do trwałego wolumenu
ENV IS_DOCKER=true

EXPOSE 3000

CMD ["node", "src/http_server.js"]
