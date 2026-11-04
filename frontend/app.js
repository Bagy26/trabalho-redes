
const API_URL = window.location.origin;
const WS_URL = `ws://${window.location.host}`;

const devices = new Map();
let metrics = [];
let alerts = [];

const connectionStatus = document.getElementById('connection-status');
const connectionIndicator = document.getElementById('connection-indicator');

// Evita inserir conteúdo HTML não confiável diretamente na página
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('pt-BR');
}

function updateConnection(connected) {
    connectionStatus.textContent = connected
        ? 'Conectado ao servidor'
        : 'Desconectado';

    connectionIndicator.className = connected
        ? 'indicator online'
        : 'indicator offline';
}

// Busca os dados iniciais pela API HTTP
async function loadInitialData() {
    try {
        const [devicesResponse, metricsResponse, alertsResponse] =
            await Promise.all([
                fetch(`${API_URL}/api/devices`),
                fetch(`${API_URL}/api/metrics?limit=100`),
                fetch(`${API_URL}/api/alerts`)
            ]);

        if (!devicesResponse.ok || !metricsResponse.ok || !alertsResponse.ok) {
            throw new Error('Não foi possível consultar os dados do servidor.');
        }

        const devicesData = await devicesResponse.json();
        const metricsData = await metricsResponse.json();
        const alertsData = await alertsResponse.json();

        devices.clear();

        devicesData.devices.forEach(device => {
            devices.set(device.deviceId, {
                ...device,
                lastMetric: null
            });
        });

        metrics = metricsData.metrics;
        alerts = alertsData.alerts;

        // Recupera a última métrica de cada dispositivo
        metrics.forEach(metric => {
            const device = devices.get(metric.deviceId);

            if (device) {
                device.lastMetric = metric;
            }
        });

        renderDashboard();

    } catch (error) {
        console.error('Erro ao carregar dados:', error.message);
    }
}

// Consulta periodicamente a lista de dispositivos conectados
async function refreshDevices() {
    try {
        const response = await fetch(`${API_URL}/api/devices`);

        if (!response.ok) {
            throw new Error('Falha ao consultar dispositivos.');
        }

        const data = await response.json();

        const connectedIds = new Set(
            data.devices.map(device => device.deviceId)
        );

        // Atualiza o estado dos dispositivos conectados
        data.devices.forEach(device => {
            const existing = devices.get(device.deviceId);

            devices.set(device.deviceId, {
                ...device,
                lastMetric: existing?.lastMetric || null
            });
        });

        // Marca como desconectados os que não aparecem na API
        for (const [deviceId, device] of devices.entries()) {
            if (!connectedIds.has(deviceId)) {
                devices.set(deviceId, {
                    ...device,
                    status: 'offline'
                });
            }
        }

        renderDashboard();

    } catch (error) {
        console.error('Erro ao atualizar dispositivos:', error.message);
    }
}

function renderDashboard() {
    renderSummary();
    renderDevices();
    renderAlerts();
    renderMetrics();
}

function renderSummary() {
    const onlineDevices = [...devices.values()].filter(
        device => device.status === 'online'
    );

    const latestMetrics = onlineDevices
        .map(device => device.lastMetric)
        .filter(Boolean);

    const cpuAverage = latestMetrics.length
        ? latestMetrics.reduce((sum, metric) => sum + metric.cpu, 0) /
        latestMetrics.length
        : 0;

    const memoryAverage = latestMetrics.length
        ? latestMetrics.reduce((sum, metric) => sum + metric.memory, 0) /
        latestMetrics.length
        : 0;

    document.getElementById('device-count').textContent =
        onlineDevices.length;

    document.getElementById('alert-count').textContent = alerts.length;

    document.getElementById('cpu-average').textContent =
        `${cpuAverage.toFixed(1)}%`;

    document.getElementById('memory-average').textContent =
        `${memoryAverage.toFixed(1)}%`;
}

function renderDevices() {
    const container = document.getElementById('devices-list');

    if (devices.size === 0) {
        container.innerHTML =
            '<p class="empty">Nenhum dispositivo encontrado.</p>';
        return;
    }

    container.innerHTML = [...devices.values()].map(device => {
        const metric = device.lastMetric;

        return `
            <article class="device-card">
                <div class="device-top">
                    <strong>${escapeHTML(device.name)}</strong>
                    <span class="status">
                        ${escapeHTML(device.status)}
                    </span>
                </div>

                <div class="metric-details">
                    <span>CPU: ${metric ? metric.cpu + '%' : '--'}</span>
                    <span>Memória: ${metric ? metric.memory + '%' : '--'}</span>
                    <span>Temperatura: ${metric ? metric.temperature + ' °C' : '--'}</span>
                    <span>Latência: ${metric ? metric.latency + ' ms' : '--'}</span>
                </div>
            </article>
        `;
    }).join('');
}

function renderAlerts() {
    const container = document.getElementById('alerts-list');

    if (alerts.length === 0) {
        container.innerHTML =
            '<p class="empty">Nenhum alerta registrado.</p>';
        return;
    }

    container.innerHTML = [...alerts]
        .slice(-10)
        .reverse()
        .map(alert => `
            <article class="alert-card">
                <div class="alert-top">
                    <strong>${escapeHTML(alert.deviceName)}</strong>
                    <span class="alert-time">
                        ${escapeHTML(formatTime(alert.timestamp))}
                    </span>
                </div>

                <p>${escapeHTML(alert.message)}</p>

                <p>
                    Valor: ${escapeHTML(alert.value)}
                    | Limite: ${escapeHTML(alert.threshold)}
                </p>
            </article>
        `).join('');
}

function renderMetrics() {
    const tbody = document.getElementById('metrics-table');

    if (metrics.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty">
                    Nenhuma métrica recebida.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = [...metrics]
        .slice(-20)
        .reverse()
        .map(metric => `
            <tr>
                <td>${escapeHTML(metric.deviceName)}</td>
                <td>${escapeHTML(metric.cpu)}%</td>
                <td>${escapeHTML(metric.memory)}%</td>
                <td>${escapeHTML(metric.temperature)} °C</td>
                <td>${escapeHTML(metric.latency)} ms</td>
                <td>${escapeHTML(formatTime(metric.timestamp))}</td>
            </tr>
        `).join('');
}

// Atualiza o painel quando uma nova métrica chega
function handleMetric(metric) {
    metrics.push(metric);

    if (metrics.length > 100) {
        metrics = metrics.slice(-100);
    }

    const device = devices.get(metric.deviceId);

    if (device) {
        device.lastMetric = metric;
    } else {
        devices.set(metric.deviceId, {
            deviceId: metric.deviceId,
            name: metric.deviceName,
            status: 'online',
            lastMetric: metric
        });
    }

    document.getElementById('last-update').textContent =
        `Última atualização: ${formatTime(metric.timestamp)}`;

    renderDashboard();
}

// Atualiza o painel quando um alerta chega
function handleAlert(alert) {
    alerts.push(alert);
    renderDashboard();
}

// Conexão WebSocket
function connectWebSocket() {
    const socket = new WebSocket(WS_URL);

    socket.addEventListener('open', () => {
        console.log('WebSocket conectado.');
        updateConnection(true);
    });

    socket.addEventListener('message', event => {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'DEVICE_METRIC') {
                handleMetric(message);
            }

            if (message.type === 'ALERT_TRIGGERED') {
                handleAlert(message);
            }

        } catch (error) {
            console.error('Erro ao interpretar mensagem:', error.message);
        }
    });

    socket.addEventListener('close', () => {
        updateConnection(false);
        console.log('WebSocket desconectado. Tentando reconectar...');

        setTimeout(connectWebSocket, 3000);
    });

    socket.addEventListener('error', error => {
        console.error('Erro na conexão WebSocket:', error);
        socket.close();
    });
}

// Inicialização do painel
loadInitialData();
connectWebSocket();

// Atualiza os dispositivos conectados a cada 3 segundos
setInterval(refreshDevices, 3000);
