const crypto = require("crypto");

// Partner API üzerinden giriş yapan müşteriler için hafif, bağımlılık
// gerektirmeyen (JWT benzeri) imzalı bir oturum token'ı. Böylece
// updateProfile/getProfile/getCustomerTickets/cancelTicket gibi uçlar
// artık istekte gönderilen "id"ye kör güvenmek yerine bu token'dan gelen
// kimliği kullanır.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

function getSecret() {
  const secret = process.env.CUSTOMER_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("CUSTOMER_TOKEN_SECRET (veya SESSION_SECRET) tanımlı değil.");
  }
  return secret;
}

function signCustomerToken(customerId, tenantKey) {
  const payload = { id: customerId, tenantKey, iat: Date.now() };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(payloadEncoded)
    .digest("base64url");

  return `${payloadEncoded}.${signature}`;
}

function verifyCustomerToken(token, tenantKey) {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    return null;
  }

  let expectedSignature;
  try {
    expectedSignature = crypto
      .createHmac("sha256", getSecret())
      .update(payloadEncoded)
      .digest("base64url");
  } catch (err) {
    return null;
  }

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
  } catch (err) {
    return null;
  }

  if (!payload || !payload.id || !payload.iat) {
    return null;
  }

  if (Date.now() - payload.iat > TOKEN_TTL_MS) {
    return null;
  }

  // Bir tenant için üretilen token başka bir tenant'ta kullanılamaz.
  if (tenantKey && payload.tenantKey !== tenantKey) {
    return null;
  }

  return payload;
}

module.exports = { signCustomerToken, verifyCustomerToken };
