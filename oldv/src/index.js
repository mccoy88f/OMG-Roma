const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const { loadConfig, saveConfig, ensureDataDir } = require('./lib/config');
const { searchVideos, getChannelIdFromInput, fetchChannelLatestVideos, fetchChannelTitleAndThumb, checkApiQuotaStatus } = require('./lib/youtube');
const { getVideoFormats, searchVideosWithYtDlp } = require('./lib/yt.js');
const { getStreamUrlForVideo, createVideoStream, createVideoStreamWithQuality } = require('./lib/yt.js');

const APP_PORT = process.env.PORT ? Number(process.env.PORT) : 3100;

ensureDataDir();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(morgan('dev'));

function buildManifest(req = null) {
    const config = loadConfig();
    const channelNames = config.channels && config.channels.length > 0 
        ? config.channels.map(ch => ch.name || ch.url).filter(Boolean)
        : [];
    
    // Rileva automaticamente baseUrl dalla richiesta se disponibile
    let baseUrl = 'http://localhost:3100'; // fallback
    if (req) {
        const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const host = req.get('x-forwarded-host') || req.get('host');
        baseUrl = `${protocol}://${host}`;
    }
    
    // Costruisci configurazione codificata in base64 per Stremio
    let manifestUrl = `${baseUrl}/manifest.json`;
    
    if (config.apiKey || (config.channels && config.channels.length > 0)) {
        const configData = {
            apiKey: config.apiKey || '',
            channels: config.channels ? config.channels.map(ch => ch.url) : []
        };
        
        // Codifica la configurazione in base64
        const configJson = JSON.stringify(configData);
        const configBase64 = Buffer.from(configJson, 'utf8').toString('base64');
        manifestUrl = `${baseUrl}/manifest.json?config=${configBase64}`;
    }
    
    return {
        id: 'com.omg.youtube',
        name: 'OMG YouTube',
        description: 'Addon YouTube per Stremio con ricerca e canali seguiti',
        version: '1.0.0',
        logo: `${baseUrl}/favicon.png`,
        background: `${baseUrl}/favicon.png`,
        contactEmail: 'admin@omg-youtube.com',
        catalogs: [
            {
                                        type: 'channel',
                id: 'omg-youtube-search',
                name: 'Ricerca YouTube',
                extra: [
                    { name: 'search', isRequired: true, options: [''] }
                ]
            },
            {
                                        type: 'channel',
                id: 'omg-youtube-followed',
                name: 'YouTube Canali Seguiti',
                extra: [
                    { name: 'genre', isRequired: false, options: ['Tutti i canali'].concat(channelNames) }
                ]
            }
        ],
        resources: [
            'catalog',
            'stream',
            'meta'
        ],
        types: ['movie'],
        idPrefixes: ['yt'],
        // URL di configurazione per Stremio (senza parametri)
        configuration: `${baseUrl}/`,
        // Endpoint proxy per streaming
        proxy: `${baseUrl}/proxy`,
        // Comportamenti per Stremio
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        }
    };
}

// Manifest
app.get('/manifest.json', (req, res) => {
    try {
        // Leggi i parametri di configurazione dall'URL
        let tempConfig = { apiKey: '', channels: [] };
        
        // Supporto per configurazione base64 (nuovo formato)
        const configBase64 = req.query.config;
        if (configBase64) {
            try {
                const configJson = Buffer.from(configBase64, 'base64').toString('utf8');
                const configData = JSON.parse(configJson);
                
                if (configData.apiKey) {
                    tempConfig.apiKey = configData.apiKey;
                }
                
                if (configData.channels && Array.isArray(configData.channels)) {
                    tempConfig.channels = configData.channels.map(url => ({
                        url,
                        name: extractChannelNameFromUrl(url)
                    }));
                }
                
                if (configData.extractionLimit && typeof configData.extractionLimit === 'number') {
                    tempConfig.extractionLimit = Math.max(5, Math.min(50, configData.extractionLimit));
                } else {
                    tempConfig.extractionLimit = 25; // Valore predefinito
                }
            } catch (error) {
                console.log('Errore decodifica configurazione base64:', error.message);
            }
        } else {
            // Fallback per formato legacy (parametri URL diretti)
            const apiKey = req.query.apiKey;
            const channelsParam = req.query.channels;
            
            if (apiKey) {
                tempConfig.apiKey = apiKey;
            }
            
            if (channelsParam) {
                const channelUrls = channelsParam.split('\n').map(url => url.trim()).filter(url => url.length > 0);
                tempConfig.channels = channelUrls.map(url => ({ 
                    url, 
                    name: extractChannelNameFromUrl(url) 
                }));
            }
            
            // Assicuriamo che extractionLimit abbia sempre un valore predefinito
            if (!tempConfig.extractionLimit) {
                tempConfig.extractionLimit = 25;
            }
        }
        
        // Genera manifest dinamico con la configurazione temporanea
        const manifest = buildManifestFromConfig(tempConfig, req);
        
        res.json(manifest);
    } catch (error) {
        console.error('Manifest error:', error.message);
        // Fallback al manifest base se ci sono errori
        res.json(buildManifestFromConfig({}, req));
    }
});

// Funzione per estrarre il nome del canale dall'URL
function extractChannelNameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        if (urlObj.pathname.includes('@')) {
            return '@' + urlObj.pathname.split('@')[1];
        } else if (urlObj.pathname.includes('/channel/')) {
            return 'Channel ' + urlObj.pathname.split('/channel/')[1];
        } else if (urlObj.pathname.includes('/c/')) {
            return 'Custom ' + urlObj.pathname.split('/c/')[1];
        } else {
            return urlObj.hostname;
        }
    } catch (error) {
        return url;
    }
}

// Funzione per generare manifest da configurazione specifica
function buildManifestFromConfig(config, req = null) {
    const channelNames = config.channels && config.channels.length > 0 
        ? config.channels.map(ch => ch.name || ch.url).filter(Boolean)
        : [];
    
    // Rileva automaticamente baseUrl dalla richiesta se disponibile
    let baseUrl = 'http://localhost:3100'; // fallback
    if (req) {
        const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const host = req.get('x-forwarded-host') || req.get('host');
        baseUrl = `${protocol}://${host}`;
    }
    
    return {
        id: 'com.omg.youtube',
        name: 'YouTube (OMG)',
        description: 'Addon YouTube per Stremio con ricerca e canali seguiti',
        version: '1.0.0',
        logo: `${baseUrl}/favicon.png`,
        background: `${baseUrl}/favicon.png`,
        contactEmail: 'admin@omg-youtube.com',
        catalogs: [
            {
                type: 'channel',
                id: 'omg-youtube-search',
                name: 'Ricerca YouTube',
                extra: [
                    { name: 'search', isRequired: true, options: [''] }
                ]
            },
            {
                type: 'channel',
                id: 'omg-youtube-followed',
                name: 'YouTube Canali Seguiti',
                extra: [
                    { name: 'genre', isRequired: false, options: channelNames }
                ]
            }
        ],
        resources: [
            'catalog',
            'stream',
            'meta'
        ],
        types: ['channel'],
        idPrefixes: ['yt'],
        // URL di configurazione per Stremio (senza parametri)
        configuration: `${baseUrl}/`,
        // Endpoint proxy per streaming
        proxy: `${baseUrl}/proxy`,
        // Comportamenti per Stremio
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        }
    };
}

// Funzione originale buildManifest per compatibilità
function buildManifest() {
    const config = loadConfig();
    return buildManifestFromConfig(config);
}

// Catalog endpoint
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        const { type, id, extra } = req.params;
        
        // Leggi i parametri di configurazione dai query parameters dell'URL della richiesta
        let config = { apiKey: '', channels: [] };
        
        // Supporto per configurazione base64 (nuovo formato)
        const configBase64 = req.query.config;
        if (configBase64) {
            try {
                const configJson = Buffer.from(configBase64, 'base64').toString('utf8');
                const configData = JSON.parse(configJson);
                
                if (configData.apiKey) {
                    config.apiKey = configData.apiKey;
                }
                
                if (configData.channels && Array.isArray(configData.channels)) {
                    config.channels = configData.channels.map(url => ({
                        url,
                        name: extractChannelNameFromUrl(url)
                    }));
                }
                
                if (configData.extractionLimit && typeof configData.extractionLimit === 'number') {
                    config.extractionLimit = Math.max(5, Math.min(50, configData.extractionLimit));
                } else {
                    config.extractionLimit = 25; // Valore predefinito
                }
            } catch (error) {
                console.log('   ❌ Errore decodifica configurazione base64:', error.message);
            }
        } else {
            // Fallback per formato legacy (parametri URL diretti)
            const apiKey = req.query.apiKey;
            const channelsParam = req.query.channels;
            
            if (apiKey) {
                config.apiKey = apiKey;
            }
            
            if (channelsParam) {
                // Decodifica URL-encoded channels parameter
                const decodedChannels = decodeURIComponent(channelsParam);
                const channelUrls = decodedChannels.split('\n').map(url => url.trim()).filter(url => url.length > 0);
                config.channels = channelUrls.map(url => ({ 
                    url, 
                    name: extractChannelNameFromUrl(url) 
                }));
            }
            
            // Assicuriamo che extractionLimit abbia sempre un valore predefinito
            if (!config.extractionLimit) {
                config.extractionLimit = 25;
            }
        }
        
        // Se non troviamo parametri URL, fallback alla configurazione del server
        if (!config.apiKey && !config.channels.length) {
            console.log('   📝 Nessun parametro URL trovato, uso configurazione server');
            config = loadConfig();
        }
        
        if (type === 'channel' && id === 'omg-youtube-search') {
            // Ricerca video YouTube
            let searchQuery = extra ? decodeURIComponent(extra) : '';
            // Estrai solo la query dalla stringa "search=query"
            if (searchQuery.startsWith('search=')) {
                searchQuery = searchQuery.substring(7); // Rimuovi "search="
            }
            if (!searchQuery) {
                console.log('🔍 Ricerca catalog: Query vuota, restituisco catalogo vuoto');
                return res.json({ metas: [] });
            }
            
            console.log(`🔍 Ricerca catalog richiesta: "${searchQuery}"`);
            console.log(`   📍 Tipo: ${type}, ID: ${id}`);
            console.log(`   🔧 Modalità ricerca: ${config.searchMode || 'api'}`);
            console.log(`   🔑 API Key configurata: ${config.apiKey ? 'Sì' : 'No'}`);
            console.log(`   📺 Canali configurati: ${config.channels.length}`);
            
            try {
                const extractionLimit = config.extractionLimit || 25;
                console.log(`   🎯 Limite di estrazione: ${extractionLimit}`);
                
                let videos;
                if (config.searchMode === 'ytdlp') {
                    // Modalità yt-dlp: ricerca gratuita ma più lenta
                    console.log(`   🔍 Usando yt-dlp search (gratuito)`);
                    videos = await searchVideosWithYtDlp(searchQuery, extractionLimit);
                } else {
                    // Modalità API: ricerca veloce ma consuma quota
                    console.log(`   🚀 Usando YouTube Data API (quota: ${extractionLimit * 4} unità)`);
                    videos = await searchVideos({ apiKey: config.apiKey, query: searchQuery, maxResults: extractionLimit });
                }
                
                console.log(`✅ Ricerca completata: ${videos.length} video trovati`);
                
                const metas = videos.map(video => ({
                    id: `yt_${video.id}`,
                    type: 'channel',
                    name: video.title,
                    description: video.description,
                    poster: video.thumbnail,
                    posterShape: 'landscape',
                    logo: video.channelThumbnail,
                    background: video.thumbnail,
                    genre: ['YouTube'],
                    releaseInfo: video.duration || 'YouTube',
                    director: video.channelTitle,
                    cast: [video.channelTitle],
                    country: 'YouTube',
                    language: 'it',
                    subtitles: [],
                    year: new Date(video.publishedAt).getFullYear(),
                    released: video.publishedAt,
                    links: [
                        {
                            name: 'YouTube',
                            category: 'watch',
                            url: `https://www.youtube.com/watch?v=${video.id}`
                        }
                    ]
                }));
                
                // Log dei primi 3 risultati per debug
                metas.slice(0, 3).forEach((meta, i) => {
                    console.log(`   Video ${i + 1}. ${meta.name} (${meta.id})`);
                    console.log(`      Canale: ${meta.director}`);
                    console.log(`      Data: ${meta.releaseInfo}`);
                });
                
                res.json({ metas });
                
            } catch (error) {
                console.error('❌ Errore nella ricerca catalog:', error.message);
                
                // Gestione fallback intelligente
                if (config.searchMode === 'api' && (error.message.includes('QUOTA_EXCEEDED') || error.message.includes('API_ERROR'))) {
                    console.log('🔄 Tentativo fallback a yt-dlp search...');
                    try {
                        const videos = await searchVideosWithYtDlp(searchQuery, extractionLimit);
                        console.log(`✅ Fallback yt-dlp completato: ${videos.length} video trovati`);
                        
                        const metas = videos.map(video => ({
                            id: `yt_${video.id}`,
                            type: 'channel',
                            name: video.title,
                            description: video.description,
                            poster: video.thumbnail,
                            posterShape: 'landscape',
                            logo: video.channelThumbnail,
                            background: video.thumbnail,
                            genre: ['YouTube'],
                            releaseInfo: video.duration || 'YouTube',
                            director: video.channelTitle,
                            cast: [video.channelTitle],
                            country: 'YouTube',
                            language: 'it',
                            subtitles: [],
                            year: new Date(video.publishedAt).getFullYear(),
                            released: video.publishedAt,
                            links: [
                                {
                                    name: 'YouTube',
                                    category: 'watch',
                                    url: `https://www.youtube.com/watch?v=${video.id}`
                                }
                            ]
                        }));
                        
                        return res.json({ metas });
                        
                    } catch (fallbackError) {
                        console.error('❌ Anche il fallback yt-dlp è fallito:', fallbackError.message);
                    }
                }
                
                // Gestione specifica degli errori di quota
                if (error.message.includes('QUOTA_EXCEEDED')) {
                    console.error('💡 Suggerimento: La quota API YouTube è stata superata');
                    console.error('   • Attendi fino a domani per il reset automatico');
                    console.error('   • Oppure crea una nuova API Key su Google Cloud Console');
                    console.error('   • Oppure usa la modalità yt-dlp search (gratuita)');
                }
                
                res.json({ metas: [] });
            }
            
        } else if (type === 'channel' && id === 'omg-youtube-followed') {
            // Canali seguiti - YouTube Discover
            const channels = config.channels || [];
            
            if (!channels.length) {
                console.log('❌ Nessun canale configurato per YouTube Discover');
                return res.json({ metas: [] });
            }
            
            console.log(`🎬 YouTube Discover richiesto`);
            console.log(`   📺 Canali configurati: ${channels.length}`);
            console.log(`   🔍 Filtro: ${extra || 'Tutti'}`);
            
            // Determina quali canali interrogare
            let channelsToQuery = channels;
            if (extra) {
                // Estrai il nome del canale dal filtro
                let filterName = decodeURIComponent(extra);
                if (filterName.includes('genre=')) {
                    filterName = filterName.split('genre=')[1];
                }
                
                // Trova il canale specifico
                const specificChannel = channels.find(c => c.name === filterName);
                if (specificChannel) {
                    channelsToQuery = [specificChannel];
                    console.log(`   🎯 Filtro canale specifico: ${specificChannel.name}`);
                } else {
                    console.log(`   ❌ Canale non trovato: ${filterName}`);
                    return res.json({ metas: [] });
                }
            }
            
            try {
                const extractionLimit = config.extractionLimit || 25;
                const videosPerChannel = Math.ceil(extractionLimit / channelsToQuery.length);
                
                console.log(`   🎯 Limite totale: ${extractionLimit}`);
                console.log(`   📊 Video per canale: ${videosPerChannel}`);
                
                // Recupera video da tutti i canali da interrogare
                const channelVideoPromises = channelsToQuery.map(async (channel) => {
                    try {
                        console.log(`   🔍 Recupero video da: ${channel.name}`);
                        
                        // Ottieni l'ID del canale
                        const channelId = await getChannelIdFromInput({ apiKey: config.apiKey, input: channel.url });
                        if (!channelId) {
                            console.log(`   ❌ Impossibile ottenere ID per: ${channel.name}`);
                            return [];
                        }
                        
                        // Recupera i video più recenti
                        const videos = await fetchChannelLatestVideos({ 
                            apiKey: config.apiKey, 
                            channelId, 
                            maxResults: videosPerChannel 
                        });
                        
                        console.log(`   ✅ ${videos.length} video da ${channel.name}`);
                        return videos;
                        
                    } catch (error) {
                        console.log(`   ❌ Errore per canale ${channel.name}:`, error.message);
                        return [];
                    }
                });
                
                // Attendi tutti i risultati
                const allChannelVideos = await Promise.all(channelVideoPromises);
                
                // Unisci e mescola i video di tutti i canali
                const allVideos = allChannelVideos.flat();
                
                // Ordina per data di pubblicazione (più recenti primi)
                allVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
                
                // Limita al numero totale richiesto
                const finalVideos = allVideos.slice(0, extractionLimit);
                
                console.log(`✅ YouTube Discover: ${finalVideos.length} video totali da ${channelsToQuery.length} canali`);
                
                // Crea i meta objects come per la ricerca (tipo movie, non episode)
                const metas = finalVideos.map(video => ({
                    id: `yt_${video.id}`,
                    type: 'channel',  // ✅ Consistente con la ricerca
                    name: video.title,
                    description: video.description,
                    poster: video.thumbnail,
                    posterShape: 'landscape',
                    logo: video.channelThumbnail,
                    background: video.thumbnail,
                    genre: ['YouTube', video.channelTitle],  // Include il nome del canale
                    releaseInfo: video.duration || 'YouTube',
                    director: video.channelTitle,
                    cast: [video.channelTitle],
                    country: 'YouTube',
                    language: 'it',
                    subtitles: [],
                    year: new Date(video.publishedAt).getFullYear(),
                    released: video.publishedAt,
                    links: [
                        {
                            name: 'YouTube',
                            category: 'watch',
                            url: `https://www.youtube.com/watch?v=${video.id}`
                        }
                    ]
                }));
                
                // Log dei primi 3 video per debug
                metas.slice(0, 3).forEach((meta, i) => {
                    console.log(`   Video ${i + 1}. ${meta.name} (${meta.id})`);
                    console.log(`      Canale: ${meta.director}`);
                    console.log(`      Data: ${meta.releaseInfo}`);
                });
                
                res.json({ metas });
                
            } catch (error) {
                console.error('❌ Errore nel recupero video YouTube Discover:', error.message);
                res.json({ metas: [] });
            }
            
        } else {
            console.log(`⚠️ Catalog endpoint non riconosciuto: ${type}/${id}`);
            res.json({ metas: [] });
        }
        
    } catch (error) {
        console.error('❌ Errore generale nel catalog:', error.message);
        res.status(500).json({ error: 'Errore nel catalogo' });
    }
});

// Endpoint per ottenere informazioni sullo stream (con formati dinamici)
app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        
        // Estrai videoId dall'id (rimuovi prefisso yt_ se presente)
        let videoId = id;
        if (id.startsWith('yt_')) {
            videoId = id.substring(3);
        }
        
        console.log(`🎬 Stream request per video: ${videoId}`);
        console.log(`   Tipo: ${type}, ID: ${id}`);
        console.log(`   URL completo: ${req.originalUrl}`);
        
        // Inizializza configurazione con valori di default
        let config = { 
            apiKey: '', 
            channels: [], 
            extractionLimit: 25, 
            searchMode: 'api', 
            streamMode: 'simple' 
        };
        
        // Leggi configurazione da query parameters
        if (req.query.config) {
            try {
                const configJson = Buffer.from(req.query.config, 'base64').toString('utf8');
                const configData = JSON.parse(configJson);
                
                config.apiKey = configData.apiKey || '';
                config.channels = Array.isArray(configData.channels) ? configData.channels : [];
                config.extractionLimit = configData.extractionLimit || 25;
                config.searchMode = configData.searchMode || 'api';
                config.streamMode = configData.streamMode || 'simple';
            } catch (error) {
                console.log(`   ❌ Errore parsing configurazione:`, error.message);
                // Usa configurazione di default
            }
        }
        
        console.log(`   🔧 Modalità stream: ${config.streamMode}`);
        
        // Rileva automaticamente baseUrl dalla richiesta
        const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const host = req.get('x-forwarded-host') || req.get('host');
        const baseUrl = `${protocol}://${host}`;
        
        // Passa i parametri di configurazione al proxy
        const queryString = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
        
        // Modalità Semplice: Solo formato massima qualità
        if (config.streamMode === 'advanced') {
            console.log(`   🔍 Modalità Avanzata - Recupero formati disponibili per ${videoId}...`);
        } else {
            console.log(`   ⚡ Modalità Semplice - Solo massima qualità per ${videoId}`);
            
            // Restituisce solo il formato massima qualità
            const bestUrl = queryString ? 
                `${baseUrl}/proxy-best/${type}/${id}?${queryString}` : 
                `${baseUrl}/proxy-best/${type}/${id}`;

            console.log(`   👑 Stream massima qualità generato`);
            res.json({
                streams: [{
                    url: bestUrl,
                    title: '👑 Massima Qualità (bestvideo+bestaudio)',
                    ytId: videoId,
                    quality: 'Best',
                    format: 'mp4',
                    formatId: 'bestvideo+bestaudio',
                    resolution: 'Auto',
                    fps: 'Auto',
                    vcodec: 'best',
                    acodec: 'best',
                    filesize: 0
                }]
            });
            return;
        }
        
        try {
            // Interroga yt-dlp per i formati disponibili (solo modalità avanzata)
            const videoInfo = await getVideoFormats(videoId);
            
            if (!videoInfo || !videoInfo.formats) {
                console.log(`   ❌ Nessun formato disponibile per ${videoId}, usando formati legacy`);
                throw new Error('Formati non disponibili');
            }
            
            if (videoInfo.formats.length === 0) {
                console.log(`   ⚠️ Lista formati vuota per ${videoId}, usando formati legacy`);
                throw new Error('Lista formati vuota');
            }
            
            // Filtra formati utilizzabili secondo la logica yt-dlp
            const availableFormats = videoInfo.formats
                .filter(format => {
                    // Strategia: formati "best" = vcodec!=none AND acodec!=none
                    // Equivalente al filtro yt-dlp [vcodec!=none][acodec!=none]
                    const hasBothVideoAndAudio = (
                        format.vcodec && format.vcodec !== 'none' && format.vcodec !== null &&
                        format.acodec && format.acodec !== 'none' && format.acodec !== null &&
                        format.height >= 240 && // Minima qualità
                        format.url && format.url.length > 0 // URL valido
                    );
                    
                    return hasBothVideoAndAudio;
                })
                .sort((a, b) => {
                    // Priorità: 1) MP4 (più compatibili), 2) Risoluzione
                    const aScore = a.ext === 'mp4' ? 2 : 1;
                    const bScore = b.ext === 'mp4' ? 2 : 1;
                    
                    if (aScore !== bScore) return bScore - aScore;
                    return (b.height || 0) - (a.height || 0);
                })
                .slice(0, 6); // Massimo 6 formati di qualità
            
            console.log(`   ✅ ${availableFormats.length} formati video disponibili su ${videoInfo.formats.length} totali`);
            
            if (availableFormats.length === 0) {
                console.log(`   ⚠️ Nessun formato video utilizzabile trovato, dettagli formati disponibili:`);
                videoInfo.formats.slice(0, 5).forEach(f => {
                    console.log(`      - ${f.format_id}: ${f.ext} ${f.width}x${f.height} video:${f.vcodec} audio:${f.acodec}`);
                });
                throw new Error('Nessun formato video utilizzabile');
            }
            
            // Aggiungi formato speciale "Massima Qualità" (bestvideo+bestaudio) come primo elemento
            const maxQualityStream = {
                url: queryString ? 
                    `${baseUrl}/proxy-best/${type}/${id}?${queryString}` : 
                    `${baseUrl}/proxy-best/${type}/${id}`,
                title: '👑 Massima Qualità (bestvideo+bestaudio)',
                ytId: videoId,
                quality: 'Best',
                format: 'mp4',
                formatId: 'bestvideo+bestaudio',
                resolution: 'Auto',
                fps: 'Auto',
                vcodec: 'best',
                acodec: 'best',
                filesize: 0
            };

            // Genera i stream usando URL diretti (no proxy)
            const streams = availableFormats.map((format, index) => {
                // Usa l'URL diretto di YouTube (MP4 o HLS)
                const directUrl = format.url;
                
                // Determina il titolo basato sulla qualità
                let qualityTitle = '';
                let qualityIcon = '';
                if (format.height >= 2160) {
                    qualityTitle = '4K';
                    qualityIcon = '👑';
                } else if (format.height >= 1440) {
                    qualityTitle = '1440p';
                    qualityIcon = '💎';
                } else if (format.height >= 1080) {
                    qualityTitle = '1080p';
                    qualityIcon = '🎬';
                } else if (format.height >= 720) {
                    qualityTitle = '720p';
                    qualityIcon = '📺';
                } else if (format.height >= 480) {
                    qualityTitle = '480p';
                    qualityIcon = '📱';
                } else {
                    qualityTitle = `${format.height}p`;
                    qualityIcon = '📱';
                }
                
                // Informazioni aggiuntive sul formato
                // Tutti i formati filtrati hanno video+audio garantiti (vcodec!=none AND acodec!=none)
                const codec = format.vcodec ? format.vcodec.split('.')[0].toUpperCase() : 'MP4';
                const isMP4 = format.ext === 'mp4';
                const isHLS = format.protocol === 'm3u8_native';
                const streamType = isMP4 ? ' 🎵' : isHLS ? ' 🎵📡' : ' 🎵📹';
                
                return {
                    url: directUrl,
                    title: `${qualityIcon} ${qualityTitle} ${codec}${streamType}`,
                    ytId: videoId,
                    quality: qualityTitle,
                    format: format.ext || 'mp4',
                    formatId: format.format_id,
                    resolution: `${format.width || '?'}x${format.height || '?'}`,
                    fps: format.fps || 30,
                    vcodec: format.vcodec || 'unknown',
                    acodec: format.acodec || 'audio',
                    filesize: format.filesize || 0
                };
            });
            
            // Combina formato massima qualità + formati diretti
            const allStreams = [maxQualityStream, ...streams];
            
            // Log dei formati per debug
            allStreams.slice(0, 4).forEach((stream, i) => {
                console.log(`   ${i + 1}. ${stream.title}`);
                console.log(`      Format ID: ${stream.formatId}, Resolution: ${stream.resolution}`);
            });
            
            res.json({ streams: allStreams });
            
        } catch (formatError) {
            console.error(`   ❌ Errore recupero formati per ${videoId}:`, formatError.message);
            
            // Fallback ai 3 formati fissi se yt-dlp fallisce
            console.log(`   🔄 Fallback ai formati fissi per ${videoId}`);
            
            const proxyUrl = queryString ? 
                `${baseUrl}/proxy/${type}/${id}?${queryString}` : 
                `${baseUrl}/proxy/${type}/${id}`;
            const url720 = queryString ? 
                `${baseUrl}/proxy-720/${type}/${id}?${queryString}` : 
                `${baseUrl}/proxy-720/${type}/${id}`;
            const url360 = queryString ? 
                `${baseUrl}/proxy-360/${type}/${id}?${queryString}` : 
                `${baseUrl}/proxy-360/${type}/${id}`;
            
            // Aggiungi anche il formato massima qualità nel fallback
            const bestUrl = queryString ? 
                `${baseUrl}/proxy-best/${type}/${id}?${queryString}` : 
                `${baseUrl}/proxy-best/${type}/${id}`;

            res.json({
                streams: [
                    {
                        url: bestUrl,
                        title: '👑 Massima Qualità (bestvideo+bestaudio)',
                        ytId: videoId,
                        quality: 'Best',
                        format: 'mp4'
                    },
                    {
                        url: proxyUrl,
                        title: '🎬 Alta Qualità (legacy)',
                        ytId: videoId,
                        quality: 'Auto',
                        format: 'mp4'
                    },
                    {
                        url: url720,
                        title: '📺 Media Qualità (legacy)',
                        ytId: videoId,
                        quality: 'Auto',
                        format: 'mp4'
                    },
                    {
                        url: url360,
                        title: '📱 Bassa Qualità (legacy)',
                        ytId: videoId,
                        quality: 'Auto',
                        format: 'mp4'
                    }
                ]
            });
        }
        
    } catch (error) {
        console.error('Stream endpoint error:', error.message);
        res.status(500).json({ error: 'Errore nel recupero dello stream' });
    }
});

// Endpoint per i metadati dei video (NUOVO - richiesto da Stremio)
app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        
        // Estrai videoId dall'id (rimuovi prefisso yt_ se presente)
        let videoId = id;
        if (id.startsWith('yt_')) {
            videoId = id.substring(3);
        }
        
        console.log(`Meta request per video: ${videoId}`);
        console.log(`   Tipo: ${type}, ID: ${id}`);
        console.log(`   URL completo: ${req.originalUrl}`);
        
        // Inizializza configurazione
        let config = { apiKey: '', channels: [], extractionLimit: 25 };
        
        // Prima prova a leggere dalla query string corrente
        if (req.query.config) {
            try {
                const configJson = Buffer.from(req.query.config, 'base64').toString('utf8');
                const configData = JSON.parse(configJson);
                
                console.log(`   ✅ Configurazione base64 decodificata diretta`);
                
                if (configData.apiKey) {
                    config.apiKey = configData.apiKey;
                }
                
                if (configData.channels && Array.isArray(configData.channels)) {
                    config.channels = configData.channels.map(url => ({
                        url,
                        name: extractChannelNameFromUrl(url)
                    }));
                }
                
                if (configData.extractionLimit && typeof configData.extractionLimit === 'number') {
                    config.extractionLimit = Math.max(5, Math.min(50, configData.extractionLimit));
                }
            } catch (decodeError) {
                console.log(`   ❌ Errore decodifica base64 diretta:`, decodeError.message);
            }
        }
        
        // Leggi i parametri di configurazione dall'URL del manifest
        const manifestUrl = req.get('Referer') || req.headers.referer || '';
        
        console.log(`   📋 Manifest URL: ${manifestUrl}`);
        
        try {
            // Estrai parametri dall'URL del manifest
            if (manifestUrl.includes('manifest.json')) {
                const urlObj = new URL(manifestUrl);
                
                // Prima prova a decodificare configurazione base64
                const configParam = urlObj.searchParams.get('config');
                if (configParam) {
                    try {
                        const configJson = Buffer.from(configParam, 'base64').toString('utf8');
                        const configData = JSON.parse(configJson);
                        
                        if (configData.apiKey) {
                            config.apiKey = configData.apiKey;
                        }
                        
                        if (configData.channels && Array.isArray(configData.channels)) {
                            config.channels = configData.channels.map(url => ({
                                url,
                                name: extractChannelNameFromUrl(url)
                            }));
                        }
                        
                        if (configData.extractionLimit && typeof configData.extractionLimit === 'number') {
                            config.extractionLimit = Math.max(5, Math.min(50, configData.extractionLimit));
                        }
                    } catch (decodeError) {
                        console.log('   ❌ Errore decodifica base64 in meta:', decodeError.message);
                    }
                } else {
                    // Fallback per formato legacy (parametri URL diretti)
                    const apiKey = urlObj.searchParams.get('apiKey');
                    const channelsParam = urlObj.searchParams.get('channels');
                    
                    if (apiKey) {
                        config.apiKey = apiKey;
                    }
                    
                    if (channelsParam) {
                        const channelUrls = channelsParam.split('\n').map(url => url.trim()).filter(url => url.length > 0);
                        config.channels = channelUrls.map(url => ({ 
                            url, 
                            name: extractChannelNameFromUrl(url) 
                        }));
                    }
                }
            }
        } catch (error) {
            console.log('Fallback to server config for meta');
            // Fallback alla configurazione del server se non riesci a leggere dall'URL
            config = loadConfig();
        }
        
        console.log(`   🔑 API Key estratta: ${config.apiKey ? 'Sì' : 'No'}`);
        console.log(`   📺 Canali estratti: ${config.channels.length}`);
        console.log(`   🎯 Limite estratto: ${config.extractionLimit}`);
        
        if (!config.apiKey) {
            console.log(`   ❌ Meta fallisce: API Key non configurata`);
            return res.status(400).json({ error: 'API Key non configurata' });
        }
        
        try {
            // Usa l'API YouTube per ottenere i metadati (più veloce e affidabile)
            const { getVideoMetadata } = require('./lib/youtube.js');
            
            if (config.apiKey) {
                const videoInfo = await getVideoMetadata(config.apiKey, videoId);
                
                // Se API YouTube restituisce null, usa fallback
                if (!videoInfo) {
                    console.log(`API YouTube fallita per ${videoId}, uso fallback semplice`);
                } else {
                    // Costruisci i metadati nel formato richiesto da Stremio
                    const meta = {
                        id: `yt_${videoId}`,
                        type: 'channel',
                        name: videoInfo.title || `Video ${videoId}`,
                        description: videoInfo.description || 'Video YouTube',
                        poster: videoInfo.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        posterShape: 'landscape',
                        logo: videoInfo.channelThumbnail || videoInfo.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        background: videoInfo.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        genre: ['YouTube'],
                        releaseInfo: videoInfo.duration || 'YouTube',
                        director: [videoInfo.channelTitle || 'YouTube'],
                        cast: [videoInfo.channelTitle || 'YouTube'],
                        country: 'YouTube',
                        language: 'it',
                        subtitles: [],
                        year: new Date(videoInfo.publishedAt).getFullYear(),
                        released: videoInfo.publishedAt,
                        runtime: videoInfo.duration,
                        links: [
                            {
                                name: 'YouTube',
                                category: 'watch',
                                url: `https://www.youtube.com/watch?v=${videoId}`
                            }
                        ],
                        // Metadati aggiuntivi specifici di YouTube
                        _yt: {
                            videoId: videoId,
                            channelId: videoInfo.channel_id,
                            viewCount: videoInfo.view_count,
                            likeCount: videoInfo.like_count,
                            uploadDate: videoInfo.upload_date,
                            duration: videoInfo.duration_string,
                            tags: videoInfo.tags || [],
                            categories: videoInfo.categories || [],
                            formats: videoInfo.formats ? videoInfo.formats.length : 0
                        }
                    };
                    
                    res.json({ meta });
                    return;
                }
            } else {
                console.log('yt-dlp non disponibile, uso fallback API YouTube');
            }
            
        } catch (error) {
            console.error('Meta error with yt-dlp:', error.message);
            
            // Fallback: prova a usare l'API di YouTube se yt-dlp fallisce
            try {
                const { searchVideoById } = require('./lib/youtube');
                
                // Cerca il video specifico usando l'API di YouTube
                const video = await searchVideoById({ 
                    apiKey: config.apiKey, 
                    videoId: videoId
                });
                
                if (video) {
                    const meta = {
                        id: `yt_${videoId}`,
                        type: 'channel',
                        name: video.title || `Video ${videoId}`,
                        description: video.description || 'Video YouTube',
                        poster: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        posterShape: 'landscape',
                        logo: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        background: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        genre: ['YouTube'],
                        releaseInfo: video.duration || 'YouTube',
                        director: video.channelTitle || 'YouTube',
                        cast: [video.channelTitle || 'YouTube'],
                        country: 'YouTube',
                        language: 'it',
                        subtitles: [],
                        year: video.publishedAt ? new Date(video.publishedAt).getFullYear() : new Date().getFullYear(),
                        released: video.publishedAt || new Date().toISOString().split('T')[0],
                        links: [
                            {
                                name: 'YouTube',
                                category: 'watch',
                                url: `https://www.youtube.com/watch?v=${videoId}`
                            }
                        ]
                    };
                    
                    res.json({ meta });
                } else {
                    // Se non troviamo nulla, restituisci metadati minimi
                    const fallbackMeta = {
                        id: `yt_${videoId}`,
                        type: 'channel',
                        name: `Video YouTube ${videoId}`,
                        description: 'Video YouTube',
                        poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        posterShape: 'landscape',
                        logo: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        background: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        genre: ['YouTube'],
                        releaseInfo: 'YouTube',
                        director: 'YouTube',
                        cast: ['YouTube'],
                        country: 'YouTube',
                        language: 'it',
                        subtitles: [],
                        year: new Date().getFullYear(),
                        released: new Date().toISOString().split('T')[0],
                        links: [
                            {
                                name: 'YouTube',
                                category: 'watch',
                                url: `https://www.youtube.com/watch?v=${videoId}`
                            }
                        ]
                    };
                    
                    res.json({ meta: fallbackMeta });
                }
                
            } catch (ytError) {
                console.error('Meta fallback error:', ytError.message);
                
                // Ultimo fallback: metadati minimi
                const minimalMeta = {
                    id: `yt_${videoId}`,
                    type: 'channel',
                    name: `Video YouTube ${videoId}`,
                    description: 'Video YouTube',
                    poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    posterShape: 'landscape',
                    logo: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    background: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    genre: ['YouTube'],
                    releaseInfo: 'YouTube',
                    director: 'YouTube',
                    cast: ['YouTube'],
                    country: 'YouTube',
                    language: 'it',
                    subtitles: [],
                    year: new Date().getFullYear(),
                    released: new Date().toISOString().split('T')[0],
                    links: [
                        {
                            name: 'YouTube',
                            category: 'watch',
                            url: `https://www.youtube.com/watch?v=${videoId}`
                        }
                    ]
                };
                
                res.json({ meta: minimalMeta });
            }
        }
        
    } catch (error) {
        console.error('Meta endpoint error:', error.message);
        res.status(500).json({ error: 'Errore nel recupero dei metadati' });
    }
});

// Endpoint per massima qualità (bestvideo+bestaudio)
app.get('/proxy-best/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const videoId = id.startsWith('yt_') ? id.substring(3) : id;
        
        console.log(`🎯 Massima qualità richiesta per video: ${videoId}`);
        console.log(`   Tipo: ${type}, ID: ${id}`);
        console.log(`   URL completo: ${req.originalUrl}`);
        console.log(`   User-Agent: ${req.get('User-Agent')}`);
        console.log(`   Accept: ${req.get('Accept')}`);
        console.log(`   🏆 Qualità richiesta: bestvideo+bestaudio`);

        const videoStream = await createVideoStreamWithQuality(videoId, 'bestvideo+bestaudio');
        videoStream.pipe(res);
    } catch (error) {
        console.error('Proxy best error:', error.message);
        res.status(500).send('Errore nel proxy streaming massima qualità');
    }
});

// Endpoint proxy per formato specifico (NUOVO)
app.get('/proxy-format/:type/:id/:formatId', async (req, res) => {
    const { formatId } = req.params;
    console.log(`🎯 Streaming formato specifico: ${formatId}`);
    return handleProxyStream(req, res, formatId);
});

// Endpoint proxy per diverse qualità (LEGACY - mantenuti per compatibilità)
app.get('/proxy-360/:type/:id', async (req, res) => {
    return handleProxyStream(req, res, 'bv*[height<=360]+ba/b[height<=360]/worst+ba/worst');
});

app.get('/proxy-720/:type/:id', async (req, res) => {
    return handleProxyStream(req, res, 'bv*[height<=720][height>360]+ba/b[height<=720][height>360]/bv*[height<=720]+ba/b[height<=720]');
});

// Nuovo endpoint per streaming proxy diretto (qualità massima ≥1080p)  
app.get('/proxy/:type/:id', async (req, res) => {
    return handleProxyStream(req, res, 'bv*[height>=720]+ba/b[height>=720]/bv*+ba/b');
});

// Funzione condivisa per gestire il proxy streaming
async function handleProxyStream(req, res, quality) {
    try {
        const { type, id } = req.params;
        
        // Estrai videoId dall'id (rimuovi prefisso yt_ se presente)
        let videoId = id;
        if (id.startsWith('yt_')) {
            videoId = id.substring(3);
        }
        
        console.log(`Proxy stream request per video: ${videoId}`);
        console.log(`   Tipo: ${type}, ID: ${id}`);
        console.log(`   URL completo: ${req.originalUrl}`);
        console.log(`   User-Agent: ${req.get('User-Agent') || 'N/A'}`);
        console.log(`   Accept: ${req.get('Accept') || 'N/A'}`);
        console.log(`   🎯 Qualità richiesta: ${quality}`);
        
        // Imposta gli header per lo streaming video
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Crea lo stream del video con qualità specifica
        const videoStream = await createVideoStreamWithQuality(videoId, quality);
        
        // Gestisci gli errori dello stream con migliore logging
        videoStream.on('error', (error) => {
            if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
                console.log(`🔌 Cliente disconnesso durante streaming per ${videoId}: ${error.code}`);
            } else {
                console.error(`❌ Video stream error per ${videoId}:`, error.message);
            }
            
            if (!res.headersSent) {
                res.status(500).json({ error: 'Errore nello streaming del video' });
            } else {
                res.end();
            }
        });
        
        // Gestisci la chiusura della connessione client
        req.on('close', () => {
            console.log(`🔌 Client disconnesso per video: ${videoId}`);
            if (videoStream && typeof videoStream.destroy === 'function') {
                videoStream.destroy();
            }
        });

        req.on('aborted', () => {
            console.log(`⏹️  Richiesta annullata per video: ${videoId}`);
            if (videoStream && typeof videoStream.destroy === 'function') {
                videoStream.destroy();
            }
        });
        
        // Gestisci errori nella pipe
        res.on('error', (error) => {
            if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
                console.log(`🔌 Connessione interrotta per ${videoId}: ${error.code}`);
            } else {
                console.error(`❌ Response error per ${videoId}:`, error.message);
            }
        });
        
        // Inoltra lo stream alla risposta
        videoStream.pipe(res);
        console.log(`🎬 Stream avviato per ${videoId} - Client connesso`);
        
        // Gestisci la fine della risposta
        res.on('finish', () => {
            console.log(`✅ Stream completato per ${videoId} - Risposta inviata`);
        });
        
    } catch (error) {
        console.error('Proxy stream error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Errore nell\'avvio dello stream' });
        }
    }
}

// Admin API
app.get('/api/config', (req, res) => {
	res.json(loadConfig());
});

app.get('/api/channels', (req, res) => {
	const config = loadConfig();
	const channels = config.channels || [];
	res.json({ channels: channels.map(c => ({ name: c.name, url: c.url })) });
});



// Endpoint per verificare la quota API rapido (consumo minimo)
app.post('/api/check-quota', async (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!apiKey || apiKey.trim() === '') {
            return res.json({
                valid: false,
                message: 'API Key non fornita'
            });
        }
        
        const quotaStatus = await checkApiQuotaStatus(apiKey.trim());
        res.json(quotaStatus);
        
    } catch (error) {
        console.error('Quota check error:', error.message);
        res.json({
            valid: false,
            message: 'Errore interno del server',
            error: 'INTERNAL_ERROR'
        });
    }
});

// Endpoint per verificare l'API Key YouTube
app.post('/api/verify-api-key', async (req, res) => {
    try {
        const { apiKey } = req.body;
        
        if (!apiKey || apiKey.trim() === '') {
            return res.json({
                valid: false,
                message: 'API Key non fornita'
            });
        }
        
        // Testa l'API Key con una richiesta che ci dia più informazioni
        const https = require('https');
        const testUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&type=video&key=${apiKey.trim()}`;
        
        const testAPIKey = () => {
            return new Promise((resolve, reject) => {
                https.get(testUrl, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => {
                        try {
                            const result = JSON.parse(data);
                            
                            if (response.statusCode === 200 && result.items) {
                                // API Key valida
                                const quotaInfo = {
                                    valid: true,
                                    message: 'API Key valida e funzionante',
                                    quota: `Quota utilizzata: ~1 unità per questa verifica`,
                                    details: {
                                        resultsFound: result.items.length,
                                        totalResults: result.pageInfo?.totalResults || 0,
                                        quotaCost: 'Search: 100 unità per 1000 richieste'
                                    }
                                };
                                resolve(quotaInfo);
                            } else if (response.statusCode === 403) {
                                // Errore di quota o API Key
                                if (result.error?.errors?.[0]?.reason === 'quotaExceeded') {
                                    resolve({
                                        valid: false,
                                        message: 'Quota API esaurita per oggi',
                                        quota: 'Quota giornaliera: 0/10,000 unità rimaste'
                                    });
                                } else if (result.error?.errors?.[0]?.reason === 'keyInvalid') {
                                    resolve({
                                        valid: false,
                                        message: 'API Key non valida',
                                        quota: 'API Key non riconosciuta da Google'
                                    });
                                } else {
                                    resolve({
                                        valid: false,
                                        message: result.error?.message || 'Errore API Key',
                                        quota: 'Accesso negato'
                                    });
                                }
                            } else {
                                resolve({
                                    valid: false,
                                    message: `Errore HTTP ${response.statusCode}`,
                                    quota: 'Stato sconosciuto'
                                });
                            }
                        } catch (parseError) {
                            reject(parseError);
                        }
                    });
                }).on('error', reject);
            });
        };
        
        const result = await testAPIKey();
        res.json(result);
        
    } catch (error) {
        console.error('API Key verification error:', error.message);
        res.json({
            valid: false,
            message: 'Errore interno del server',
            quota: 'Impossibile verificare lo stato'
        });
    }
});

app.post('/api/config', async (req, res) => {
    const { apiKey, channels, extractionLimit, searchMode, streamMode } = req.body || {};
    const providedApiKey = String(apiKey || '').trim();
    const providedLimit = Math.max(5, Math.min(50, parseInt(extractionLimit) || 25));

    function deriveNameFromUrl(url) {
        try {
            const u = new URL(url);
            const h = u.pathname.match(/@([A-Za-z0-9._-]+)/);
            if (h) return `@${h[1]}`;
            const c = u.pathname.match(/channel\/([A-Za-z0-9_-]+)/);
            if (c) return c[1];
            return u.hostname.replace(/^www\./, '');
        } catch {
            return url;
        }
    }

    const baseSanitized = Array.isArray(channels)
        ? channels
            .filter((c) => c && (c.url || c.name))
            .map((c) => {
                const url = String(c.url || '').trim();
                const name = String(c.name || '').trim() || deriveNameFromUrl(url);
                return { name, url };
            })
        : [];

    // Enrich channels with channelId and official title when possibile
    const enriched = [];
    for (const ch of baseSanitized) {
        let channelId = undefined;
        let name = ch.name;
        if (providedApiKey && ch.url) {
            try {
                channelId = await getChannelIdFromInput({ apiKey: providedApiKey, input: ch.url });
                if (channelId) {
                    const meta = await fetchChannelTitleAndThumb({ apiKey: providedApiKey, channelId });
                    if (meta.channelTitle) name = meta.channelTitle;
                }
            } catch {}
        }
        enriched.push({ name, url: ch.url, channelId });
    }

    const conf = { 
        apiKey: providedApiKey, 
        channels: enriched, 
        extractionLimit: providedLimit,
        searchMode: searchMode || 'api',
        streamMode: streamMode || 'simple'
    };
    saveConfig(conf);
    res.json(conf);
});

// Endpoint per configurazione tramite URL codificato
app.get('/configure', (req, res) => {
    try {
        // Estrai i parametri dalla query string
        const { apiKey, channels } = req.query;
        
        if (!apiKey) {
            return res.status(400).json({ error: 'API Key richiesta' });
        }
        
        // Costruisci la configurazione
        const config = {
            apiKey: apiKey,
            channels: channels ? channels.split('\n').map(url => url.trim()).filter(url => url.length > 0).map(url => ({ 
                url, 
                name: extractChannelNameFromUrl(url) 
            })) : []
        };
        
        // Genera l'URL di configurazione codificato
        const configParams = new URLSearchParams();
        configParams.set('apiKey', config.apiKey);
        if (config.channels.length > 0) {
            const channelsData = config.channels.map(ch => ch.url).join('\n');
            configParams.set('channels', channelsData);
        }
        
        // Rileva automaticamente baseUrl dalla richiesta
        const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const host = req.get('x-forwarded-host') || req.get('host');
        const baseUrl = `${protocol}://${host}`;
        const configUrl = `${baseUrl}/configure?${configParams.toString()}`;
        
        // Codifica l'URL in base64
        const encodedConfig = Buffer.from(configUrl).toString('base64');
        const finalConfigUrl = `${baseUrl}/${encodedConfig}/configure`;
        
        // Genera anche l'URL del manifest con i parametri
        const manifestParams = new URLSearchParams();
        manifestParams.set('apiKey', config.apiKey);
        if (config.channels.length > 0) {
            const channelsData = config.channels.map(ch => ch.url).join('\n');
            manifestParams.set('channels', channelsData);
        }
        
        const manifestUrl = `${baseUrl}/manifest.json?${manifestParams.toString()}`;
        
        res.json({
            success: true,
            config: config,
            urls: {
                config: finalConfigUrl,
                manifest: manifestUrl,
                base64: encodedConfig
            }
        });
        
    } catch (error) {
        console.error('Configure error:', error.message);
        res.status(500).json({ error: 'Errore nella generazione della configurazione' });
    }
});

// Endpoint per configurazione tramite URL codificato in base64
app.get('/:encodedConfig/configure', (req, res) => {
    try {
        const { encodedConfig } = req.params;
        
        // Decodifica l'URL di configurazione
        const decodedUrl = Buffer.from(encodedConfig, 'base64').toString('utf-8');
        const urlObj = new URL(decodedUrl);
        
        // Estrai i parametri
        const apiKey = urlObj.searchParams.get('apiKey');
        const channelsParam = urlObj.searchParams.get('channels');
        
        if (!apiKey) {
            return res.status(400).json({ error: 'API Key non valida' });
        }
        
        // Costruisci la configurazione
        const config = {
            apiKey: apiKey,
            channels: channelsParam ? channelsParam.split('\n').map(url => url.trim()).filter(url => url.length > 0).map(url => ({ 
                url, 
                name: extractChannelNameFromUrl(url) 
            })) : []
        };
        
        // Genera l'URL del manifest con i parametri
        const manifestParams = new URLSearchParams();
        manifestParams.set('apiKey', config.apiKey);
        if (config.channels.length > 0) {
            const channelsData = config.channels.map(ch => ch.url).join('\n');
            manifestParams.set('channels', channelsData);
        }
        
        // Rileva automaticamente baseUrl dalla richiesta
        const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const host = req.get('x-forwarded-host') || req.get('host');
        const baseUrl = `${protocol}://${host}`;
        const manifestUrl = `${baseUrl}/manifest.json?${manifestParams.toString()}`;
        
        // Restituisci solo i dati JSON, non l'interfaccia HTML
        res.json({
            success: true,
            config: config,
            urls: {
                config: finalConfigUrl,
                manifest: manifestUrl,
                base64: encodedConfig
            }
        });
        
    } catch (error) {
        console.error('Encoded config error:', error.message);
        res.status(500).json({ error: 'Errore nella decodifica della configurazione' });
    }
});

// Admin UI
// Funzione per generare HTML del frontend
function buildFrontendHTML(req = null) {
    // Rileva automaticamente baseUrl dalla richiesta se disponibile
    let baseUrl = 'http://localhost:3100'; // fallback
    if (req) {
        const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
        const host = req.get('x-forwarded-host') || req.get('host');
        baseUrl = `${protocol}://${host}`;
    }
    return `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OMG YouTube - Configurazione Addon Stremio</title>
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="shortcut icon" href="/favicon.ico">
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #ff6b6b, #ee5a24);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
            font-size: 1.1em;
        }
        .content {
            padding: 30px;
        }
        .form-group {
            margin-bottom: 25px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #555;
        }
        input[type="text"], textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s ease;
            box-sizing: border-box;
        }
        input[type="text"]:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        textarea {
            min-height: 120px;
            resize: vertical;
            font-family: monospace;
        }
        .btn {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            margin-right: 10px;
            margin-bottom: 10px;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
            background: linear-gradient(135deg, #95a5a6, #7f8c8d);
        }
        .btn-success {
            background: linear-gradient(135deg, #27ae60, #2ecc71);
        }
        .url-display {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 15px;
            margin: 15px 0;
            font-family: monospace;
            word-break: break-all;
            position: relative;
        }
        .url-display h4 {
            margin: 0 0 10px 0;
            color: #495057;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .url-display .url {
            background: white;
            padding: 10px;
            border-radius: 5px;
            border: 1px solid #dee2e6;
            margin: 5px 0;
        }
        .copy-btn {
            position: absolute;
            top: 15px;
            right: 15px;
            background: #6c757d;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .copy-btn:hover {
            background: #5a6268;
        }
        .status {
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            font-weight: 500;
        }
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .info-box {
            background: #e3f2fd;
            border: 1px solid #bbdefb;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .info-box h3 {
            margin: 0 0 10px 0;
            color: #1976d2;
        }
        .info-box p {
            margin: 5px 0;
            color: #1565c0;
        }
        .important-note {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .important-note h4 {
            margin: 0 0 10px 0;
            color: #856404;
        }
        .important-note p {
            margin: 5px 0;
            color: #856404;
        }
        .search-mode-section {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .search-mode-section h3 {
            margin: 0 0 15px 0;
            color: #495057;
            font-size: 16px;
        }
        .search-mode-switch {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        .search-mode-switch input[type="radio"] {
            display: none;
        }
        .mode-label {
            flex: 1;
            min-width: 200px;
            padding: 15px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            background: white;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }
        .mode-label:hover {
            border-color: #667eea;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
        }
        .search-mode-switch input[type="radio"]:checked + .mode-label {
            border-color: #667eea;
            background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        }
        .mode-icon {
            font-size: 24px;
            margin-bottom: 8px;
        }
        .mode-title {
            font-weight: 600;
            font-size: 14px;
            color: #495057;
            margin-bottom: 4px;
        }
        .mode-desc {
            font-size: 12px;
            color: #6c757d;
            line-height: 1.3;
        }
        .api-key-section {
            transition: opacity 0.3s ease, height 0.3s ease;
        }
        .api-key-section.hidden {
            opacity: 0.3;
            pointer-events: none;
        }
        
        /* Stili per input con informazioni */
        .input-with-info {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .input-info {
            color: #666;
            font-size: 12px;
            font-style: italic;
        }
        
        /* Stili per radio group */
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .radio-option {
            display: flex;
            flex-direction: column;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            background: #fafafa;
        }
        
        .radio-option:hover {
            border-color: #007bff;
            background: #f0f8ff;
        }
        
        .radio-option input[type="radio"] {
            margin-right: 10px;
            align-self: flex-start;
        }
        
        .radio-option input[type="radio"]:checked + .radio-label {
            color: #007bff;
            font-weight: bold;
        }
        
        .radio-option:has(input[type="radio"]:checked) {
            border-color: #007bff;
            background: #e7f3ff;
        }
        
        .radio-label {
            font-size: 16px;
            display: flex;
            align-items: center;
            margin-bottom: 4px;
        }
        
        .radio-desc {
            color: #666;
            font-size: 12px;
            margin-left: 22px;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎥 OMG YouTube</h1>
            <p>Configurazione Addon Stremio con Streaming Diretto</p>
        </div>
        
        <div class="content">
            <div class="info-box">
                <h3>🚀 Streaming Diretto Implementato</h3>
                <p>Questo addon ora usa yt-dlp per streammare video direttamente a Stremio!</p>
                <p>• Endpoint proxy: <code>http://localhost:3100/proxy</code></p>
                <p>• Streaming in tempo reale senza download</p>
                <p>• Compatibile con tutti i formati YouTube</p>
            </div>

            <div class="search-mode-section">
                <h3>🔧 Modalità di Ricerca</h3>
                <div class="search-mode-switch">
                    <input type="radio" id="mode-api" name="searchMode" value="api" checked>
                    <label for="mode-api" class="mode-label">
                        <span class="mode-icon">🚀</span>
                        <span class="mode-title">YouTube API</span>
                        <span class="mode-desc">Veloce, affidabile, richiede API Key</span>
                    </label>
                    
                    <input type="radio" id="mode-ytdlp" name="searchMode" value="ytdlp">
                    <label for="mode-ytdlp" class="mode-label">
                        <span class="mode-icon">🔍</span>
                        <span class="mode-title">yt-dlp Search</span>
                        <span class="mode-desc">Gratuito, più lento, nessuna API Key</span>
                    </label>
                </div>
            </div>

            <div id="api-status" class="info-box">
                <h3>🔑 Stato API Key</h3>
                <p>Caricamento stato...</p>
            </div>

            <div class="important-note">
                <h4>⚠️ IMPORTANTE: Sistema URL Configurazione Base64</h4>
                <p>Questo addon usa un sistema di configurazione codificato in base64 per la condivisione.</p>
                <p><strong>Per condividere:</strong> Genera l'URL di configurazione codificato</p>
                <p><strong>Per installare:</strong> Usa l'URL del manifest generato dinamicamente</p>
            </div>

            <form id="configForm">
                <div class="form-group api-key-section" id="apiKeySection">
                    <label for="apiKey">🔑 API Key Google YouTube:</label>
                    <input type="text" id="apiKey" name="apiKey" value="" placeholder="Inserisci la tua API Key di Google YouTube">
                </div>
                
                <div class="form-group">
                    <label for="channels">📺 Canali YouTube Seguiti (uno per riga):</label>
                    <textarea id="channels" name="channels" placeholder="Inserisci un link per riga ai canali YouTube che vuoi seguire&#10;Esempio:&#10;https://www.youtube.com/@RaffaeleGaito&#10;https://www.youtube.com/@nomecanale"></textarea>
                </div>
                
                <div class="form-group">
                    <label for="extractionLimit">🎯 Limite di Estrazione:</label>
                    <div class="input-with-info">
                        <input type="number" id="extractionLimit" name="extractionLimit" value="25" min="5" max="50" placeholder="25">
                        <small class="input-info">
                            Numero massimo di video per ricerca e per stagione nei canali (5-50)
                        </small>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>🎬 Modalità Stream:</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="streamMode" value="simple" checked>
                            <span class="radio-label">⚡ Semplice</span>
                            <small class="radio-desc">Solo massima qualità (bestvideo+bestaudio) - Più veloce</small>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="streamMode" value="advanced">
                            <span class="radio-label">🔧 Avanzata</span>
                            <small class="radio-desc">Tutti i formati disponibili - Scelta completa</small>
                        </label>
                    </div>
                </div>
                
                <div class="form-group">
                    <button type="submit" class="btn btn-success">💾 Salva Configurazione</button>
                </div>
            </form>
            
            <div id="status"></div>
            
            <div class="url-display">
                <h4>📋 URL Manifest (per Stremio) - DINAMICO</h4>
                <div class="url" id="manifestUrl">${baseUrl}/manifest.json</div>
                <button class="copy-btn" onclick="copyManifest()">Copia</button>
            </div>
            
            <div class="url-display">
                <h4>🔐 URL Configurazione Base64 (per condivisione)</h4>
                <div class="url" id="encodedConfigUrl">Genera configurazione per vedere l'URL</div>
                <button class="copy-btn" onclick="copyEncodedConfigUrl()">Genera & Copia</button>
            </div>
            
            <div class="url-display">
                <h4>🎬 Esempio Endpoint Proxy</h4>
                <div class="url" id="proxyUrl">${baseUrl}/proxy/channel/yt_VIDEO_ID</div>
                <button class="copy-btn" onclick="copyProxyUrl()">Copia</button>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
                <button class="btn btn-success" onclick="installInStremio()">📱 Installa in Stremio</button>
            </div>
        </div>
    </div>

    <script>
        // Variabili globali
        const NEWLINE = '\\u000A';
        
        // Inizializzazione
        document.addEventListener('DOMContentLoaded', function() {
            loadConfig();
            setupEventListeners();
            applyConfigFromUrl();
        });

        // Setup event listeners
        function setupEventListeners() {
            // Form submission
            const form = document.getElementById('configForm');
            if (form) {
                form.addEventListener('submit', function(e) {
                    e.preventDefault();
                    saveConfig();
                });
            }

            // Search mode switch
            const searchModeInputs = document.querySelectorAll('input[name="searchMode"]');
            searchModeInputs.forEach(function(input) {
                input.addEventListener('change', function() {
                    handleSearchModeChange();
                    updateManifestUrl();
                });
            });
            
            // Stream mode switch
            const streamModeInputs = document.querySelectorAll('input[name="streamMode"]');
            streamModeInputs.forEach(function(input) {
                input.addEventListener('change', updateManifestUrl);
            });

            // API Key input with debounce
            const apiKeyInput = document.getElementById('apiKey');
            if (apiKeyInput) {
                apiKeyInput.addEventListener('input', function() {
                    clearTimeout(window.apiKeyTimeout);
                    window.apiKeyTimeout = setTimeout(function() {
                        const selectedMode = document.querySelector('input[name="searchMode"]:checked').value;
                        if (selectedMode === 'api') {
                            checkApiKeyStatus();
                        }
                    }, 1000);
                    updateManifestUrl();
                });
            }

            // Channels input
            const channelsInput = document.getElementById('channels');
            if (channelsInput) {
                channelsInput.addEventListener('input', updateManifestUrl);
            }
            
            // Extraction limit input
            const limitInput = document.getElementById('extractionLimit');
            if (limitInput) {
                limitInput.addEventListener('input', updateManifestUrl);
            }
        }

        // Gestisce il cambio di modalità di ricerca
        function handleSearchModeChange() {
            const selectedMode = document.querySelector('input[name="searchMode"]:checked').value;
            const apiKeySection = document.getElementById('apiKeySection');
            const apiStatusSection = document.getElementById('api-status');
            
            if (selectedMode === 'ytdlp') {
                // Modalità yt-dlp: nascondi sezione API Key
                apiKeySection.classList.add('hidden');
                apiStatusSection.style.display = 'none';
            } else {
                // Modalità API: mostra sezione API Key
                apiKeySection.classList.remove('hidden');
                apiStatusSection.style.display = 'block';
                checkApiKeyStatus();
            }
        }

        // Carica configurazione dal server
        async function loadConfig() {
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const config = await response.json();
                    const apiKeyEl = document.getElementById('apiKey');
                    const channelsEl = document.getElementById('channels');
                    const limitEl = document.getElementById('extractionLimit');
                    
                    if (apiKeyEl) apiKeyEl.value = config.apiKey || '';
                    if (channelsEl && config.channels) {
                        channelsEl.value = config.channels.map(function(ch) { return ch.url; }).join(NEWLINE);
                    }
                    if (limitEl) limitEl.value = config.extractionLimit || 25;
                    
                    // Imposta la modalità di ricerca
                    const searchMode = config.searchMode || 'api';
                    const searchModeEl = document.getElementById(searchMode === 'api' ? 'mode-api' : 'mode-ytdlp');
                    if (searchModeEl) {
                        searchModeEl.checked = true;
                        handleSearchModeChange();
                    }
                    
                    // Imposta la modalità di stream
                    const streamMode = config.streamMode || 'simple';
                    const streamModeEl = document.querySelector('input[name="streamMode"][value="' + streamMode + '"]');
                    if (streamModeEl) {
                        streamModeEl.checked = true;
                    }
                    
                    updateManifestUrl();
                    
                    // Verifica API Key solo se in modalità API
                    if (searchMode === 'api') {
                        checkApiKeyStatus();
                    }
                }
            } catch (error) {
                console.error('Errore caricamento configurazione:', error);
            }
        }

        // Verifica stato API Key
        async function checkApiKeyStatus() {
            const apiKeyInput = document.getElementById('apiKey');
            const statusElement = document.getElementById('api-status');
            
            if (!apiKeyInput || !statusElement) return;
            
            const apiKey = apiKeyInput.value.trim();
            
            if (!apiKey) {
                statusElement.innerHTML = 
                    '<h3>🔑 Stato API Key</h3>' +
                    '<p style="color: #ff6b6b;">❌ Nessuna API Key configurata</p>' +
                    '<p>Inserisci la tua API Key di Google YouTube.</p>';
                return;
            }
            
            statusElement.innerHTML = 
                '<h3>🔑 Stato API Key</h3>' +
                '<p style="color: #ffa500;">🔍 Verifica in corso...</p>';
            
            try {
                const verification = await verifyApiKey(apiKey);
                if (verification.valid) {
                    let quotaText = verification.quota || 'Informazioni quota non disponibili';
                    let detailsText = '';
                    
                    if (verification.details) {
                        detailsText = '<p style="color: #666; font-size: 0.9em;">Risultati trovati: ' + 
                                    verification.details.resultsFound + ' | ' +
                                    verification.details.quotaCost + '</p>';
                    }
                    
                    statusElement.innerHTML = 
                        '<h3>🔑 Stato API Key</h3>' +
                        '<p style="color: #4ecdc4;">✅ API Key valida e funzionante</p>' +
                        '<p style="color: #2ecc71;">' + quotaText + '</p>' +
                        detailsText;
                } else {
                    let quotaText = verification.quota || 'Stato quota sconosciuto';
                    
                    statusElement.innerHTML = 
                        '<h3>🔑 Stato API Key</h3>' +
                        '<p style="color: #ff6b6b;">❌ ' + (verification.message || 'API Key non valida') + '</p>' +
                        '<p style="color: #e74c3c;">' + quotaText + '</p>';
                }
            } catch (error) {
                statusElement.innerHTML = 
                    '<h3>🔑 Stato API Key</h3>' +
                    '<p style="color: #ff6b6b;">❌ Errore nella verifica</p>' +
                    '<p style="color: #e74c3c;">Controlla la connessione di rete.</p>';
            }
        }

        // Verifica API Key
        async function verifyApiKey(apiKey) {
            try {
                const response = await fetch('/api/verify-api-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: apiKey })
                });
                
                if (response.ok) {
                    return await response.json();
                } else {
                    return { valid: false, message: 'Errore verifica' };
                }
            } catch (error) {
                console.error('Errore verifica API:', error);
                return { valid: false, message: 'Errore connessione' };
            }
        }

        // Aggiorna URL manifest
        function updateManifestUrl() {
            const apiKeyEl = document.getElementById('apiKey');
            const channelsEl = document.getElementById('channels');
            const limitEl = document.getElementById('extractionLimit');
            const manifestEl = document.getElementById('manifestUrl');
            
            if (!apiKeyEl || !channelsEl || !limitEl || !manifestEl) return;
            
            const apiKey = apiKeyEl.value.trim();
            const channelsText = channelsEl.value.trim();
            const extractionLimit = parseInt(limitEl.value) || 25;
            const searchMode = document.querySelector('input[name="searchMode"]:checked').value;
            const streamMode = document.querySelector('input[name="streamMode"]:checked').value;
            
            // Crea configurazione per codifica base64
            let manifestUrl = window.location.origin + '/manifest.json';
            
            if (apiKey || channelsText || extractionLimit !== 25 || searchMode !== 'api' || streamMode !== 'simple') {
                const configData = {
                    apiKey: searchMode === 'api' ? apiKey : '',
                    channels: channelsText ? channelsText.split(NEWLINE)
                        .map(function(line) { return line.trim(); })
                        .filter(function(line) { return line.length > 0; }) : [],
                    extractionLimit: extractionLimit,
                    searchMode: searchMode,
                    streamMode: streamMode
                };
                
                // Codifica in base64
                const configJson = JSON.stringify(configData);
                const configBase64 = btoa(unescape(encodeURIComponent(configJson)));
                manifestUrl = window.location.origin + '/manifest.json?config=' + configBase64;
            }
            
            manifestEl.textContent = manifestUrl;
        }

        // Salva configurazione
        async function saveConfig() {
            const apiKey = document.getElementById('apiKey').value.trim();
            const channelsText = document.getElementById('channels').value.trim();
            const extractionLimit = parseInt(document.getElementById('extractionLimit').value) || 25;
            const searchMode = document.querySelector('input[name="searchMode"]:checked').value;
            const streamMode = document.querySelector('input[name="streamMode"]:checked').value;
            
            // Se modalità yt-dlp, non è necessaria API Key
            if (searchMode === 'api' && !apiKey) {
                showStatus('Inserisci API Key di Google YouTube per la modalità API', 'error');
                return;
            }
            
            // Verifica API Key solo se in modalità API
            if (searchMode === 'api') {
                showStatus('🔍 Verifica API Key...', 'info');
                const verification = await verifyApiKey(apiKey);
                
                if (!verification.valid) {
                    showStatus('❌ ' + verification.message, 'error');
                    return;
                }
                
                showStatus('✅ API Key verificata, salvataggio...', 'success');
            } else {
                showStatus('💾 Salvataggio configurazione yt-dlp...', 'info');
            }
            
            const channels = channelsText.split(NEWLINE)
                .map(function(line) { return line.trim(); })
                .filter(function(line) { return line.length > 0; })
                .map(function(url) { 
                    return { url: url, name: extractChannelName(url) }; 
                });
            
            try {
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        apiKey: searchMode === 'api' ? apiKey : '', 
                        channels: channels, 
                        extractionLimit: extractionLimit,
                        searchMode: searchMode,
                        streamMode: streamMode
                    })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.apiKey || result.channels) {
                        showStatus('✅ Configurazione salvata!', 'success');
                        document.getElementById('apiKey').value = result.apiKey || '';
                        if (result.channels) {
                            document.getElementById('channels').value = 
                                result.channels.map(function(ch) { return ch.url; }).join(NEWLINE);
                        }
                        if (result.extractionLimit) {
                            document.getElementById('extractionLimit').value = result.extractionLimit;
                        }
                        updateManifestUrl();
                        checkApiKeyStatus();
                    } else {
                        showStatus('Errore salvataggio', 'error');
                    }
                } else {
                    showStatus('Errore salvataggio', 'error');
                }
            } catch (error) {
                console.error('Errore:', error);
                showStatus('Errore salvataggio', 'error');
            }
        }

        // Estrai nome canale
        function extractChannelName(url) {
            try {
                const urlObj = new URL(url);
                if (urlObj.pathname.includes('@')) {
                    return '@' + urlObj.pathname.split('@')[1];
                } else if (urlObj.pathname.includes('/channel/')) {
                    return 'Channel ' + urlObj.pathname.split('/channel/')[1];
                } else if (urlObj.pathname.includes('/c/')) {
                    return 'Custom ' + urlObj.pathname.split('/c/')[1];
                } else {
                    return urlObj.hostname;
                }
            } catch (error) {
                return url;
            }
        }

        // Mostra stato
        function showStatus(message, type) {
            const statusDiv = document.getElementById('status');
            if (!statusDiv) return;
            
            statusDiv.innerHTML = '<div class="status ' + type + '">' + message + '</div>';
            setTimeout(function() {
                statusDiv.innerHTML = '';
            }, 5000);
        }

        // Copia nel clipboard
        function copyToClipboard(text) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(function() {
                    showStatus('URL copiato!', 'success');
                }).catch(function() {
                    showStatus('Errore copia', 'error');
                });
            } else {
                showStatus('Clipboard non supportato', 'error');
            }
        }

        // Funzioni pulsanti
        function copyManifest() {
            const manifestEl = document.getElementById('manifestUrl');
            if (manifestEl) {
                copyToClipboard(manifestEl.textContent);
            }
        }

        function copyEncodedConfigUrl() {
            const apiKey = document.getElementById('apiKey').value.trim();
            const channelsText = document.getElementById('channels').value.trim();
            
            if (!apiKey) {
                showStatus('Inserisci prima API Key', 'error');
                return;
            }
            
            const baseUrl = window.location.origin;
            const configParams = new URLSearchParams();
            configParams.set('apiKey', apiKey);
            
            if (channelsText) {
                const channels = channelsText.split(NEWLINE)
                    .map(function(line) { return line.trim(); })
                    .filter(function(line) { return line.length > 0; });
                configParams.set('channels', channels.join(NEWLINE));
            }
            
            const configUrl = baseUrl + '/configure?' + configParams.toString();
            
            fetch(configUrl)
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success && data.urls.config) {
                        copyToClipboard(data.urls.config);
                        showStatus('URL configurazione copiato!', 'success');
                        document.getElementById('encodedConfigUrl').textContent = data.urls.config;
                        updateManifestUrl();
                    } else {
                        showStatus('Errore generazione URL', 'error');
                    }
                })
                .catch(function(error) {
                    console.error('Errore:', error);
                    showStatus('Errore generazione URL', 'error');
                });
        }

        function copyProxyUrl() {
            const proxyEl = document.getElementById('proxyUrl');
            if (proxyEl) {
                copyToClipboard(proxyEl.textContent);
            }
        }

        function installInStremio() {
            const manifestEl = document.getElementById('manifestUrl');
            if (!manifestEl) return;
            
            const manifestUrl = manifestEl.textContent;
            const stremioUrl = manifestUrl.replace(/^https?:\\/\\//, 'stremio://');
            window.open(stremioUrl, '_blank');
            showStatus('Apertura Stremio...', 'success');
        }

        // Applica config da URL
        function applyConfigFromUrl() {
            const urlParams = new URLSearchParams(window.location.search);
            const apiKey = urlParams.get('apiKey');
            const channels = urlParams.get('channels');
            
            if (apiKey) {
                const apiKeyEl = document.getElementById('apiKey');
                if (apiKeyEl) apiKeyEl.value = apiKey;
            }
            if (channels) {
                const channelsEl = document.getElementById('channels');
                if (channelsEl) channelsEl.value = channels;
            }
            
            updateManifestUrl();
        }
    </script>
</body>
</html>
    `;
}

// Admin UI route
app.get('/', (req, res) => {
    res.send(buildFrontendHTML(req));
});

app.listen(APP_PORT, () => {
	console.log('🎥 OMG YouTube Addon Avviato!');
	console.log(`🌐 Server in ascolto su: http://0.0.0.0:${APP_PORT}`);
	console.log(`📱 Interfaccia admin: http://localhost:${APP_PORT}`);
	console.log(`📋 Manifest: http://localhost:${APP_PORT}/manifest.json`);
	console.log('🚀 Addon pronto per l\'uso!');
});


