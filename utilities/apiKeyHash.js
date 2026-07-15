const crypto = require("crypto");

// API key'ler artık düz metin olarak DB'de saklanmıyor; sadece HMAC-SHA256
// hash'i saklanıyor. Hash deterministik olduğu için "WHERE keyHash = ?" ile
// arama yapılabiliyor (bcrypt gibi salt'lı algoritmalar bunu desteklemez).
// HMAC kullanmak, ham SHA-256'ya göre bir sunucu sırrı gerektirdiğinden DB
// sızıntısı durumunda hash'in offline brute-force edilmesini de zorlaştırır.
const API_KEY_HASH_SECRET =
  process.env.API_KEY_HASH_SECRET || process.env.SESSION_SECRET || "gotur-api-key-secret";

function hashApiKey(rawKey) {
  if (typeof rawKey !== "string" || !rawKey) {
    return null;
  }
  return crypto.createHmac("sha256", API_KEY_HASH_SECRET).update(rawKey).digest("hex");
}

function generateApiKey() {
  const rawKey = crypto.randomBytes(32).toString("base64url");
  return { rawKey, keyHash: hashApiKey(rawKey) };
}

module.exports = { hashApiKey, generateApiKey };
