const express = require('express');
const router = express.Router();

const apiKeyAuth = require("../middlewares/apiKeyAuth");
const tenantResolver = require("../middlewares/tenantMiddleware");
const customerAuth = require("../middlewares/customerAuth");
const apiController = require("../controllers/apiController")

// 1) partner kim → API key doğrula
router.use(apiKeyAuth);

// 2) bu partner hangi firmanın datasını kullanacak → tenantResolver çözüyor
router.use(tenantResolver);

// 3) artık istek controller’a gidiyor
router.get("/stops", apiController.getStops);

router.get("/trips/search", apiController.search);

router.post("/payment/create", apiController.createPayment);
router.get("/payment/:id", apiController.getPaymentDetail);
router.post("/payment/:id/complete", apiController.paymentComplete);

// GÜVENLİK: partner API key'i çalınsa/paylaşılsa dahi müşteri hesaplarına
// karşı brute-force login/register denemelerini sınırlamak için rate limit.
const loginRateLimit = (req, res, next) => {
    const limiter = req.app.get("loginRateLimiter");
    if (limiter) return limiter(req, res, next);
    return next();
};

router.post("/auth/register", loginRateLimit, apiController.register);
router.post("/auth/login", loginRateLimit, apiController.login);

// Aşağıdaki müşteri uçları artık client'tan gelen id'ye güvenmiyor;
// customerAuth middleware'i Authorization: Bearer <token> ile doğrulanmış
// müşteri kimliğini req.customerAuth.id olarak sağlıyor (bkz. login/register).
router.get("/customer/:id", customerAuth, apiController.getProfile);
router.post("/customer/update", customerAuth, apiController.updateProfile);
router.get("/customer/:id/tickets", customerAuth, apiController.getCustomerTickets);

router.post("/ticket/cancel", customerAuth, apiController.cancelTicket);

router.get("/trips/:id/seats", apiController.getTripSeats); 

module.exports = router;