#!/usr/bin/env node

/**
 * Test per OMG-Roma - Sistema modulare per Stremio
 * Verifica che il gateway e i plugin funzionino correttamente
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
      console.log('📊 Plugin Status:', health.plugins);
    } else {
      console.log('❌ Gateway Health Failed:', healthResponse.status);
      return false;
    }
    
    // Test manifest
    const manifestResponse = await fetch(`${GATEWAY_URL}/manifest.json`);
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      console.log('✅ Gateway Manifest:', {
        id: manifest.id,
        name: manifest.name,
        catalogs: manifest.catalogs?.length || 0
      });
    } else {
      console.log('❌ Gateway Manifest Failed:', manifestResponse.status);
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
      console.log('🔌 Services:', health.services);
    } else {
      console.log('❌ Plugin Health Failed:', healthResponse.status);
      return false;
    }
    
    // Test plugin info
    const pluginResponse = await fetch(`${PLUGIN_URL}/plugin.json`);
    if (pluginResponse.ok) {
      const pluginInfo = await pluginResponse.json();
      console.log('✅ Plugin Info:', {
        id: pluginInfo.id,
        name: pluginInfo.name,
        endpoints: Object.keys(pluginInfo.endpoints || {}).length
      });
    } else {
      console.log('❌ Plugin Info Failed:', pluginResponse.status);
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
    // Test catalog search
    const searchResponse = await fetch(`${GATEWAY_URL}/catalog/channel/youtube_search.json?search=test`);
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      console.log('✅ Catalog Search:', {
        metas: searchData.metas?.length || 0,
        hasMore: searchData.hasMore || false
      });
    } else {
      console.log('❌ Catalog Search Failed:', searchResponse.status);
    }
    
    // Test catalog discover
    const discoverResponse = await fetch(`${GATEWAY_URL}/catalog/channel/youtube_channels.json`);
    if (discoverResponse.ok) {
      const discoverData = await discoverResponse.json();
      console.log('✅ Catalog Discover:', {
        metas: discoverData.metas?.length || 0,
        hasMore: discoverData.hasMore || false
      });
    } else {
      console.log('❌ Catalog Discover Failed:', discoverResponse.status);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Integration Test Error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Avvio test OMG-Roma...\n');
  
  const gatewayOk = await testGateway();
  const pluginOk = await testPlugin();
  const integrationOk = await testIntegration();
  
  console.log('\n📊 Risultati Test:');
  console.log(`   Gateway: ${gatewayOk ? '✅ OK' : '❌ FAIL'}`);
  console.log(`   Plugin: ${pluginOk ? '✅ OK' : '❌ FAIL'}`);
  console.log(`   Integrazione: ${integrationOk ? '✅ OK' : '❌ FAIL'}`);
  
  if (gatewayOk && pluginOk && integrationOk) {
    console.log('\n🎉 Tutti i test sono passati! OMG-Roma funziona correttamente.');
  } else {
    console.log('\n⚠️  Alcuni test sono falliti. Controlla i log per i dettagli.');
  }
}

// Esegui i test se il file viene chiamato direttamente
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testGateway, testPlugin, testIntegration, runTests };
