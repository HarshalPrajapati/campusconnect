FROM node:22-alpine
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Expose gateway port
EXPOSE 3000

# Start service
CMD ["node", "server.js"]
