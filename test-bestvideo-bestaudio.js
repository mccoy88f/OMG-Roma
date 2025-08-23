#!/usr/bin/env node

/**
 * Test per il sistema bestvideo+bestaudio
 * Verifica che il plugin YouTube e il gateway funzionino correttamente
 */

const fetch = require('node-fetch');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3100';
const PLUGIN_URL = process.env.PLUGIN_URL || 'http://localhost:3001';

async function testGateway() {
  console.log('🔍 Test Gateway...');
  
  try {
    // Test health check
    const healthResponse = await fetch(`${GATEWAY_URL}/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log('✅ Gateway Health:', health.status);
    } else {
      console.log('❌ Gateway Health Failed:', healthResponse.status);
      return false;
    }
    
    // Test streaming formats endpoint
    const formatsResponse = await fetch(`${GATEWAY_URL}/api/streaming/youtube/formats/dQw4w9WgXcQ`);
    if (formatsResponse.ok) {
      const formats = await formatsResponse.json();
      console.log('✅ Gateway Formats:', {
        total: Array.isArray(formats) ? formats.length : 0,
        sample: formats[0] || null
      });
      
      // Analizza i formati
      if (Array.isArray(formats)) {
        const analysis = {
          combined: formats.filter(f => f.type === 'combined').length,
          video: formats.filter(f => f.type === 'video').length,
          audio: formats.filter(f => f.type === 'audio').length,
          proxy: formats.filter(f => f.type === 'proxy').length
        };
        console.log('📊 Formati disponibili:', analysis);
      }
    } else {
      console.log('❌ Gateway Formats Failed:', formatsResponse.status);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Gateway Test Error:', error.message);
    return false;
  }
}

async function testPlugin() {
  console.log('\n🔍 Test Plugin YouTube...');
  
  try {
    // Test health check
    const healthResponse = await fetch(`${PLUGIN_URL}/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log('✅ Plugin Health:', health.status);
    } else {
      console.log('❌ Plugin Health Failed:', healthResponse.status);
      return false;
    }
    
    // Test streaming endpoint
    const streamResponse = await fetch(`${PLUGIN_URL}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'dQw4w9WgXcQ' })
    });
    
    if (streamResponse.ok) {
      const streamData = await streamResponse.json();
      console.log('✅ Plugin Stream:', {
        streams: streamData.streams?.length || 0,
        sample: streamData.streams?.[0] || null
      });
    } else {
      console.log('❌ Plugin Stream Failed:', streamResponse.status);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Plugin Test Error:', error.message);
    return false;
  }
}

async function testIntegration() {
  console.log('\n🔍 Test Integrazione...');
  
  try {
    // Test che il plugin possa ottenere formati dal gateway
    const streamResponse = await fetch(`${PLUGIN_URL}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'dQw4w9WgXcQ' })
    });
    
    if (streamResponse.ok) {
      const streamData = await streamResponse.json();
      const streams = streamData.streams || [];
      
      console.log('✅ Integrazione:', {
        totalStreams: streams.length,
        hasBestVideo: streams.some(s => s.type === 'video'),
        hasBestAudio: streams.some(s => s.type === 'audio'),
        hasCombined: streams.some(s => s.type === 'combined'),
        hasProxy: streams.some(s => s.type === 'proxy')
      });
      
      // Mostra i primi 3 stream
      console.log('📺 Primi 3 stream:');
      streams.slice(0, 3).forEach((stream, index) => {
        console.log(`  ${index + 1}. ${stream.name} (${stream.type})`);
      });
      
      return true;
    } else {
      console.log('❌ Integrazione Failed:', streamResponse.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Integrazione Test Error:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Test Sistema bestvideo+bestaudio\n');
  
  const gatewayOk = await testGateway();
  const pluginOk = await testPlugin();
  const integrationOk = await testIntegration();
  
  console.log('\n📊 Riepilogo Test:');
  console.log(`  Gateway: ${gatewayOk ? '✅' : '❌'}`);
  console.log(`  Plugin: ${pluginOk ? '✅' : '❌'}`);
  console.log(`  Integrazione: ${integrationOk ? '✅' : '❌'}`);
  
  if (gatewayOk && pluginOk && integrationOk) {
    console.log('\n🎉 Tutti i test sono passati! Il sistema bestvideo+bestaudio funziona correttamente.');
  } else {
    console.log('\n⚠️  Alcuni test sono falliti. Controlla i log per i dettagli.');
  }
}

// Esegui i test
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testGateway, testPlugin, testIntegration };
