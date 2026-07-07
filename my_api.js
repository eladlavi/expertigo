const vm = require('vm');
const https = require('follow-redirects').https;
const fs = require('fs');
const crypto = require("crypto");
const config = require("./config");
/*
let mysql = require("mysql2");
let pool = mysql.createPool({
    connectionLimit: 1,
    host: "185.47.173.250",
    user: "remote",
    password: config.NODEJS_TEST_DB_PASSWORD,
    database: "whatsapp_db",
    queueLimit: 1,
    charset: 'utf8mb4'
});
*/
const MAX_BODY_SIZE = 10 * 1024; // 10KB max message size, protects against attackers sending huge bodies

exports.sendEmail = (req, res, q) => {

    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method not allowed');
        return;
    }

    let senderEmail = q.query && q.query.email;
    let senderName = q.query && q.query.name;

    let bodyChunks = [];
    let totalLength = 0;
    let requestAborted = false;

    req.on('data', (chunk) => {
        if (requestAborted) return;

        totalLength += chunk.length;
        if (totalLength > MAX_BODY_SIZE) {
            requestAborted = true;
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('payload too large');
            req.destroy();
            return;
        }

        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        if (requestAborted) return;

        let body = Buffer.concat(bodyChunks, totalLength).toString('utf8');
        let message = body;

        // senderEmail, senderName, message are now available here for further processing
    });

    req.on('error', () => {
        requestAborted = true;
    });
}


const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function makeid(length) {
    let result = '';

    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
};

const charactersForCode = '0123456789';
function makeCode() {
    let result = '';

    const charactersLength = charactersForCode.length;
    let counter = 0;
    while (counter < 6) {
        result += charactersForCode.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
};