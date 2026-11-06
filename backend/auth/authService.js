const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Garante que as variáveis de ambiente estejam carregadas
if (!process.env.JWT_SECRET) {
    try {
        const dotenv = require('dotenv');
        dotenv.config({ path: path.resolve(__dirname, '../../.env') });
        dotenv.config({ path: path.resolve(__dirname, '../.env') });
        dotenv.config();
    } catch (e) {}
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Cria a pasta de dados caso ela não exista
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cria o arquivo de usuários caso ele não exista
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}

// Carrega os usuários cadastrados
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        const users = JSON.parse(data);

        return Array.isArray(users) ? users : [];
    } catch (error) {
        console.error('Erro ao carregar usuários:', error.message);
        return [];
    }
}

// Armazena os usuários no arquivo JSON
function saveUsers(users) {
    fs.writeFileSync(
        USERS_FILE,
        JSON.stringify(users, null, 2),
        'utf8'
    );
}


async function registerUser(name, email, password) {
    const users = loadUsers();

    // Validação dos campos
    if (
        typeof name !== 'string' ||
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        !name.trim() ||
        !email.trim() ||
        !password
    ) {
        throw new Error('Todos os campos são obrigatórios.');
    }

    if (password.length < 8) {
        throw new Error('A senha deve possuir pelo menos 8 caracteres.');
    }

    // Verifica se o e-mail já está cadastrado
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = users.find(
        user => user.email === normalizedEmail
    );

    if (existingUser) {
        throw new Error('Este e-mail já está cadastrado.');
    }

    // Gera o hash da senha
    const passwordHash = await bcrypt.hash(password, 10);

    // Cria o novo usuário
    const newUser = {
        id: crypto.randomUUID(), name: name.trim(),
        email: normalizedEmail,
        password: passwordHash,
        createdAt: new Date().toISOString()
    };

    users.push(newUser);

    saveUsers(users);

    return {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email
    };
}


async function loginUser(email, password) {
    const users = loadUsers();

    // Valida os campos
    if (
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        !email.trim() ||
        !password
    ) {
        throw new Error('E-mail e senha são obrigatórios.');
    }

    // Procura o usuário pelo e-mail
    const normalizedEmail = email.trim().toLowerCase();

    const user = users.find(
        user => user.email === normalizedEmail
    );

    if (!user) {
        throw new Error('E-mail ou senha inválidos.');
    }

    // Compara a senha informada com o hash armazenado
    const passwordMatches = await bcrypt.compare(
        password,
        user.password
    );

    if (!passwordMatches) {
        throw new Error('E-mail ou senha inválidos.');
    }

    // Gera o token JWT
    if (!process.env.JWT_SECRET) {
        throw new Error('A chave JWT não foi configurada.');
    }

    const token = jwt.sign(
        {
            id: user.id,
            name: user.name,
            email: user.email
        },
        process.env.JWT_SECRET,
        {
            expiresIn: '1h'
        }

    );

    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email
        },
        token
    };
}


module.exports = {
    loadUsers,
    saveUsers,
    registerUser,
    loginUser
};