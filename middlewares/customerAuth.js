const { verifyCustomerToken } = require("../utilities/customerAuthToken");

// Partner API'de "müşteri" kimliğini (Customer) doğrulayan middleware.
// register/login sırasında verilen token'ı Authorization: Bearer <token>
// (veya X-Customer-Token) header'ı üzerinden bekler ve doğrulanmış müşteri
// id'sini req.customerAuth.id olarak sağlar. Böylece controller'lar artık
// client'tan gelen id'yi tek başına güvenilir kabul etmez.
module.exports = (req, res, next) => {
  const authHeader = req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.header("X-Customer-Token") || "").trim();

  if (!token) {
    return res.status(401).json({ error: "Müşteri oturum token'ı eksik." });
  }

  const payload = verifyCustomerToken(token, req.tenantKey);
  if (!payload) {
    return res.status(401).json({ error: "Geçersiz veya süresi dolmuş oturum token'ı." });
  }

  req.customerAuth = { id: payload.id };
  next();
};
