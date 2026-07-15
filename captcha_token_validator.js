const crypto = require("crypto");

// Intentionally excludes ambiguous symbols: B, D, I, O, S, 0, 1, 5, 8.
const CAPTCHA_SYMBOLS = "ACEFGHJKLMNPQRTUVWXYZ234679";
const CAPTCHA_LENGTH = 5;
const CAPTCHA_TTL_MILLIS = 60 * 1000;
const TOKEN_TIMESTAMP_BYTES = 8;
const TOKEN_NONCE_BYTES = 8;
const TOKEN_IP_LENGTH_BYTES = 1;
const TOKEN_MAC_BYTES = 32;

class CaptchaTokenValidator {
    constructor(secretKey) {
        if (!secretKey || !String(secretKey).trim()) {
            throw new Error("secretKey is required");
        }
        this.secretKeyBytes = Buffer.from(String(secretKey), "utf8");
    }

    validate(token, humanInput, clientIp) {
        return this.isValid(token, humanInput, clientIp) ? "ok" : "reject";
    }

    isValid(token, humanInput, clientIp) {
        const captchaInput = this.normalizeCaptchaInput(humanInput);
        const normalizedClientIp = this.normalizeClientIp(clientIp);
        if (!token || !captchaInput || !normalizedClientIp) {
            return false;
        }

        try {
            return this.isTokenValid(token, captchaInput, normalizedClientIp, Date.now());
        } catch (err) {
            return false;
        }
    }

    createToken(captchaText, issuedAtMillis, nonce, clientIp) {
        const normalizedCaptcha = this.normalizeCaptchaInput(captchaText);
        const normalizedClientIp = this.normalizeClientIp(clientIp);
        const issuedAt = Number(issuedAtMillis);

        if (this.hasInvalidCaptchaText(normalizedCaptcha)) {
            throw new Error("captchaText must be exactly 5 uppercase letters/digits");
        }
        if (!Buffer.isBuffer(nonce) || nonce.length !== TOKEN_NONCE_BYTES) {
            throw new Error("nonce must be exactly 8 bytes");
        }
        if (!normalizedClientIp) {
            throw new Error("clientIp is required");
        }
        if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
            throw new Error("issuedAtMillis must be positive");
        }

        const ipBytes = Buffer.from(normalizedClientIp, "utf8");
        if (ipBytes.length > 255) {
            throw new Error("clientIp is too long");
        }

        const payload = Buffer.concat([
            writeInt64BE(issuedAt),
            nonce,
            Buffer.from([ipBytes.length]),
            ipBytes
        ]);
        const mac = this.hmacSha256(payload, Buffer.from(normalizedCaptcha, "ascii"));
        return toBase64Url(Buffer.concat([payload, mac]));
    }

    isValidAt(token, humanInput, clientIp, nowMillis) {
        const captchaInput = this.normalizeCaptchaInput(humanInput);
        const normalizedClientIp = this.normalizeClientIp(clientIp);
        if (!token || !captchaInput || !normalizedClientIp) {
            return false;
        }

        try {
            return this.isTokenValid(token, captchaInput, normalizedClientIp, Number(nowMillis));
        } catch (err) {
            return false;
        }
    }

    isTokenValid(token, captchaInput, clientIp, nowMillis) {
        const tokenBytes = fromBase64Url(String(token).trim());
        const minimumBytes = TOKEN_TIMESTAMP_BYTES + TOKEN_NONCE_BYTES + TOKEN_IP_LENGTH_BYTES + TOKEN_MAC_BYTES;
        if (tokenBytes.length < minimumBytes) {
            return false;
        }
        if (this.hasInvalidCaptchaText(captchaInput)) {
            return false;
        }

        let offset = 0;
        const issuedAtMillis = Number(tokenBytes.readBigInt64BE(offset));
        offset += TOKEN_TIMESTAMP_BYTES;
        if (!Number.isFinite(issuedAtMillis) || issuedAtMillis <= 0) {
            return false;
        }

        const nonce = tokenBytes.subarray(offset, offset + TOKEN_NONCE_BYTES);
        offset += TOKEN_NONCE_BYTES;
        if (nonce.length !== TOKEN_NONCE_BYTES) {
            return false;
        }

        const ipLength = tokenBytes[offset];
        offset += TOKEN_IP_LENGTH_BYTES;
        if (!ipLength) {
            return false;
        }

        const expectedTokenLength = TOKEN_TIMESTAMP_BYTES + TOKEN_NONCE_BYTES + TOKEN_IP_LENGTH_BYTES + ipLength + TOKEN_MAC_BYTES;
        if (tokenBytes.length !== expectedTokenLength) {
            return false;
        }

        const ipBytes = tokenBytes.subarray(offset, offset + ipLength);
        offset += ipLength;
        const tokenIp = ipBytes.toString("utf8");
        if (tokenIp !== clientIp) {
            return false;
        }

        const ageMillis = Number(nowMillis) - issuedAtMillis;
        if (!Number.isFinite(ageMillis) || ageMillis < 0 || ageMillis > CAPTCHA_TTL_MILLIS) {
            return false;
        }

        const tokenMac = tokenBytes.subarray(offset);
        if (tokenMac.length !== TOKEN_MAC_BYTES) {
            return false;
        }

        const payload = tokenBytes.subarray(0, expectedTokenLength - TOKEN_MAC_BYTES);
        const expectedMac = this.hmacSha256(payload, Buffer.from(captchaInput, "ascii"));
        return crypto.timingSafeEqual(expectedMac, tokenMac);
    }

    hmacSha256(payload, captchaBytes) {
        return crypto
            .createHmac("sha256", this.secretKeyBytes)
            .update(payload)
            .update(captchaBytes)
            .digest();
    }

    normalizeCaptchaInput(captchaInput) {
        if (captchaInput === null || captchaInput === undefined) {
            return null;
        }
        return String(captchaInput).trim().toUpperCase();
    }

    normalizeClientIp(clientIp) {
        if (clientIp === null || clientIp === undefined) {
            return null;
        }
        const normalized = String(clientIp).trim();
        if (!normalized) {
            return null;
        }
        return normalized.toLowerCase();
    }

    hasInvalidCaptchaText(captchaText) {
        if (!captchaText || captchaText.length !== CAPTCHA_LENGTH) {
            return true;
        }

        for (let i = 0; i < captchaText.length; i += 1) {
            if (CAPTCHA_SYMBOLS.indexOf(captchaText.charAt(i)) < 0) {
                return true;
            }
        }
        return false;
    }
}

function writeInt64BE(value) {
    const output = Buffer.alloc(8);
    output.writeBigInt64BE(BigInt(Math.trunc(value)), 0);
    return output;
}

function toBase64Url(buffer) {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function fromBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (normalized.length % 4)) % 4;
    return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

module.exports = CaptchaTokenValidator;
