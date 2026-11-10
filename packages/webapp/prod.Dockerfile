FROM node:22.23.4 as build

WORKDIR /usr/src/app

COPY ./webapp/package.json ./webapp/.npmrc ./webapp/pnpm-lock.yaml /usr/src/app/

COPY ./webapp/patches/ /usr/src/app/patches/

RUN npm install pnpm@10.6.5 -g && pnpm install

COPY ./webapp/ /usr/src/app/

COPY ./shared/ /usr/src/shared/

# Required managed glyph host: must serve every range for MAP_LABEL_FONT's font stack.
# Vite embeds this value at build time; nginx runtime variables cannot configure it.
ARG VITE_MAP_GLYPHS_URL
ENV VITE_MAP_GLYPHS_URL=${VITE_MAP_GLYPHS_URL}
RUN test -n "$VITE_MAP_GLYPHS_URL" || (echo "VITE_MAP_GLYPHS_URL must specify a managed glyph host" >&2; exit 1)

RUN pnpm run build

FROM nginx:1.25.1

COPY --from=build /usr/src/app/dist /var/www/litefarm

COPY --from=build /usr/src/app/nginx.conf /etc/nginx/

EXPOSE 80 443
