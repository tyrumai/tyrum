# syntax=docker/dockerfile:1.7
FROM public.ecr.aws/docker/library/node:24-bullseye AS base

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY \
    http_proxy=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    https_proxy=$HTTPS_PROXY \
    NO_PROXY=$NO_PROXY \
    no_proxy=$NO_PROXY
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
