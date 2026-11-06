const WebSocket = require('ws');

const deviceId = process.argv[2] || 'device-01';
const devicePassword = process.env.DEVICE_PASSWORD || process.argv[3] || (deviceId === 'device-01' ? 'senha-computador-01' : null);

if (!devicePassword) {
    console.error('Senha do dispositivo não configurada.');
    console.error('Exemplo: node simulators/device.js device-01 senha-computador-01');
    process.exit(1);
}

const socket = new WebSocket('ws://localhost:3000');

let metricInterval = null;

socket.on('open', () => {
    console.log(`Conectado ao NetMonitor: ${deviceId}`);

    // Primeiro, autentica o dispositivo
    socket.send(JSON.stringify({
        type: 'DEVICE_AUTH',
        deviceId,
        password: devicePassword
    }));
});

socket.on('message', (data) => {
    let message;

    try {
        message = JSON.parse(data.toString());
    } catch (error) {
        console.error('Mensagem inválida recebida:', error.message);
        return;
    }

    console.log('Resposta do servidor:', message);

    // Autenticação aprovada
    if (message.type === 'DEVICE_AUTHENTICATED') {
        console.log(`Dispositivo autenticado: ${deviceId}`);

        socket.send(JSON.stringify({
            type: 'DEVICE_REGISTER',
            deviceId
        }));

        return;
    }

    // Registro aprovado: começa o monitoramento
    if (message.type === 'DEVICE_REGISTERED') {
        console.log(`Iniciando monitoramento de ${deviceId}...`);

        if (metricInterval) return;

        metricInterval = setInterval(() => {
            const metric = {
                type: 'DEVICE_METRIC',
                cpu: Number((Math.random() * 100).toFixed(2)),
                memory: Number((Math.random() * 100).toFixed(2)),
                temperature: Number((30 + Math.random() * 50).toFixed(2)),
                latency: Number((5 + Math.random() * 100).toFixed(2))
            };

            console.log('Enviando métricas:', metric);

            socket.send(JSON.stringify(metric));

        }, 3000);

        return;
    }

    if (message.type === 'ERROR') {
        console.error('Erro do servidor:', message.message);
    }
});

socket.on('close', (code, reason) => {
    if (metricInterval) {
        clearInterval(metricInterval);
        metricInterval = null;
    }

    console.log(`Dispositivo ${deviceId} desconectado. Código: ${code} (${reason || 'sem motivo informado'})`);
});

socket.on('error', (error) => {
    console.error('Erro no simulador:', error.message);
});
