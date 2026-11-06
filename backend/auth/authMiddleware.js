const jwt = require('jsonwebtoken');
const path = require('path');

// Garante que as variáveis de ambiente estejam carregadas
if (!process.env.JWT_SECRET) {
    try {
        const dotenv = require('dotenv');
        dotenv.config({ path: path.resolve(__dirname, '../../.env') });
        dotenv.config({ path: path.resolve(__dirname, '../.env') });
        dotenv.config();
    } catch (e) {}
}

function authMiddleware(req, res, next) {
    // Verifica se a chave JWT está configurada
    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET não foi configurada.');

        res.writeHead(500, {
            'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(JSON.stringify({
            error: 'Erro interno de configuração do servidor.'
        }));

        return;
    }

    // Recupera o cabeçalho Authorization
    const authHeader = req.headers.authorization;
    console.log('Middleware executado!');
    console.log('Authorization recebido:', authHeader ? 'SIM' : 'NÃO');

    // Verifica se o token foi enviado
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, {
            'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(JSON.stringify({
            error: 'Token de autenticação não informado.'
        }));

        return;
    }

    // Extrai o token do cabeçalho
    const token = authHeader.split(' ')[1];

    try {
        // Verifica a validade do token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Disponibiliza os dados do usuário para a requisição
        req.user = decoded;

        // Permite continuar o processamento

        console.log('Token validado com sucesso!');

        next();

    } catch (error) {
        console.log('Token rejeitado:', error.message);
        res.writeHead(401, {
            'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(JSON.stringify({
            error: 'Token inválido ou expirado.'
        }));
    }
}

module.exports = authMiddleware;