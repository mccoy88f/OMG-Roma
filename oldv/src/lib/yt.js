const { spawn } = require('child_process');
const { Readable } = require('stream');

/**
 * Verifica se yt-dlp è installato e disponibile
 * @returns {Promise<boolean>} True se yt-dlp è disponibile
 */
async function checkYtDlpAvailable() {
    return new Promise((resolve) => {
        const ytDlp = spawn('yt-dlp', ['--version']);
        
        let version = '';
        
        ytDlp.stdout.on('data', (data) => {
            version += data.toString();
        });
        
        ytDlp.on('error', () => {
            console.log('❌ yt-dlp non disponibile nel sistema');
            resolve(false);
        });
        
        ytDlp.on('close', (code) => {
            if (code === 0) {
                const cleanVersion = version.trim();
                // console.log(`✅ yt-dlp disponibile - Versione: ${cleanVersion}`); // Disabilitato per evitare spam
                resolve(true);
            } else {
                console.log('❌ yt-dlp non disponibile nel sistema');
                resolve(false);
            }
        });
        
        // Timeout dopo 5 secondi
        setTimeout(() => {
            ytDlp.kill();
            console.log('❌ Timeout nel controllo di yt-dlp');
            resolve(false);
        }, 5000);
    });
}

/**
 * Estrae l'URL dello stream diretto per un video YouTube
 * @param {string} videoId - ID del video YouTube
 * @returns {Promise<string>} URL dello stream
 */
async function getStreamUrlForVideo(videoId) {
    const isAvailable = await checkYtDlpAvailable();
    if (!isAvailable) {
        throw new Error('yt-dlp non è installato o non disponibile');
    }

    console.log(`🔍 Estrazione URL stream per video: ${videoId}`);

    return new Promise((resolve, reject) => {
        const ytDlp = spawn('yt-dlp', [
            '-g',
            '-f', 'best',
            '--no-playlist',
            '--extractor-args', 'youtube:player_client=android',
            '--force-generic-extractor',
            '--no-check-certificates',
            `https://www.youtube.com/watch?v=${videoId}`
        ]);

        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ytDlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code === 0) {
                const url = stdout.trim().split('\n')[0];
                if (url && url.startsWith('http')) {
                    console.log(`✅ URL stream estratto: ${url}`);
                    console.log(`📹 Formato rilevato: ${url.includes('.mp4') ? 'MP4' : url.includes('.webm') ? 'WebM' : 'Altro'}`);
                    resolve(url);
                } else {
                    console.log(`❌ URL non valido estratto: ${url}`);
                    reject(new Error('URL non valido estratto da yt-dlp'));
                }
            } else {
                console.log(`❌ yt-dlp fallito con codice ${code}: ${stderr}`);
                reject(new Error(`yt-dlp fallito con codice ${code}: ${stderr}`));
            }
        });

        ytDlp.on('error', (error) => {
            console.log(`❌ Errore nell'esecuzione di yt-dlp: ${error.message}`);
            reject(new Error(`Errore nell'esecuzione di yt-dlp: ${error.message}`));
        });

        // Timeout dopo 30 secondi
        setTimeout(() => {
            ytDlp.kill();
            console.log(`⏰ Timeout nell'estrazione dell'URL per video: ${videoId}`);
            reject(new Error('Timeout nell\'estrazione dell\'URL'));
        }, 30000);
    });
}

/**
 * Crea uno stream proxy per un video YouTube con qualità specifica
 * @param {string} videoId - ID del video YouTube
 * @param {string} quality - Formato qualità per yt-dlp (default: best)
 * @returns {Promise<Readable>} Stream leggibile
 */
async function createVideoStreamWithQuality(videoId, quality = 'best') {
    const isAvailable = await checkYtDlpAvailable();
    if (!isAvailable) {
        throw new Error('yt-dlp non è installato o non disponibile');
    }

    console.log(`🎬 Creazione stream proxy per video: ${videoId} - Qualità: ${quality}`);

    return new Promise((resolve, reject) => {
        // Ottimizzazione parametri yt-dlp per streaming stabile
        let formatSelection = quality;
        if (quality === 'best') {
            // Usa una selezione formato più intelligente invece di "best"
            formatSelection = 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b';
        }

        const ytDlp = spawn('yt-dlp', [
            '-f', formatSelection,
            '-o', '-', // Output su stdout
            '--no-playlist',
            '--no-cache-dir',
            '--buffer-size', '64K', // Buffer più grande per stabilità
            '--http-chunk-size', '2M', // Chunk size ridotto per streaming
            '--retries', '5', // Più retry
            '--fragment-retries', '5',
            '--socket-timeout', '60', // Timeout socket aumentato
            '--retry-sleep', '1', // Pausa tra retry
            '--merge-output-format', 'mp4', // Forza output MP4
            '--recode-video', 'mp4', // Ricodifica se necessario
            '--extractor-args', 'youtube:player_client=android,web,mweb', // Più client
            '--extractor-args', 'youtube:formats=missing_pot', // Abilita formati senza PO token
            '--no-check-certificates', // Ignora certificati SSL
            `https://www.youtube.com/watch?v=${videoId}`
        ]);

        console.log(`🚀 yt-dlp avviato per streaming: ${videoId} con qualità ${quality}`);

        // Gestione ottimizzata dello stream
        let totalBytes = 0;
        let startTime = Date.now();

        ytDlp.stdout.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes % (1024 * 1024) === 0) { // Log ogni MB
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = totalBytes / elapsed / 1024 / 1024;
                console.log(`📊 ${videoId}: ${(totalBytes / 1024 / 1024).toFixed(1)}MB trasferiti (${speed.toFixed(1)}MB/s)`);
            }
        });

        ytDlp.stderr.on('data', (data) => {
            const stderrText = data.toString();
            
            // Gestione errori specifici per migliorare diagnostica
            if (stderrText.includes('ERROR') || stderrText.includes('CRITICAL')) {
                if (stderrText.includes('Broken pipe')) {
                    console.log(`🔌 Cliente disconnesso per ${videoId}: Broken pipe`);
                } else if (stderrText.includes('ffmpeg exited with code 1')) {
                    console.log(`🎵 Errore audio/video per ${videoId}: ffmpeg fallito (possibile formato incompatibile)`);
                } else if (stderrText.includes('HTTP Error 403')) {
                    console.log(`🚫 Accesso negato per ${videoId}: Video potrebbe essere geo-limitato o privato`);
                } else if (stderrText.includes('Video unavailable')) {
                    console.log(`📹 Video non disponibile per ${videoId}: Rimosso o privato`);
                } else if (stderrText.includes('requested format not available')) {
                    console.log(`📼 Formato non disponibile per ${videoId}: Prova qualità diversa`);
                } else {
                    console.log(`❌ yt-dlp error per ${videoId}: ${stderrText.trim()}`);
                }
            } else if (stderrText.includes('WARNING') && !stderrText.includes('PO Token')) {
                // Log warning solo se non sono i soliti warning PO Token
                console.log(`⚠️  yt-dlp warning per ${videoId}: ${stderrText.trim()}`);
            }
        });

        ytDlp.on('error', (error) => {
            console.error(`❌ yt-dlp process error per ${videoId}:`, error.message);
            reject(error);
        });

        ytDlp.on('exit', (code, signal) => {
            if (code === 0) {
                console.log(`✅ yt-dlp completato per ${videoId} (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
            } else if (code === 120 && signal === null) {
                // Codice 120 spesso indica disconnessione client (broken pipe)
                console.log(`🔌 Client disconnesso durante streaming per ${videoId} (${(totalBytes / 1024 / 1024).toFixed(1)}MB trasferiti)`);
            } else {
                console.error(`❌ yt-dlp uscito con codice ${code}, segnale ${signal} per ${videoId}`);
                reject(new Error(`yt-dlp fallito con codice ${code}`));
            }
        });

        // Restituisci lo stdout come stream
        resolve(ytDlp.stdout);
    });
}

/**
 * Crea uno stream proxy per un video YouTube (versione legacy)
 * @param {string} videoId - ID del video YouTube
 * @returns {Promise<Readable>} Stream leggibile
 */
async function createVideoStream(videoId) {
    return createVideoStreamWithQuality(videoId);
}

async function getVideoFormats(videoId) {
    const isAvailable = await checkYtDlpAvailable();
    if (!isAvailable) {
        throw new Error('yt-dlp non è installato o non disponibile');
    }

    console.log(`🔍 Recupero formati per video: ${videoId}`);

    return new Promise((resolve, reject) => {
        const ytDlp = spawn('yt-dlp', [
            '--dump-json',
            '--no-playlist',
            '--no-cache-dir',
            '--socket-timeout', '30',           // Timeout socket aumentato
            '--extractor-args', 'youtube:player_client=android,web', // Client multipli per più formati
            '--extractor-args', 'youtube:formats=missing_pot', // Abilita formati senza PO token
            '--no-check-certificates',
            '--quiet',                          // Riduci output verboso
            `https://www.youtube.com/watch?v=${videoId}`
        ]);

        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ytDlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code === 0) {
                try {
                    const info = JSON.parse(stdout);
                    console.log(`✅ Formati recuperati per ${videoId}:`);
                    console.log(`   📹 Titolo: ${info.title || 'N/A'}`);
                    console.log(`   ⏱️ Durata: ${info.duration_string || 'N/A'}`);
                    console.log(`   📊 Formati disponibili: ${info.formats ? info.formats.length : 0}`);
                    console.log(`   🎯 Formato selezionato: ${info.format || 'N/A'}`);
                    console.log(`   🔗 URL: ${info.url || 'N/A'}`);
                    
                    // Mostra i formati migliori disponibili
                    if (info.formats && info.formats.length > 0) {
                        const bestFormats = info.formats
                            .filter(f => f.ext === 'mp4' || f.ext === 'webm')
                            .sort((a, b) => (b.height || 0) - (a.height || 0))
                            .slice(0, 3);
                        
                        console.log(`   🏆 Migliori formati disponibili:`);
                        bestFormats.forEach((f, i) => {
                            console.log(`      ${i + 1}. ${f.ext?.toUpperCase()} - ${f.height}p - ${f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + 'MB' : 'N/A'}`);
                        });
                    }
                    
                    resolve(info);
                } catch (error) {
                    console.log(`❌ Errore nel parsing JSON per ${videoId}: ${error.message}`);
                    reject(new Error(`Errore nel parsing JSON: ${error.message}`));
                }
            } else {
                console.log(`❌ yt-dlp fallito con codice ${code} per ${videoId}: ${stderr}`);
                
                // Se fallisce, prova con opzioni alternative
                if (stderr.includes('Signature extraction failed') || stderr.includes('No video formats found')) {
                    console.log(`🔄 Tentativo con opzioni alternative per ${videoId}...`);
                    resolve(null); // Indica che deve usare fallback
                } else {
                    reject(new Error(`yt-dlp fallito con codice ${code}: ${stderr}`));
                }
            }
        });

        ytDlp.on('error', (error) => {
            console.log(`❌ Errore nell'esecuzione di yt-dlp per ${videoId}: ${error.message}`);
            reject(new Error(`Errore nell'esecuzione di yt-dlp: ${error.message}`));
        });

        // Timeout dopo 45 secondi (aumentato per video complessi)
        setTimeout(() => {
            ytDlp.kill();
            console.log(`⏰ Timeout nel recupero formati per video: ${videoId}`);
            reject(new Error('Timeout nel recupero delle informazioni del video'));
        }, 45000);
    });
}

/**
 * Ricerca video usando yt-dlp (alternativa gratuita alla YouTube API)
 * @param {string} query - Query di ricerca
 * @param {number} maxResults - Numero massimo di risultati (default: 25)
 * @returns {Promise<Array>} Array di video nel formato compatibile
 */
async function searchVideosWithYtDlp(query, maxResults = 25) {
    const isAvailable = await checkYtDlpAvailable();
    if (!isAvailable) {
        throw new Error('yt-dlp non è installato o non disponibile');
    }

    console.log(`🔍 Ricerca yt-dlp: "${query}" (limite: ${maxResults})`);

    return new Promise((resolve, reject) => {
        const searchQuery = `ytsearch${maxResults}:${query}`;
        
        const ytDlp = spawn('yt-dlp', [
            '--dump-json',
            '--no-playlist',
            '--no-cache-dir',
            '--dateafter', 'today-5years', // Solo video degli ultimi 5 anni
            searchQuery
        ]);

        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ytDlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code === 0) {
                try {
                    // yt-dlp restituisce un JSON per ogni video, uno per riga
                    const lines = stdout.trim().split('\n').filter(line => line.trim());
                    const videos = lines.map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            console.log(`⚠️ Errore parsing JSON line: ${e.message}`);
                            return null;
                        }
                    }).filter(video => video !== null);

                    // Converte nel formato compatibile con YouTube API
                    const convertedVideos = videos.map(video => ({
                        id: video.id,
                        videoId: video.id,
                        title: video.title || '',
                        description: video.description || video.title || '',
                        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
                        channelTitle: video.uploader || video.channel || 'YouTube',
                        channelThumbnail: video.uploader_url ? `https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj` : undefined,
                        publishedAt: video.upload_date ? 
                            `${video.upload_date.substring(0, 4)}-${video.upload_date.substring(4, 6)}-${video.upload_date.substring(6, 8)}T00:00:00Z` 
                            : new Date().toISOString(),
                        viewCount: video.view_count || 0,
                        duration: video.duration || 0
                    }));

                    // Ordina per data di pubblicazione (più recenti primi)
                    convertedVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

                    console.log(`✅ yt-dlp ricerca completata: ${convertedVideos.length} video trovati`);
                    resolve(convertedVideos);
                    
                } catch (error) {
                    console.log(`❌ Errore parsing risultati yt-dlp: ${error.message}`);
                    reject(new Error(`Errore parsing risultati: ${error.message}`));
                }
            } else {
                console.log(`❌ yt-dlp search fallito con codice ${code}: ${stderr}`);
                reject(new Error(`yt-dlp search fallito: ${stderr}`));
            }
        });

        ytDlp.on('error', (error) => {
            console.log(`❌ Errore esecuzione yt-dlp search: ${error.message}`);
            reject(new Error(`Errore esecuzione yt-dlp: ${error.message}`));
        });

        // Timeout dopo 30 secondi
        setTimeout(() => {
            ytDlp.kill();
            console.log(`⏰ Timeout ricerca yt-dlp per: ${query}`);
            reject(new Error('Timeout ricerca yt-dlp'));
        }, 30000);
    });
}

module.exports = {
    checkYtDlpAvailable,
    getStreamUrlForVideo,
    createVideoStream,
    createVideoStreamWithQuality,
    getVideoFormats,
    searchVideosWithYtDlp
};


