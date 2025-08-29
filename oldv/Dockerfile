FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir yt-dlp --break-system-packages

# Crea directory dell'app
WORKDIR /app

# Copia package.json e package-lock.json
COPY package*.json ./

# Installa dipendenze Node.js
RUN npm ci --only=production

# Copia il codice sorgente
COPY . .

# Crea directory per i dati
RUN mkdir -p /app/data

# Esponi la porta
EXPOSE 3100

# Comando di avvio
CMD ["npm", "start"]


