// Configuration
const API_BASE_PATH = window.location.pathname.includes('/api/')
    ? '/api/v1'
    : (document.querySelector('meta[name="api-base-path"]')?.getAttribute('content') || '/api/v1');

const REFRESH_INTERVAL = 5000; // 5 seconds
let refreshTimer = null;
let currentTab = 'overview';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    initializeRefreshButtons();
    initializeTester();
    loadAllData();
    startAutoRefresh();
});

// Tab Management
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    // Update buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    currentTab = tabName;

    // Load data for specific tab if needed
    if (tabName === 'models') {
        loadModels();
    } else if (tabName === 'rate-limits') {
        loadRateLimits();
    }
}

// Refresh Buttons
function initializeRefreshButtons() {
    document.getElementById('refresh-models')?.addEventListener('click', loadModels);
    document.getElementById('refresh-rate-limits')?.addEventListener('click', loadRateLimits);
}

// Auto Refresh
function startAutoRefresh() {
    refreshTimer = setInterval(() => {
        if (currentTab === 'overview') {
            loadMetrics();
        } else if (currentTab === 'models') {
            loadModels();
        } else if (currentTab === 'rate-limits') {
            loadRateLimits();
        }
    }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// Load All Data
async function loadAllData() {
    await Promise.all([
        checkHealth(),
        loadMetrics(),
    ]);
}

// Health Check
async function checkHealth() {
    try {
        const response = await fetch(`${API_BASE_PATH}/health`);
        const isHealthy = response.ok;

        updateServiceStatus(isHealthy);
    } catch (error) {
        console.error('Health check failed:', error);
        updateServiceStatus(false);
    }
}

function updateServiceStatus(isHealthy) {
    const statusElement = document.getElementById('service-status');
    const dotElement = statusElement?.querySelector('.status-dot');
    const textElement = statusElement?.querySelector('span:last-child');

    if (dotElement && textElement) {
        if (isHealthy) {
            dotElement.classList.remove('error');
            textElement.textContent = 'Online';
        } else {
            dotElement.classList.add('error');
            textElement.textContent = 'Offline';
        }
    }
}

// Load Metrics
async function loadMetrics() {
    try {
        const response = await fetch(`${API_BASE_PATH}/admin/metrics`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const metrics = await response.json();
        updateMetrics(metrics);
        updateLastUpdate();
    } catch (error) {
        console.error('Failed to load metrics:', error);
    }
}

function updateMetrics(metrics) {
    // Update simple metrics
    document.getElementById('total-requests').textContent = formatNumber(metrics.totalRequests || 0);
    document.getElementById('successful-requests').textContent = formatNumber(metrics.successfulRequests || 0);
    document.getElementById('failed-requests').textContent = formatNumber(metrics.failedRequests || 0);
    document.getElementById('avg-latency').innerHTML = `${formatNumber(metrics.avgLatency || 0)}<span class="unit">ms</span>`;
    document.getElementById('fallbacks-used').textContent = formatNumber(metrics.fallbacksUsed || 0);
    document.getElementById('active-connections').textContent = formatNumber(metrics.activeConnections || 0);

    // Update models status
    document.getElementById('models-available').textContent = formatNumber(metrics.modelsAvailable || 0);
    document.getElementById('models-open').textContent = formatNumber(metrics.modelsInOpenState || 0);
    document.getElementById('models-unavailable').textContent = formatNumber(metrics.modelsPermanentlyUnavailable || 0);

    // Update uptime
    document.getElementById('uptime').textContent = formatUptime(metrics.uptime || 0);
}

// Load Models State
async function loadModels() {
    const container = document.getElementById('models-list');

    if (!container) return;

    container.innerHTML = '<div class="loading-state">Loading models...</div>';

    try {
        const response = await fetch(`${API_BASE_PATH}/admin/state`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        displayModels(data.models || []);
        updateLastUpdate();
    } catch (error) {
        console.error('Failed to load models:', error);
        container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠️</span>
        <p>Failed to load models. Please try again.</p>
      </div>
    `;
    }
}

function displayModels(models) {
    const container = document.getElementById('models-list');

    if (!container) return;

    if (models.length === 0) {
        container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <p>No models found.</p>
      </div>
    `;
        return;
    }

    container.innerHTML = models.map(model => `
    <div class="model-card">
      <div class="model-header">
        <div class="model-info">
          <h3>${escapeHtml(model.modelName)}</h3>
          <div class="model-provider">${escapeHtml(model.providerName || 'Unknown Provider')}</div>
        </div>
        <div class="circuit-badge ${getCircuitClass(model.circuitState)}">
          ${getCircuitIcon(model.circuitState)} ${escapeHtml(model.circuitState || 'UNKNOWN')}
        </div>
      </div>
      <div class="model-stats">
        <div class="stat-item">
          <div class="stat-item-label">Total Requests</div>
          <div class="stat-item-value">${formatNumber(model.stats?.totalRequests || 0)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Success</div>
          <div class="stat-item-value">${formatNumber(model.stats?.successCount || 0)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Errors</div>
          <div class="stat-item-value">${formatNumber(model.stats?.errorCount || 0)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Avg Latency</div>
          <div class="stat-item-value">${formatNumber(model.stats?.avgLatency || 0)} ms</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Active Requests</div>
          <div class="stat-item-value">${formatNumber(model.activeRequests || 0)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Success Rate</div>
          <div class="stat-item-value">${calculateSuccessRate(model.stats)}%</div>
        </div>
      </div>
    </div>
  `).join('');
}

function getCircuitClass(state) {
    const stateMap = {
        'CLOSED': 'closed',
        'OPEN': 'open',
        'HALF_OPEN': 'half-open',
        'PERMANENTLY_UNAVAILABLE': 'unavailable'
    };
    return stateMap[state] || 'closed';
}

function getCircuitIcon(state) {
    const iconMap = {
        'CLOSED': '✓',
        'OPEN': '⚠',
        'HALF_OPEN': '⟳',
        'PERMANENTLY_UNAVAILABLE': '✗'
    };
    return iconMap[state] || '?';
}

function calculateSuccessRate(stats) {
    if (!stats || stats.totalRequests === 0) return 0;
    return Math.round((stats.successCount / stats.totalRequests) * 100);
}

// Load Rate Limits
async function loadRateLimits() {
    const container = document.getElementById('rate-limits-container');

    if (!container) return;

    container.innerHTML = '<div class="loading-state">Loading rate limits...</div>';

    try {
        const response = await fetch(`${API_BASE_PATH}/admin/rate-limits`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        displayRateLimits(data);
        updateLastUpdate();
    } catch (error) {
        console.error('Failed to load rate limits:', error);
        container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠️</span>
        <p>Failed to load rate limits. Please try again.</p>
      </div>
    `;
    }
}

function displayRateLimits(data) {
    const container = document.getElementById('rate-limits-container');

    if (!container) return;

    const globalLimits = data.globalLimits || {};
    const providerLimits = data.providerLimits || {};

    let html = '';

    // Global limits
    html += `
    <div class="rate-limit-card">
      <div class="rate-limit-header">
        <h3>🌐 Global Limits</h3>
      </div>
      <div class="rate-limit-stats">
        <div class="stat-item">
          <div class="stat-item-label">Requests (Minute)</div>
          <div class="stat-item-value">${formatNumber(globalLimits.requestsPerMinute || 0)} / ${formatNumber(globalLimits.maxRequestsPerMinute || 0)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Requests (Hour)</div>
          <div class="stat-item-value">${formatNumber(globalLimits.requestsPerHour || 0)} / ${formatNumber(globalLimits.maxRequestsPerHour || 0)}</div>
        </div>
      </div>
    </div>
  `;

    // Provider limits
    Object.entries(providerLimits).forEach(([provider, limits]) => {
        html += `
      <div class="rate-limit-card">
        <div class="rate-limit-header">
          <h3>🔌 ${escapeHtml(provider)}</h3>
        </div>
        <div class="rate-limit-stats">
          <div class="stat-item">
            <div class="stat-item-label">Requests (Minute)</div>
            <div class="stat-item-value">${formatNumber(limits.requestsPerMinute || 0)} / ${formatNumber(limits.maxRequestsPerMinute || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-label">Requests (Hour)</div>
            <div class="stat-item-value">${formatNumber(limits.requestsPerHour || 0)} / ${formatNumber(limits.maxRequestsPerHour || 0)}</div>
          </div>
        </div>
      </div>
    `;
    });

    container.innerHTML = html || `
    <div class="empty-state">
      <span class="empty-icon">📭</span>
      <p>No rate limit data available.</p>
    </div>
  `;
}

// API Tester
function initializeTester() {
    const sendButton = document.getElementById('send-test-request');
    const tempSlider = document.getElementById('test-temperature');
    const tempValue = document.getElementById('temp-value');

    // Temperature slider
    tempSlider?.addEventListener('input', (e) => {
        if (tempValue) {
            tempValue.textContent = e.target.value;
        }
    });

    // Send request button
    sendButton?.addEventListener('click', sendTestRequest);
}

async function sendTestRequest() {
    const button = document.getElementById('send-test-request');
    const responseContainer = document.getElementById('test-response');

    if (!button || !responseContainer) return;

    const model = document.getElementById('test-model')?.value || 'auto';
    const message = document.getElementById('test-message')?.value || 'Hello!';
    const temperature = parseFloat(document.getElementById('test-temperature')?.value || '0.7');
    const maxTokens = parseInt(document.getElementById('test-max-tokens')?.value || '150', 10);

    // Disable button
    button.disabled = true;
    button.innerHTML = '<span class="button-icon">⏳</span> Sending...';

    // Show loading state
    responseContainer.innerHTML = '<div class="loading-state">Sending request...</div>';

    const requestBody = {
        model,
        messages: [{
            role: 'user',
            content: message
        }],
        temperature,
        max_tokens: maxTokens
    };

    try {
        const startTime = Date.now();
        const response = await fetch(`${API_BASE_PATH}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        const elapsed = Date.now() - startTime;
        const data = await response.json();

        if (response.ok) {
            displayTestResponse(data, elapsed, true);
        } else {
            displayTestResponse(data, elapsed, false);
        }
    } catch (error) {
        displayTestResponse({ error: error.message }, 0, false);
    } finally {
        // Re-enable button
        button.disabled = false;
        button.innerHTML = '<span class="button-icon">🚀</span> Send Request';
    }
}

function displayTestResponse(data, elapsed, success) {
    const container = document.getElementById('test-response');

    if (!container) return;

    const className = success ? 'response-success' : 'response-error';
    const statusIcon = success ? '✓' : '✗';

    let content = '';

    if (success && data.choices && data.choices[0]) {
        const message = data.choices[0].message?.content || 'No content';
        const routerInfo = data._router || {};

        content = `
${statusIcon} Request Successful (${elapsed}ms)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Response:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Router Metadata:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Provider: ${routerInfo.provider || 'N/A'}
Model: ${routerInfo.model || 'N/A'}
Latency: ${routerInfo.latency || 0}ms
Attempts: ${routerInfo.attempts || 0}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Full Response:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${JSON.stringify(data, null, 2)}
    `;
    } else {
        content = `
${statusIcon} Request Failed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${JSON.stringify(data, null, 2)}
    `;
    }

    container.innerHTML = `<pre class="response-content ${className}">${escapeHtml(content)}</pre>`;
}

// Utility Functions
function formatNumber(num) {
    return num.toLocaleString('en-US');
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateLastUpdate() {
    const element = document.getElementById('last-update');
    if (element) {
        element.textContent = new Date().toLocaleTimeString();
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});
