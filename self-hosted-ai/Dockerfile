FROM node:22-alpine
WORKDIR /srv/gamevortex-ai
COPY gateway.mjs ./gateway.mjs
ENV NODE_ENV=production
EXPOSE 8081
CMD ["node", "gateway.mjs"]
