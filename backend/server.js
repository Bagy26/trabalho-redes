const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const authMiddleware = require('./auth/authMiddleware');
const {
    authenticateDevice
} = require('./auth/deviceAuthService');

const {
    registerUser,
    loginUser
} = require('./auth/authService');

const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// Cria a pasta de dados caso ela não exista
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cria o arquivo de métricas caso ele não exista
if (!fs.existsSync(METRICS_FILE)) {
    fs.writeFileSync(METRICS_FILE, '[]', 'utf8');
}
if (!fs.existsSync(ALERTS_FILE)) {
    fs.writeFileSync(ALERTS_FILE, '[]', 'utf8');
}

// Carrega as métricas já armazenadas
let metrics = [];
let alerts = [];

try {
    metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));

    if (!Array.isArray(metrics)) {
        metrics = [];
    }
} catch (error) {
    console.error('Erro ao carregar histórico:', error.message);
    metrics = [];
}
// Carrega os alertas já armazenados
try {
    alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));

    if (!Array.isArray(alerts)) {
        alerts = [];
    }
} catch (error) {
    console.error('Erro ao carregar alertas:', error.message);
    alerts = [];
}

// Dispositivos conectados
const devices = new Map();

// Salva as métricas no arquivo JSON
function saveMetrics() {
    fs.writeFileSync(
        METRICS_FILE,
        JSON.stringify(metrics, null, 2),
        'utf8'
    );
}
function saveAlerts() {
    fs.writeFileSync(
        ALERTS_FILE,
        JSON.stringify(alerts, null, 2),
        'utf8'
    );
}

// Limites de monitoramento
const ALERT_THRESHOLDS = {
    cpu: 80,
    memory: 85,
    temperature: 70,
    latency: 100
};

// Controla quais alertas já estão ativos
const activeAlerts = new Set();

// Verifica se alguma métrica ultrapassou o limite
function checkAlerts(metric) {
    const triggeredAlerts = [];

    for (const [metricName, threshold] of Object.entries(ALERT_THRESHOLDS)) {
        const value = metric[metricName];
        const alertKey = `${metric.deviceId}-${metricName}`;

        if (value > threshold && !activeAlerts.has(alertKey)) {
            const alert = {
                id: `${Date.now()}-${metric.deviceId}-${metricName}`,
                type: 'ALERT_TRIGGERED',
                deviceId: metric.deviceId,
                deviceName: metric.deviceName,
                metric: metricName,
                value,
                threshold,
                severity: 'WARNING',
                message: `${metricName} ultrapassou o limite permitido no dispositivo ${metric.deviceName}.`,
                timestamp: new Date().toISOString()
            };

            alerts.push(alert);
            triggeredAlerts.push(alert);

            activeAlerts.add(alertKey);

            console.log('ALERTA GERADO:', alert);
        }

        // Quando a métrica volta ao normal, libera um novo alerta futuro
        if (value <= threshold) {
            activeAlerts.delete(alertKey);
        }
    }

    if (triggeredAlerts.length > 0) {
        saveAlerts();
    }

    return triggeredAlerts;
}


// Envia mensagens pelo WebSocket
function sendMessage(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

// Envia mensagens aos demais dispositivos
function broadcast(message, sender) {
    for (const socket of wss.clients) {
        if (socket !== sender) {
            sendMessage(socket, message);
        }
    }
}

// Lê os dados enviados no corpo da requisição HTTP
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk;

            if (body.length > 10000) {
                reject(new Error('Corpo da requisição muito grande.'));
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                resolve(data);
            } catch (error) {
                reject(new Error('JSON inválido.'));
            }
        });

        req.on('error', (error) => {
            reject(error);
        });
    });
}

// Servidor HTTP
const server = http.createServer(async (req, res) => {
    // Configuração de CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Cadastro de usuários
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
        try {
            const { name, email, password } = await readRequestBody(req);

            const user = await registerUser(name, email, password);

            res.writeHead(201);

            res.end(JSON.stringify({
                message: 'Usuário cadastrado com sucesso!',
                user
            }));

        } catch (error) {
            console.error('Erro no cadastro:', error.message);

            res.writeHead(400);

            res.end(JSON.stringify({
                error: error.message
            }));
        }

        return;
    }

    // Login de usuários
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        try {
            const { email, password } = await readRequestBody(req);

            const result = await loginUser(email, password);

            res.writeHead(200);

            res.end(JSON.stringify({
                message: 'Login realizado com sucesso!',
                user: result.user,
                token: result.token
            }));

        } catch (error) {
            console.error('Erro no login:', error.message);

            res.writeHead(401);

            res.end(JSON.stringify({
                error: error.message
            }));
        }

        return;
    }

    // Verifica a sessão do usuário
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        authMiddleware(req, res, () => {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8'
            });

            res.end(JSON.stringify({
                user: req.user
            }));
        });

        return;
    }

    // Rota inicial

    // Entrega os arquivos da interface Web
    if (req.method === 'GET') {
        const publicFiles = {
            '/': {
                file: 'index.html',
                contentType: 'text/html; charset=utf-8'
            },
            '/index.html': {
                file: 'index.html',
                contentType: 'text/html; charset=utf-8'
            },
            '/style.css': {
                file: 'style.css',
                contentType: 'text/css; charset=utf-8'
            },
            '/app.js': {
                file: 'app.js',
                contentType: 'application/javascript; charset=utf-8'
            }
        };

        const publicFile = publicFiles[url.pathname];

        if (publicFile) {
            const filePath = path.join(FRONTEND_DIR, publicFile.file);

            fs.readFile(filePath, (error, content) => {
                if (error) {
                    res.writeHead(500);
                    res.end('Erro ao carregar a interface.');
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': publicFile.contentType
                });

                res.end(content);
            });

            return;
        }
    }
    // Consulta o histórico de alertas
    if (req.method === 'GET' && url.pathname === '/api/alerts') {
        authMiddleware(req, res, () => {
            const deviceId = url.searchParams.get('deviceId');

            let result = alerts;

            if (deviceId) {
                result = result.filter(
                    alert => alert.deviceId === deviceId
                );
            }

            res.writeHead(200);

            res.end(JSON.stringify({
                total: result.length,
                alerts: result
            }));
        });

        return;
    }

    // Verificação de saúde do servidor
    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200);

        res.end(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString()
        }));

        return;
    }

    // Lista os dispositivos conectados
    if (req.method === 'GET' && url.pathname === '/api/devices') {
        authMiddleware(req, res, () => {
            const connectedDevices = Array.from(devices.entries()).map(
                ([deviceId, socket]) => ({
                    deviceId,
                    name: socket.deviceName,
                    status: 'online'
                })
            );

            res.writeHead(200);

            res.end(JSON.stringify({
                total: connectedDevices.length,
                devices: connectedDevices
            }));
        });

        return;
    }

    // Consulta o histórico de métricas
    // Rota protegida por autenticação JWT

    if (req.method === 'GET' && url.pathname === '/api/metrics') {

        authMiddleware(req, res, () => {

            const deviceId = url.searchParams.get('deviceId');
            const limitParam = url.searchParams.get('limit');

            let result = metrics;

            if (deviceId) {
                result = result.filter(
                    metric => metric.deviceId === deviceId
                );
            }

            if (limitParam !== null) {
                const limit = Number(limitParam);

                if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
                    res.writeHead(400);

                    res.end(JSON.stringify({
                        error: 'O limite deve ser um número inteiro entre 1 e 1000.'
                    }));

                    return;
                }

                result = result.slice(-limit);
            }

            res.writeHead(200);

            res.end(JSON.stringify({
                total: result.length,
                metrics: result
            }));

        });

        return;
    }

    // Rota não encontrada
    res.writeHead(404);

    res.end(JSON.stringify({
        error: 'Rota não encontrada'
    }));
});

// WebSocket integrado ao HTTP
const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
    console.log('Novo cliente conectado!');

    sendMessage(socket, {
        type: 'WELCOME',
        message: 'Conexão estabelecida com o NetMonitor!',
        timestamp: new Date().toISOString()
    });

    socket.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            // Autenticação do dispositivo
            if (message.type === 'DEVICE_AUTH') {
                if (socket.isDeviceAuthenticated) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Este dispositivo já está autenticado.'
                    });

                    return;
                }

                const { deviceId, password } = message;

                try {
                    const authenticatedDevice = await authenticateDevice(
                        deviceId,
                        password
                    );

                    socket.isDeviceAuthenticated = true;
                    socket.authenticatedDeviceId = authenticatedDevice.deviceId;
                    socket.authenticatedDeviceName = authenticatedDevice.name;

                    console.log(`Dispositivo autenticado: ${authenticatedDevice.deviceId}`);

                    sendMessage(socket, {
                        type: 'DEVICE_AUTHENTICATED',
                        deviceId: authenticatedDevice.deviceId,
                        name: authenticatedDevice.name,
                        message: 'Autenticação realizada com sucesso!'
                    });

                } catch (error) {
                    console.log('Falha na autenticação de dispositivo:', error.message);

                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Dispositivo ou senha inválidos.'
                    });

                    socket.close(1008, 'Falha na autenticação');
                }

                return;
            }

            // Registro do dispositivo
            if (message.type === 'DEVICE_REGISTER') {

                if (!socket.isDeviceAuthenticated) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Autentique o dispositivo antes de registrá-lo.'
                    });

                    return;
                }

                const deviceId = message.deviceId;
                const name = socket.authenticatedDeviceName;

                if (deviceId !== socket.authenticatedDeviceId) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'O identificador não corresponde ao dispositivo autenticado.'
                    });

                    return;
                }

                if (
                    typeof deviceId !== 'string' ||
                    !/^[a-zA-Z0-9_-]{1,40}$/.test(deviceId) ||
                    typeof name !== 'string' ||
                    name.trim().length === 0 ||
                    name.length > 60
                ) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Identificação do dispositivo inválida.'
                    });

                    return;
                }

                const existingDevice = devices.get(deviceId);

                if (existingDevice && existingDevice !== socket) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Este identificador já está conectado.'
                    });

                    return;
                }

                socket.deviceId = deviceId;
                socket.deviceName = name.trim();

                devices.set(deviceId, socket);

                console.log(`Dispositivo registrado: ${deviceId}`);

                sendMessage(socket, {
                    type: 'DEVICE_REGISTERED',
                    deviceId,
                    message: 'Dispositivo registrado com sucesso!'
                });

                // Notifica os clientes do painel que o dispositivo conectou
                broadcast({
                    type: 'DEVICE_CONNECTED',
                    deviceId,
                    name: socket.deviceName
                }, socket);

                return;
            }

            // Recebimento das métricas
            if (message.type === 'DEVICE_METRIC') {
                if (!socket.isDeviceAuthenticated || !socket.deviceId) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Registre o dispositivo antes de enviar métricas.'
                    });

                    return;
                }

                const { cpu, memory, temperature, latency } = message;

                const validMetrics = [
                    cpu,
                    memory,
                    temperature,
                    latency
                ].every(
                    value => typeof value === 'number' && Number.isFinite(value)
                );

                if (
                    !validMetrics ||
                    cpu < 0 || cpu > 100 ||
                    memory < 0 || memory > 100 ||
                    temperature < -50 || temperature > 150 ||
                    latency < 0 || latency > 60000
                ) {
                    sendMessage(socket, {
                        type: 'ERROR',
                        message: 'Valores de métricas inválidos.'
                    });

                    return;
                }

                const metric = {
                    deviceId: socket.deviceId,
                    deviceName: socket.deviceName,
                    cpu,
                    memory,
                    temperature,
                    latency,
                    timestamp: new Date().toISOString()
                };

                // Guarda a métrica na memória e no arquivo
                metrics.push(metric);
                saveMetrics();

                // Verifica se a métrica gerou algum alerta
                const triggeredAlerts = checkAlerts(metric);

                // Envia os alertas aos dispositivos conectados
                for (const alert of triggeredAlerts) {
                    sendMessage(socket, alert);
                    broadcast(alert, socket);
                }

                console.log('Métrica armazenada:', metric);

                sendMessage(socket, {
                    type: 'METRIC_RECEIVED',
                    deviceId: socket.deviceId,
                    timestamp: metric.timestamp
                });

                // Compartilha a métrica com os outros clientes
                broadcast({
                    type: 'DEVICE_METRIC',
                    ...metric
                }, socket);

                return;
            }

            // Teste de RTT
            if (message.type === 'PING') {
                sendMessage(socket, {
                    type: 'PONG',
                    timestamp: new Date().toISOString(),
                    clientTimestamp: message.timestamp
                });

                return;
            }

            sendMessage(socket, {
                type: 'ERROR',
                message: 'Tipo de mensagem não reconhecido.'
            });

        } catch (error) {
            sendMessage(socket, {
                type: 'ERROR',
                message: 'Mensagem inválida. Envie um JSON válido.'
            });
        }
    });

    socket.on('close', () => {
        if (
            socket.deviceId &&
            devices.get(socket.deviceId) === socket
        ) {
            const disconnectedId = socket.deviceId;
            devices.delete(disconnectedId);
            console.log(`Dispositivo desconectado: ${disconnectedId}`);

            // Notifica os clientes do painel da desconexão
            broadcast({
                type: 'DEVICE_DISCONNECTED',
                deviceId: disconnectedId
            }, socket);
        } else {
            console.log('Cliente desconectado.');
        }
    });

    socket.on('error', (error) => {
        console.error('Erro WebSocket:', error.message);
    });
});

// Inicialização
server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('       NETMONITOR ONLINE        ');
    console.log('================================');
    console.log(`HTTP: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    console.log(`Histórico: ${METRICS_FILE}`);
});
