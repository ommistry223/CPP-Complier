# Use Node.js as the base image for building
FROM node:20-bullseye-slim AS build

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# VITE_API_URL is empty in Docker — nginx on the same origin proxies /api and /ws.
# Pass it as a build arg so it can be overridden if needed.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

COPY . .

# Build the app
RUN npm run build

# Use Nginx to serve the static files
FROM nginx:alpine

# Copy the built files from the previous stage
COPY --from=build /app/dist /usr/share/nginx/html

# Replace the default Nginx config with our SPA-aware config
# This ensures React Router routes like /admin don't return 404
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 (default for Nginx)
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
