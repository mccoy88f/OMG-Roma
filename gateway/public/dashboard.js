// OMG-Roma Dashboard JavaScript
let currentData = {};

async function loadDashboard() {
    try {
        const [statusResponse, pluginsResponse, manifestResponse] = await Promise.all([
            fetch('/api/status').then(r => r.json()),
            fetch('/api/plugins').then(r => r.json()),
            fetch('/api/manifest').then(r => r.json())
        ]);

        currentData = {
            status: statusResponse,
            plugins: pluginsResponse.plugins || [],
            manifest: manifestResponse
        };

        updateManifestUrl(
            manifestResponse.manifestUrl, 
            manifestResponse.configHash, 
            manifestResponse.isPersonalized
        );
        renderDashboard();

    } catch (error) {
        console.error('Error loading dashboard:', error);
        showError('Errore nel caricamento della dashboard');
    }
}

function updateManifestUrl(url, configHash = null, isPersonalized = false) {
    const manifestUrlElement = document.getElementById('manifestUrl');
    manifestUrlElement.textContent = url || 'http://localhost:3100/manifest.json';
    
    // Show configuration hash info if available
    if (configHash && isPersonalized) {
        const configInfo = document.createElement('div');
        configInfo.className = 'config-info';
        configInfo.innerHTML = `
            <small style="color: #718096; margin-top: 5px; display: block;">
                🔧 Manifest personalizzato (config: ${configHash})
            </small>
        `;
        
        // Remove existing config info if any
        const existingInfo = manifestUrlElement.parentNode.querySelector('.config-info');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        manifestUrlElement.parentNode.appendChild(configInfo);
    }
}

function renderDashboard() {
    const dashboard = document.getElementById('dashboard');
    
    if (!currentData.plugins || currentData.plugins.length === 0) {
        dashboard.innerHTML = `
            <div class="card">
                <h3>⚠️ Nessun Plugin</h3>
                <p>Nessun plugin disponibile. Verifica la configurazione Docker.</p>
            </div>
        `;
        return;
    }

    dashboard.innerHTML = currentData.plugins.map(plugin => `
        <div class="card">
            <div class="plugin-header">
                <div class="plugin-selector">
                    <input type="checkbox" id="plugin-${plugin.id}" data-plugin-id="${plugin.id}" 
                           ${plugin.manifestEnabled ? 'checked' : ''} class="plugin-checkbox">
                    <label for="plugin-${plugin.id}" class="plugin-label">
            <h3>📦 ${plugin.name}</h3>
                    </label>
                </div>
            <div class="status">
                <span class="status-indicator status-${plugin.status}"></span>
                <span>Status: ${plugin.status}</span>
            </div>
            </div>
            
            <p><strong>Versione:</strong> ${plugin.version}</p>
            <p><strong>Descrizione:</strong> ${plugin.description}</p>
            
            <div class="plugin-catalogs">
                <strong>Cataloghi Stremio:</strong>
                ${plugin.stremio.search_catalog_name ? `
                    <div class="catalog-item">🔍 ${plugin.stremio.search_catalog_name}</div>
                ` : ''}
                ${plugin.stremio.discover_catalog_name ? `
                    <div class="catalog-item">📺 ${plugin.stremio.discover_catalog_name}</div>
                ` : ''}
            </div>

            <div style="margin-top: 15px;">
                <button class="btn" data-action="configure" data-plugin-id="${plugin.id}">⚙️ Configura</button>
                <button class="btn btn-secondary" data-action="test" data-plugin-id="${plugin.id}">🧪 Test</button>
            </div>
        </div>
    `).join('');
}

async function configurePlugin(pluginId) {
    try {
        const response = await fetch(`/api/plugins/${pluginId}/config`);
        const data = await response.json();

        if (!data.success) {
            showError(data.error);
            return;
        }

        showConfigModal(pluginId, data.config, data.schema);

    } catch (error) {
        console.error('Error loading plugin config:', error);
        showError('Errore nel caricamento della configurazione');
    }
}

function showConfigModal(pluginId, config, schema) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;

    modal.innerHTML = `
        <div style="background: white; border-radius: 15px; padding: 30px; max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <h3>⚙️ Configurazione ${pluginId}</h3>
            <form id="configForm">
                ${Object.entries(schema).map(([key, schemaInfo]) => `
                    <div class="form-group">
                        <label>${key}:</label>
                        ${renderConfigField(key, config[key], schemaInfo)}
                        <small style="color: #718096;">${schemaInfo.description || ''}</small>
                    </div>
                `).join('')}
            </form>
            <div style="margin-top: 20px; text-align: right;">
                <button class="btn btn-secondary" data-action="close-modal">Annulla</button>
                <button class="btn" data-action="save-config" data-plugin-id="${pluginId}">💾 Salva</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    window.currentModal = modal;
}

function renderConfigField(key, value, schema) {
    if (schema.type === 'boolean') {
        return `<input type="checkbox" name="${key}" ${value ? 'checked' : ''}>`;
    } else if (schema.enum) {
        return `
            <select name="${key}">
                ${schema.enum.map(option => `
                    <option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>
                `).join('')}
            </select>
        `;
    } else if (schema.type === 'array') {
        return `<textarea name="${key}" rows="4" placeholder="Un elemento per riga">${Array.isArray(value) ? value.join('\n') : ''}</textarea>`;
    } else {
        return `<input type="text" name="${key}" value="${value || ''}" placeholder="${schema.default || ''}">`;
    }
}

async function saveConfig(pluginId) {
    try {
        const form = document.getElementById('configForm');
        const formData = new FormData(form);
        const config = {};

        for (const [key, value] of formData.entries()) {
            const field = form.querySelector(`[name="${key}"]`);
            
            if (field.type === 'checkbox') {
                config[key] = field.checked;
            } else if (field.tagName === 'TEXTAREA') {
                config[key] = value.split('\n').filter(line => line.trim());
            } else {
                config[key] = value;
            }
        }

        const response = await fetch(`/api/plugins/${pluginId}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Configurazione salvata con successo!');
            
            // Show new manifest URL if available
            if (result.manifest && result.manifest.updated) {
                showSuccess(`🔄 Manifest aggiornato! Nuovo URL: ${result.manifest.newUrl}`);
                
                // Update manifest URL in dashboard
                const manifestUrlElement = document.getElementById('manifestUrl');
                if (manifestUrlElement) {
                    manifestUrlElement.textContent = result.manifest.newUrl;
                    
                    // Update config hash info
                    const existingInfo = manifestUrlElement.parentNode.querySelector('.config-info');
                    if (existingInfo) {
                        existingInfo.remove();
                    }
                    
                    const configInfo = document.createElement('div');
                    configInfo.className = 'config-info';
                    configInfo.innerHTML = `
                        <small style="color: #718096; margin-top: 5px; display: block;">
                            🔧 Manifest personalizzato (config: ${result.manifest.configHash})
                        </small>
                    `;
                    manifestUrlElement.parentNode.appendChild(configInfo);
                }
            }
            
            closeModal();
            loadDashboard(); // Reload dashboard
        } else {
            showError(result.error);
        }

    } catch (error) {
        console.error('Error saving config:', error);
        showError('Errore nel salvataggio della configurazione');
    }
}

async function testPlugin(pluginId) {
    try {
        showSuccess('🧪 Test del plugin in corso...');

        const response = await fetch(`/api/plugins/${pluginId}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testType: 'search', query: 'test' })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess(`✅ Test completato! Trovati ${result.result.videoCount} video in ${result.duration}`);
        } else {
            showError(`❌ Test fallito: ${result.error}`);
        }

    } catch (error) {
        console.error('Error testing plugin:', error);
        showError('Errore durante il test del plugin');
    }
}

function copyManifestUrl() {
    const url = document.getElementById('manifestUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
        showSuccess('📋 URL copiato negli appunti!');
    });
}

function openStremio() {
    // Open Stremio desktop app with the manifest URL
    const manifestUrl = document.getElementById('manifestUrl').textContent;
    window.open(`stremio://${manifestUrl}`, '_blank');
}

async function regenerateManifest() {
    try {
        showSuccess('🔄 Rigenerazione manifest in corso...');
        
        const response = await fetch('/api/manifest/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Update manifest URL
            const manifestUrlElement = document.getElementById('manifestUrl');
            if (manifestUrlElement) {
                manifestUrlElement.textContent = result.manifestUrl;
                
                // Update config hash info
                const existingInfo = manifestUrlElement.parentNode.querySelector('.config-info');
                if (existingInfo) {
                    existingInfo.remove();
                }
                
                if (result.configHash) {
                    const configInfo = document.createElement('div');
                    configInfo.className = 'config-info';
                    configInfo.innerHTML = `
                        <small style="color: #718096; margin-top: 5px; display: block;">
                            🔧 Manifest personalizzato (config: ${result.configHash})
                        </small>
                    `;
                    manifestUrlElement.parentNode.appendChild(configInfo);
                }
            }
            
            showSuccess(`✅ Manifest rigenerato con successo! Hash: ${result.configHash}`);
        } else {
            showError(`❌ Errore nella rigenerazione: ${result.error}`);
        }
        
    } catch (error) {
        console.error('Error regenerating manifest:', error);
        showError('Errore durante la rigenerazione del manifest');
    }
}

async function togglePluginInManifest(pluginId, enabled) {
    try {
        showSuccess(`${enabled ? '✅' : '❌'} Plugin ${pluginId} ${enabled ? 'abilitato' : 'disabilitato'} nel manifest...`);
        
        const response = await fetch('/api/manifest/plugins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pluginId: pluginId,
                enabled: enabled
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(`✅ Plugin ${pluginId} ${enabled ? 'abilitato' : 'disabilitato'} nel manifest!`);
            
            // Update manifest URL if available
            if (result.manifest && result.manifest.updated) {
                const manifestUrlElement = document.getElementById('manifestUrl');
                if (manifestUrlElement) {
                    manifestUrlElement.textContent = result.manifest.newUrl;
                    
                    // Update config hash info
                    const existingInfo = manifestUrlElement.parentNode.querySelector('.config-info');
                    if (existingInfo) {
                        existingInfo.remove();
                    }
                    
                    if (result.manifest.configHash) {
                        const configInfo = document.createElement('div');
                        configInfo.className = 'config-info';
                        configInfo.innerHTML = `
                            <small style="color: #718096; margin-top: 5px; display: block;">
                                🔧 Manifest aggiornato (config: ${result.manifest.configHash})
                            </small>
                        `;
                        manifestUrlElement.parentNode.appendChild(configInfo);
                            }
    }
}

async function savePluginSelection() {
    try {
        showSuccess('💾 Salvataggio selezione plugin in corso...');
        
        // Get all plugin checkboxes
        const checkboxes = document.querySelectorAll('.plugin-checkbox');
        const pluginSelection = {};
        
        checkboxes.forEach(checkbox => {
            const pluginId = checkbox.getAttribute('data-plugin-id');
            const enabled = checkbox.checked;
            pluginSelection[pluginId] = enabled;
        });
        
        // Save plugin selection
        const response = await fetch('/api/manifest/plugins/selection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugins: pluginSelection })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('✅ Selezione plugin salvata con successo!');
            
            // Update manifest URL if available
            if (result.manifest && result.manifest.updated) {
                const manifestUrlElement = document.getElementById('manifestUrl');
                if (manifestUrlElement) {
                    manifestUrlElement.textContent = result.manifest.newUrl;
                    
                    // Update config hash info
                    const existingInfo = manifestUrlElement.parentNode.querySelector('.config-info');
                    if (existingInfo) {
                        existingInfo.remove();
                    }
                    
                    if (result.manifest.configHash) {
                        const configInfo = document.createElement('div');
                        configInfo.className = 'config-info';
                        configInfo.innerHTML = `
                            <small style="color: #718096; margin-top: 5px; display: block;">
                                🔧 Manifest aggiornato (config: ${result.manifest.configHash})
                            </small>
                        `;
                        manifestUrlElement.parentNode.appendChild(configInfo);
                    }
                }
            }
        } else {
            showError(`❌ Errore nel salvataggio: ${result.error}`);
        }
        
    } catch (error) {
        console.error('Error saving plugin selection:', error);
        showError('Errore durante il salvataggio della selezione plugin');
    }
}
            
            // Reload dashboard to show updated plugin status
            loadDashboard();
        } else {
            showError(`❌ Errore nell'aggiornamento del manifest: ${result.error}`);
            // Revert checkbox state
            const checkbox = document.getElementById(`plugin-${pluginId}`);
            if (checkbox) {
                checkbox.checked = !enabled;
            }
        }
        
    } catch (error) {
        console.error('Error toggling plugin in manifest:', error);
        showError('Errore durante l\'aggiornamento del manifest');
        // Revert checkbox state
        const checkbox = document.getElementById(`plugin-${pluginId}`);
        if (checkbox) {
            checkbox.checked = !enabled;
        }
    }
}

function closeModal() {
    if (window.currentModal) {
        document.body.removeChild(window.currentModal);
        window.currentModal = null;
    }
}

function showError(message) {
    showNotification(message, 'error');
}

function showSuccess(message) {
    showNotification(message, 'success');
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = type;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2000;
        max-width: 300px;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (document.body.contains(notification)) {
            document.body.removeChild(notification);
        }
    }, 5000);
}

// Auto-refresh dashboard every 30 seconds
setInterval(loadDashboard, 30000);

// Event listener for buttons (CSP-compliant)
document.addEventListener('click', function(event) {
    const action = event.target.getAttribute('data-action');
    const pluginId = event.target.getAttribute('data-plugin-id');
    
    switch(action) {
        case 'configure':
            if (pluginId) configurePlugin(pluginId);
            break;
        case 'test':
            if (pluginId) testPlugin(pluginId);
            break;
        case 'copy-manifest':
            copyManifestUrl();
            break;
        case 'open-stremio':
            openStremio();
            break;
        case 'regenerate-manifest':
            regenerateManifest();
            break;
        case 'save-plugin-selection':
            savePluginSelection();
            break;
        case 'close-modal':
            closeModal();
            break;
        case 'save-config':
            if (pluginId) saveConfig(pluginId);
            break;
    }
});

// Event listener for plugin checkboxes
document.addEventListener('change', function(event) {
    if (event.target.classList.contains('plugin-checkbox')) {
        const pluginId = event.target.getAttribute('data-plugin-id');
        const enabled = event.target.checked;
        togglePluginInManifest(pluginId, enabled);
    }
});

// Load dashboard on page load
document.addEventListener('DOMContentLoaded', loadDashboard);
