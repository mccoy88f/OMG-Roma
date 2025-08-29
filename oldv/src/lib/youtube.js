const axios = require('axios');

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

function pickThumb(thumbnails) {
	if (!thumbnails) return undefined;
	return (
		thumbnails.maxres?.url ||
		thumbnails.standard?.url ||
		thumbnails.high?.url ||
		thumbnails.medium?.url ||
		thumbnails.default?.url
	);
}

function toVideoMeta(item) {
	const id = item.id?.videoId || item.id;
	const snippet = item.snippet || {};
	return {
		id: id,  // Cambiato da videoId a id
		videoId: id,  // Mantengo anche videoId per compatibilità
		title: snippet.title || '',
		description: snippet.description || '',
		thumbnail: pickThumb(snippet.thumbnails) || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined),
		channelTitle: snippet.channelTitle || '',
		publishedAt: snippet.publishedAt || ''
	};
}

async function getVideoMetadata(apiKey, videoId) {
	try {
		const response = await axios.get(`${YT_API_BASE}/videos`, {
			params: {
				key: apiKey,
				part: 'snippet,contentDetails,statistics',
				id: videoId
			}
		});
		
		if (response.data.items && response.data.items.length > 0) {
			const video = response.data.items[0];
			const snippet = video.snippet;
			const contentDetails = video.contentDetails;
			
			// Converte durata ISO 8601 in formato leggibile
			let duration = 'N/A';
			if (contentDetails.duration) {
				const match = contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
				if (match) {
					const hours = parseInt(match[1]) || 0;
					const minutes = parseInt(match[2]) || 0;
					const seconds = parseInt(match[3]) || 0;
					duration = hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
				}
			}
			
			return {
				id: videoId,
				title: snippet.title,
				description: snippet.description,
				thumbnail: pickThumb(snippet.thumbnails),
				channelTitle: snippet.channelTitle,
				channelThumbnail: snippet.thumbnails?.default?.url,
				publishedAt: snippet.publishedAt,
				duration: duration
			};
		}
		return null;
	} catch (error) {
		console.error('Error fetching video metadata:', error.message);
		return null;
	}
}

async function searchVideos({ apiKey, query, maxResults = 50 }) {
	// Controllo quota prima della richiesta
	if (!apiKey || apiKey.trim() === '') {
		throw new Error('API Key non configurata');
	}

	const params = {
		part: 'snippet',
		q: query,
		type: 'video',
		maxResults: Math.min(50, maxResults),
		key: apiKey,
		regionCode: 'IT',
		relevanceLanguage: 'it',
		videoEmbeddable: 'any',
		safeSearch: 'none'
	};

	try {
		const { data } = await axios.get(`${YT_API_BASE}/search`, { params });
		return (data.items || []).map(toVideoMeta);
	} catch (error) {
		// Gestione specifica degli errori API YouTube
		if (error.response && error.response.status === 403) {
			const errorData = error.response.data;
			if (errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
				throw new Error('QUOTA_EXCEEDED: Quota API YouTube esaurita. Riprova domani o usa una nuova API Key.');
			} else if (errorData?.error?.errors?.[0]?.reason === 'keyInvalid') {
				throw new Error('INVALID_KEY: API Key non valida. Verifica la configurazione.');
			} else {
				throw new Error(`API_ERROR: ${errorData?.error?.message || 'Errore API YouTube'}`);
			}
		}
		// Altri errori di rete
		throw new Error(`NETWORK_ERROR: ${error.message}`);
	}
}

// Nuova funzione per cercare video specifici per ID
async function searchVideoById({ apiKey, videoId }) {
	const params = {
		part: 'snippet',
		id: videoId,
		key: apiKey
	};
	const { data } = await axios.get(`${YT_API_BASE}/videos`, { params });
	return data.items && data.items.length > 0 ? toVideoMeta(data.items[0]) : null;
}

async function getChannelIdFromInput({ apiKey, input }) {
	if (!input) return undefined;
	const url = String(input).trim();
	// Try to extract directly
	const channelIdMatch = url.match(/\/channel\/([A-Za-z0-9_-]{10,})/);
	if (channelIdMatch) return channelIdMatch[1];
	const userMatch = url.match(/\/user\/([A-Za-z0-9._-]+)/);
	if (userMatch) {
		const username = userMatch[1];
		const { data } = await axios.get(`${YT_API_BASE}/channels`, {
			params: { part: 'snippet', forUsername: username, key: apiKey }
		});
		return data.items?.[0]?.id;
	}
	const handleMatch = url.match(/\/(?:@)([A-Za-z0-9._-]+)/);
	if (handleMatch) {
		const handle = handleMatch[1];  // Senza il @
		try {
			// Prima prova con forHandle (YouTube API v3)
			const { data } = await axios.get(`${YT_API_BASE}/channels`, {
				params: { part: 'snippet', forHandle: handle, key: apiKey }
			});
			if (data.items?.[0]?.id) {
				return data.items[0].id;
			}
		} catch (error) {
			console.log(`❌ Errore forHandle per ${handle}:`, error.message);
		}
		
		// Fallback: search con handle completo
		try {
			const { data } = await axios.get(`${YT_API_BASE}/search`, {
				params: { part: 'snippet', q: `@${handle}`, type: 'channel', maxResults: 1, key: apiKey }
			});
			return data.items?.[0]?.snippet?.channelId;
		} catch (error) {
			console.log(`❌ Errore search per @${handle}:`, error.message);
		}
	}
	return undefined;
}

async function fetchChannelTitleAndThumb({ apiKey, channelId }) {
	const { data } = await axios.get(`${YT_API_BASE}/channels`, {
		params: { part: 'snippet', id: channelId, key: apiKey }
	});
	const item = data.items?.[0];
	return {
		channelTitle: item?.snippet?.title || '',
		channelThumbnail: pickThumb(item?.snippet?.thumbnails)
	};
}

async function fetchChannelLatestVideos({ apiKey, channelId, maxResults = 50 }) {
	if (!apiKey || apiKey.trim() === '') {
		throw new Error('API Key non configurata');
	}

	const params = {
		part: 'snippet',
		channelId,
		order: 'date',
		type: 'video',
		maxResults: Math.min(50, maxResults),
		key: apiKey
	};

	try {
		const { data } = await axios.get(`${YT_API_BASE}/search`, { params });
		const base = (data.items || []).map(toVideoMeta);
		// Enrich with channel thumb/title
		const extra = await fetchChannelTitleAndThumb({ apiKey, channelId });
		return base.map((v) => ({ ...v, ...extra }));
	} catch (error) {
		// Gestione specifica degli errori API YouTube
		if (error.response && error.response.status === 403) {
			const errorData = error.response.data;
			if (errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
				throw new Error('QUOTA_EXCEEDED: Quota API YouTube esaurita. Riprova domani o usa una nuova API Key.');
			}
		}
		throw error; // Re-lancia altri errori
	}
}

// Funzione per controllare lo stato della quota API (consumo minimo)
async function checkApiQuotaStatus(apiKey) {
	if (!apiKey || apiKey.trim() === '') {
		return { valid: false, error: 'API Key non configurata' };
	}

	try {
		// Usa una richiesta con costo minimo (1 unità invece di 100)
		const { data } = await axios.get(`${YT_API_BASE}/channels`, {
			params: {
				part: 'snippet',
				mine: true,
				key: apiKey,
				maxResults: 1
			}
		});
		
		return { 
			valid: true, 
			quotaRemaining: 'OK',
			message: 'API Key funzionante'
		};
	} catch (error) {
		if (error.response && error.response.status === 403) {
			const errorData = error.response.data;
			if (errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
				return { 
					valid: false, 
					quotaRemaining: 0,
					error: 'QUOTA_EXCEEDED',
					message: 'Quota API YouTube esaurita. Riprova domani o usa una nuova API Key.'
				};
			} else if (errorData?.error?.errors?.[0]?.reason === 'keyInvalid') {
				return { 
					valid: false, 
					error: 'INVALID_KEY',
					message: 'API Key non valida. Verifica la configurazione.'
				};
			}
		}
		
		return { 
			valid: false, 
			error: 'UNKNOWN',
			message: `Errore nella verifica: ${error.message}`
		};
	}
}

module.exports = {
	searchVideos,
	searchVideoById,
	getVideoMetadata,
	getChannelIdFromInput,
	fetchChannelLatestVideos,
	fetchChannelTitleAndThumb,
	checkApiQuotaStatus
};


