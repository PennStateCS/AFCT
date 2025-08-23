FROM node:18-alpine AS base
WORKDIR /app

# Install Java (OpenJDK) for running .jar files
RUN apk add --no-cache openjdk21-jre

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx prisma generate
RUN npm run build

# Create bin directory and set permissions for Java binary dependencies
RUN mkdir -p /app/bin && chmod 755 /app/bin

# Verify Java installation
RUN java -version

EXPOSE 3000
CMD ["npm", "start"]
