# Backend Dockerfile (Node.js/Express)
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY server/ .

# Copy shared data files needed at runtime (e.g., trial CSVs)
COPY data/ ./data/

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 5001

# Start the application
CMD ["npm", "start"]
