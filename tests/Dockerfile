# Self-contained test runner: Node + Python/pydicom + API deps. Built from the repo root.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages pydicom numpy \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY api/package*.json api/
RUN cd api && (npm ci --omit=dev || npm install --omit=dev)
COPY tests/package*.json tests/
RUN cd tests && (npm ci || npm install)
COPY api/src api/src
COPY api/sql api/sql
COPY tests/*.js tests/*.py tests/
WORKDIR /repo/tests
CMD ["node", "--test"]
