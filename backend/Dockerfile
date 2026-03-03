FROM node:18-bullseye-slim

# Install compilers + process-tree tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 5000

# Tune Node.js heap for high-throughput compile + spawn workloads
ENV NODE_OPTIONS="--max-old-space-size=512"

CMD ["npm", "start"]
