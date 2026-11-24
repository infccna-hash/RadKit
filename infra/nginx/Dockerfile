# Build the React app, then serve it with nginx
FROM node:22-alpine AS build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine
ENV NGINX_ENVSUBST_FILTER=ORTHANC_
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /web/dist /usr/share/nginx/html
COPY infra/nginx/simple-viewer.html /usr/share/nginx/html/simple-viewer.html
EXPOSE 80 8081
