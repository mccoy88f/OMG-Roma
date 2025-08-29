#!/usr/bin/env node

/**
 * Script di test per verificare il funzionamento dell'addon OMG YouTube
 * Esegui: node test-addon.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3100';

async function testAddon() {
    console.log('🧪 Test Addon OMG YouTube\n');
    
    try {
        // Test 1: Verifica che il server sia attivo
        console.log('1️⃣ Test connessione server...');
        const response = await axios.get(`${BASE_URL}/api/config`);
        console.log('✅ Server attivo e risponde');
        
        // Test 2: Verifica stato yt-dlp
        console.log('\n2️⃣ Test stato yt-dlp...');
        try {
            const ytDlpStatus = await axios.get(`${BASE_URL}/api/yt-dlp-status`);
            const status = ytDlpStatus.data;
            if (status.available) {
                console.log('✅ yt-dlp disponibile e funzionante');
            } else {
                console.log('⚠️ yt-dlp non disponibile - funzionalità limitate');
            }
        } catch (error) {
            console.log('❌ Errore nel controllo di yt-dlp:', error.message);
        }
        
        // Test 3: Verifica manifest
        console.log('\n3️⃣ Test manifest...');
        try {
            const manifest = await axios.get(`${BASE_URL}/manifest.json`);
            console.log('✅ Manifest generato correttamente');
            console.log(`   ID: ${manifest.data.id}`);
            console.log(`   Nome: ${manifest.data.name}`);
            console.log(`   Risorse: ${manifest.data.resources.join(', ')}`);
        } catch (error) {
            console.log('❌ Errore nel manifest:', error.message);
        }
        
        // Test 4: Verifica endpoint meta (con video di esempio)
        console.log('\n4️⃣ Test endpoint meta...');
        try {
            const testVideoId = 'dQw4w9WgXcQ'; // Video di esempio
            const meta = await axios.get(`${BASE_URL}/meta/movie/yt_${testVideoId}.json`);
            if (meta.data && meta.data.meta) {
                console.log('✅ Endpoint meta funzionante');
                console.log(`   Titolo: ${meta.data.meta.name}`);
                console.log(`   Descrizione: ${meta.data.meta.description ? 'Presente' : 'Mancante'}`);
            } else {
                console.log('⚠️ Endpoint meta risponde ma senza dati');
            }
        } catch (error) {
            console.log('❌ Errore nell\'endpoint meta:', error.message);
        }
        
        // Test 5: Verifica endpoint stream
        console.log('\n5️⃣ Test endpoint stream...');
        try {
            const testVideoId = 'dQw4w9WgXcQ'; // Video di esempio
            const stream = await axios.get(`${BASE_URL}/stream/movie/yt_${testVideoId}.json`);
            if (stream.data && stream.data.streams && stream.data.streams.length > 0) {
                console.log('✅ Endpoint stream funzionante');
                console.log(`   URL: ${stream.data.streams[0].url}`);
            } else {
                console.log('⚠️ Endpoint stream risponde ma senza stream');
            }
        } catch (error) {
            console.log('❌ Errore nell\'endpoint stream:', error.message);
        }
        
        console.log('\n🎉 Test completati!');
        console.log('\n📋 Per usare l\'addon:');
        console.log('1. Configura l\'API Key su:', `${BASE_URL}/`);
        console.log('2. Copia l\'URL del manifest generato');
        console.log('3. Installa in Stremio usando l\'URL del manifest');
        
    } catch (error) {
        console.error('\n❌ Errore generale:', error.message);
        console.log('\n🔧 Verifica che:');
        console.log('1. Il server sia avviato (npm start)');
        console.log('2. La porta 3100 sia libera');
        console.log('3. Tutte le dipendenze siano installate');
    }
}

// Esegui i test
testAddon();
