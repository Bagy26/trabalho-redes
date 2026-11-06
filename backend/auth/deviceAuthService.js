
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

// Cria a pasta de dados caso não exista
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cria o arquivo de dispositivos caso não exista
if (!fs.existsSync(DEVICES_FILE)) {
    fs.writeFileSync(DEVICES_FILE, '[]', 'utf8');
}

// Carrega os dispositivos cadastrados
function loadDevices() {
    try {
        const data = fs.readFileSync(DEVICES_FILE, 'utf8');
        const devices = JSON.parse(data);

        return Array.isArray(devices) ? devices : [];
    } catch (error) {
        console.error('Erro ao carregar dispositivos:', error.message);
        return [];
    }
}

// Salva os dispositivos
function saveDevices(devices) {
    fs.writeFileSync(
        DEVICES_FILE,
        JSON.stringify(devices, null, 2),
        'utf8'
    );
}

// Cadastra um dispositivo
async function registerDevice(deviceId, name, password) {
    const devices = loadDevices();

    if (
        typeof deviceId !== 'string' ||
        typeof name !== 'string' ||
        typeof password !== 'string' ||
        !deviceId.trim() ||
        !name.trim() ||
        !password
    ) {
        throw new Error('Todos os campos são obrigatórios.');
    }

    if (password.length < 8) {
        throw new Error('A senha deve possuir pelo menos 8 caracteres.');
    }

    const normalizedId = deviceId.trim();

    const existingDevice = devices.find(
        device => device.deviceId === normalizedId
    );

    if (existingDevice) {
        throw new Error('Este dispositivo já está cadastrado.');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newDevice = {
        id: crypto.randomUUID(),
        deviceId: normalizedId,
        name: name.trim(),
        password: passwordHash,
        createdAt: new Date().toISOString()
    };

    devices.push(newDevice);

    saveDevices(devices);

    return {
        id: newDevice.id,
        deviceId: newDevice.deviceId,
        name: newDevice.name
    };
}

// Cadastra ou atualiza um dispositivo existente
async function upsertDevice(deviceId, name, password) {
    const devices = loadDevices();

    if (
        typeof deviceId !== 'string' ||
        typeof name !== 'string' ||
        typeof password !== 'string' ||
        !deviceId.trim() ||
        !name.trim() ||
        !password
    ) {
        throw new Error('Todos os campos são obrigatórios.');
    }

    if (password.length < 8) {
        throw new Error('A senha deve possuir pelo menos 8 caracteres.');
    }

    const normalizedId = deviceId.trim();
    const passwordHash = await bcrypt.hash(password, 10);

    const existingIndex = devices.findIndex(
        device => device.deviceId === normalizedId
    );

    if (existingIndex !== -1) {
        devices[existingIndex].name = name.trim();
        devices[existingIndex].password = passwordHash;
        devices[existingIndex].updatedAt = new Date().toISOString();

        saveDevices(devices);

        return {
            id: devices[existingIndex].id,
            deviceId: devices[existingIndex].deviceId,
            name: devices[existingIndex].name,
            updated: true
        };
    }

    const newDevice = {
        id: crypto.randomUUID(),
        deviceId: normalizedId,
        name: name.trim(),
        password: passwordHash,
        createdAt: new Date().toISOString()
    };

    devices.push(newDevice);

    saveDevices(devices);

    return {
        id: newDevice.id,
        deviceId: newDevice.deviceId,
        name: newDevice.name,
        created: true
    };
}

// Autentica um dispositivo
async function authenticateDevice(deviceId, password) {
    const devices = loadDevices();

    if (
        typeof deviceId !== 'string' ||
        typeof password !== 'string' ||
        !deviceId.trim() ||
        !password
    ) {
        throw new Error('Identificador e senha são obrigatórios.');
    }

    const normalizedId = deviceId.trim();

    const device = devices.find(
        device => device.deviceId === normalizedId
    );

    if (!device) {
        throw new Error('Dispositivo ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(
        password,
        device.password
    );

    if (!passwordMatches) {
        throw new Error('Dispositivo ou senha inválidos.');
    }

    return {
        id: device.id,
        deviceId: device.deviceId,
        name: device.name
    };
}


module.exports = {
    loadDevices,
    saveDevices,
    registerDevice,
    upsertDevice,
    authenticateDevice
};
