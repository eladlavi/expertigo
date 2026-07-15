const vm = require('vm');
const https = require('follow-redirects').https;
const fs = require('fs');
const crypto = require("crypto");
const config = require("./config");
const sendEmailService = require("./send_email");
const CaptchaTokenValidator = require("./captcha_token_validator");
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
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 4000;
const CONTACT_RECIPIENT_EMAIL = "elad@expertigo.co.il";
const CAPTCHA_TOKEN_HEADER_NAME = "x-captcha-token";
const CAPTCHA_SECRET_KEY = config.CAPTCHA_SECRET_KEY || "REPLACE_WITH_YOUR_CAPTCHA_SECRET_KEY";
const PUBLIC_IP_LOOKUP_HOST = "api.ipify.org";
const PUBLIC_IP_LOOKUP_PATH = "/";
const PUBLIC_IP_CACHE_TTL_MS = 5 * 60 * 1000;
const captchaTokenValidator = new CaptchaTokenValidator(CAPTCHA_SECRET_KEY);

let cachedPublicIpForLocalTesting = "";
let publicIpCacheUpdatedAt = 0;
let isRefreshingPublicIpCache = false;

refreshPublicIpCache();

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

exports.contactUs = (req, res, q) => {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method not allowed');
        return;
    }

    readRequestBodyWithLimit(req, res, MAX_BODY_SIZE, (body) => {
        let bodyObject = null;
        const contentType = String(req.headers["content-type"] || "").toLowerCase();
        if (contentType.indexOf("application/json") >= 0 && body) {
            try {
                bodyObject = JSON.parse(body);
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('invalid json body');
                return;
            }
        }

        const token = firstNonEmpty(
            q.query && q.query.token,
            req.headers[CAPTCHA_TOKEN_HEADER_NAME]
        );
        const captchaInput = firstNonEmpty(
            q.query && q.query.captcha,
            bodyObject && bodyObject.captcha
        );

        if (!token || !captchaInput) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('captcha and token are required');
            return;
        }

        const clientIp = extractClientIp(req);
        const validCaptcha = captchaTokenValidator.isValid(token, captchaInput, clientIp);
        if (!validCaptcha) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('invalid or expired captcha');
            return;
        }

        const senderName = sanitizeName(firstNonEmpty(
            q.query && q.query.name,
            bodyObject && bodyObject.name
        ));
        const senderEmail = sanitizeEmail(firstNonEmpty(
            q.query && q.query.email,
            bodyObject && bodyObject.email
        ));
        const message = sanitizeMessage(firstNonEmpty(
            bodyObject && bodyObject.message,
            body
        ));

        if (!senderName || !senderEmail || !message) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('name, email and message are required');
            return;
        }

        const emailSubject = "New contact-us message from " + senderName;
        const emailBody = [
            "Contact Us message",
            "",
            "Name: " + senderName,
            "Email: " + senderEmail,
            "Client IP: " + clientIp,
            "",
            message
        ].join("\n");

        //console.log("Sending contact-us email to " + CONTACT_RECIPIENT_EMAIL + " with subject: " + emailSubject);
        
        sendEmailService.sendSimpleMessage(CONTACT_RECIPIENT_EMAIL, emailSubject, emailBody)
            .then(() => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('ok');
            })
            .catch(() => {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('could not send message');
            });
        
        });
};

function readRequestBodyWithLimit(req, res, maxBodyBytes, onSuccess) {
    let bodyChunks = [];
    let totalLength = 0;
    let requestAborted = false;

    req.on('data', (chunk) => {
        if (requestAborted) {
            return;
        }

        totalLength += chunk.length;
        if (totalLength > maxBodyBytes) {
            requestAborted = true;
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('payload too large');
            req.destroy();
            return;
        }

        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        if (requestAborted) {
            return;
        }

        const body = Buffer.concat(bodyChunks, totalLength).toString('utf8');
        onSuccess(body);
    });

    req.on('error', () => {
        requestAborted = true;
    });
}

function firstNonEmpty(...candidates) {
    for (let i = 0; i < candidates.length; i += 1) {
        const value = candidates[i];
        if (value === null || value === undefined) {
            continue;
        }
        const normalized = String(value).trim();
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

function extractClientIp(req) {
    const realIpByNginx = firstNonEmpty(req.headers["x-real-ip"]);
    if (realIpByNginx) {
        return realIpByNginx.toLowerCase();
    }

    const forwardedIp = extractForwardedClientIp(req.headers["x-forwarded-for"]);
    if (forwardedIp) {
        return forwardedIp;
    }

    const remoteAddress = firstNonEmpty(
        req.socket && req.socket.remoteAddress,
        req.connection && req.connection.remoteAddress
    );
    const normalizedRemoteAddress = normalizeIp(remoteAddress);

    // Local dev fallback: if Node only sees loopback, use cached public IP from an online lookup.
    if (isLoopbackIp(normalizedRemoteAddress)) {
        if (Date.now() - publicIpCacheUpdatedAt > PUBLIC_IP_CACHE_TTL_MS) {
            refreshPublicIpCache();
        }
        if (cachedPublicIpForLocalTesting) {
            return cachedPublicIpForLocalTesting;
        }
    }

    return normalizedRemoteAddress || "";
}

function extractForwardedClientIp(xForwardedForHeaderValue) {
    const header = firstNonEmpty(xForwardedForHeaderValue);
    if (!header) {
        return null;
    }

    const firstForwarded = header.split(",")[0];
    const normalized = normalizeIp(firstForwarded);
    return normalized || null;
}

function normalizeIp(ipValue) {
    const value = firstNonEmpty(ipValue);
    if (!value) {
        return "";
    }
    return value.toLowerCase();
}

function isLoopbackIp(ip) {
    return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

function refreshPublicIpCache() {
    if (isRefreshingPublicIpCache) {
        return;
    }

    isRefreshingPublicIpCache = true;
    const request = https.get(
        {
            host: PUBLIC_IP_LOOKUP_HOST,
            path: PUBLIC_IP_LOOKUP_PATH,
            timeout: 2500
        },
        (response) => {
            let body = "";
            response.on("data", (chunk) => {
                body += chunk.toString("utf8");
                if (body.length > 128) {
                    request.destroy();
                }
            });
            response.on("end", () => {
                const fetchedIp = normalizeIp(body);
                if (fetchedIp) {
                    cachedPublicIpForLocalTesting = fetchedIp;
                    publicIpCacheUpdatedAt = Date.now();
                }
                isRefreshingPublicIpCache = false;
            });
            response.on("error", () => {
                isRefreshingPublicIpCache = false;
            });
        }
    );

    request.on("error", () => {
        isRefreshingPublicIpCache = false;
    });

    request.on("timeout", () => {
        request.destroy();
    });
}

function sanitizeName(value) {
    if (!value) {
        return null;
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.length > MAX_NAME_LENGTH) {
        return null;
    }
    return normalized;
}

function sanitizeEmail(value) {
    if (!value) {
        return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized.length > MAX_EMAIL_LENGTH) {
        return null;
    }

    const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!basicEmailRegex.test(normalized)) {
        return null;
    }

    return normalized;
}

function sanitizeMessage(value) {
    if (!value) {
        return null;
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.length > MAX_MESSAGE_LENGTH) {
        return null;
    }
    return normalized;
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