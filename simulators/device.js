const WebSocket = require('ws');

const deviceId = process.argv[2] || 'device-01';
const deviceName = process.argv[3] || deviceId;

const socket = new WebSocket('ws://localhost:3000');

socket.on('open', () => {
    console.log(`Conectado ao NetMonitor: ${deviceId}`);

    // Identificação do dispositivo
    socket.send(JSON.stringify({
        type: 'DEVICE_REGISTER',
        deviceId,
        name: deviceName
    }));
});

socket.on('message', (data) => {
    const message = JSON.parse(data.toString());

    console.log('Resposta do servidor:', message);

    if (message.type === 'DEVICE_REGISTERED') {
        console.log(`Iniciando monitoramento de ${deviceId}...`);

        // Envia métricas a cada 3 segundos
        setInterval(() => {
            const metric = {
                type: 'DEVICE_METRIC',
                cpu: Number((Math.random() * 100).toFixed(2)),
                memory: Number((Math.random() * 100).toFixed(2)),
                temperature: Number((30 + Math.random() * 50).toFixed(2)),
                latency: Number((5 + Math.random() * 100).toFixed(2))
            };

            console.log('Enviando métricas:', metric);

            socket.send(JSON.stringify({
                type: 'DEVICE_METRIC',
                ...metric
            }));

        }, 3000);
    }
});

socket.on('close', () => {
    console.log(`Dispositivo ${deviceId} desconectado.`);
});

socket.on('error', (error) => {
    console.error('Erro no simulador:', error.message);
});
