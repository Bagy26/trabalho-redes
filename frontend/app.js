const isDevPort = window.location.port && window.location.port !== '3000';
const isFileOrigin = window.location.protocol === 'file:' || window.location.origin === 'null';

const API_URL = (isFileOrigin || isDevPort)
    ? 'http://localhost:3000'
    : window.location.origin;

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = (isFileOrigin || isDevPort)
    ? 'ws://localhost:3000'
    : `${WS_PROTOCOL}//${window.location.host}`;

// Controle de autenticação
let socket = null;
let refreshInterval = null;
let currentUser = null;

// Elementos da autenticação
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');

const loginSection = document.getElementById('login-section');
const registerSection = document.getElementById('register-section');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

const loginMessage = document.getElementById('login-message');
const registerMessage = document.getElementById('register-message');

const logoutButton = document.getElementById('logout-button');

const showRegisterButton = document.getElementById('show-register');
const showLoginButton = document.getElementById('show-login');

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

// Alterna entre as telas de login e cadastro
function showLogin() {
    loginSection.hidden = false;
    registerSection.hidden = true;

    loginMessage.textContent = '';
    registerMessage.textContent = '';
}

function showRegister() {
    loginSection.hidden = true;
    registerSection.hidden = false;

    loginMessage.textContent = '';
    registerMessage.textContent = '';
}

// Eventos dos botões de alternância
showRegisterButton.addEventListener('click', showRegister);

showLoginButton.addEventListener('click', showLogin);

// Realiza o cadastro de um novo usuário
async function registerUser(event) {
    event.preventDefault();

    registerMessage.textContent = '';

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                email,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Não foi possível realizar o cadastro.');
        }

        registerForm.reset();

        showLogin();

        loginMessage.style.color = 'var(--success)';
        loginMessage.textContent = 'Cadastro realizado! Faça login para continuar.';

    } catch (error) {
        registerMessage.style.color = 'var(--danger)';
        registerMessage.textContent = error.message;
    }
}


// Realiza o login de um usuário
async function loginUser(event) {
    event.preventDefault();

    loginMessage.textContent = '';
    loginMessage.style.color = 'var(--danger)';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Não foi possível realizar o login.');
        }

        if (!data.token) {
            throw new Error('O servidor não retornou o token de autenticação.');
        }

        // Armazena o token durante a sessão da aba
        sessionStorage.setItem('authToken', data.token);

        // Guarda os dados do usuário autenticado
        currentUser = data.user;

        loginForm.reset();

        enterDashboard();
    } catch (error) {
        loginMessage.style.color = 'var(--danger)';
        loginMessage.textContent = error.message;
    }
}

// Evento de envio do formulário de login
loginForm.addEventListener('submit', loginUser);

// Recupera o token e prepara o cabeçalho de autenticação
function getAuthHeaders() {
    const token = sessionStorage.getItem('authToken');

    if (!token) {
        return {};
    }

    return {
        Authorization: `Bearer ${token}`
    };
}

async function checkSession() {
    const token = sessionStorage.getItem('authToken');

    if (!token) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            headers: getAuthHeaders()
        });

        console.log('Resposta da sessão:', response.status);

        if (!response.ok) {
            throw new Error('Sessão inválida ou expirada.');
        }

        const data = await response.json();

        currentUser = data.user;

        console.log('Sessão recuperada:', currentUser);

        enterDashboard();

    } catch (error) {
        sessionStorage.removeItem('authToken');
        currentUser = null;

        console.log('Não foi possível recuperar a sessão:', error.message);
    }
}

checkSession();

// Libera o dashboard após a autenticação
function enterDashboard() {
    authView.hidden = true;
    dashboardView.hidden = false;
    logoutButton.hidden = false;

    loadInitialData();
    connectWebSocket();

    // Evita criar vários intervalos de atualização
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }

    refreshInterval = setInterval(refreshDevices, 3000);
}

// Encerra a sessão do usuário
function logoutUser() {
    sessionStorage.removeItem('authToken');

    currentUser = null;

    // Interrompe as atualizações periódicas
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    // Fecha a conexão WebSocket
    if (socket) {
        socket.close();
        socket = null;
    }

    // Limpa os dados apresentados no dashboard
    devices.clear();
    metrics = [];
    alerts = [];

    // Retorna para a tela de login
    dashboardView.hidden = true;
    authView.hidden = false;
    logoutButton.hidden = true;

    showLogin();
}

// Evento do botão Sair
logoutButton.addEventListener('click', logoutUser);


// Evento de envio do formulário de cadastro
registerForm.addEventListener('submit', registerUser);

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
                fetch(`${API_URL}/api/devices`, {
                    headers: getAuthHeaders()
                }),
                fetch(`${API_URL}/api/metrics?limit=100`, {
                    headers: getAuthHeaders()
                }),
                fetch(`${API_URL}/api/alerts`, {
                    headers: getAuthHeaders()
                })
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
        const response = await fetch(`${API_URL}/api/devices`, {
            headers: getAuthHeaders()
        });

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
                    <span class="status status-${escapeHTML(device.status)}">
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
        device.status = 'online';
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
// Conexão WebSocket
function connectWebSocket() {

    // Não cria outra conexão se já existir uma ativa ou em andamento
    if (!currentUser) return;

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    socket = new WebSocket(WS_URL);

    // Guarda a referência desta conexão específica
    const currentSocket = socket;

    currentSocket.addEventListener('open', () => {
        console.log('WebSocket conectado.');
        updateConnection(true);
    });

    currentSocket.addEventListener('message', event => {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'DEVICE_METRIC') {
                handleMetric(message);
            }

            if (message.type === 'ALERT_TRIGGERED') {
                handleAlert(message);
            }

            if (message.type === 'DEVICE_CONNECTED') {
                const existing = devices.get(message.deviceId);
                devices.set(message.deviceId, {
                    deviceId: message.deviceId,
                    name: message.name,
                    status: 'online',
                    lastMetric: existing?.lastMetric || null
                });
                renderDashboard();
            }

            if (message.type === 'DEVICE_DISCONNECTED') {
                const existing = devices.get(message.deviceId);
                if (existing) {
                    devices.set(message.deviceId, {
                        ...existing,
                        status: 'offline'
                    });
                    renderDashboard();
                }
            }

        } catch (error) {
            console.error('Erro ao interpretar mensagem:', error.message);
        }
    });

    currentSocket.addEventListener('close', () => {
        updateConnection(false);

        console.log('WebSocket desconectado.');

        // Só altera a conexão se ela ainda for a atual
        if (socket === currentSocket) {
            socket = null;
        }

        if (currentUser) {
            console.log('Tentando reconectar...');

            setTimeout(() => {
                connectWebSocket();
            }, 3000);
        }
    });

    currentSocket.addEventListener('error', error => {
        console.error('Erro na conexão WebSocket:', error);
    });
}