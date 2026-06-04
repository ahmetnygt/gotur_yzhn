const express = require('express');
const router = express.Router();

const apiKeyAuth = require("../middlewares/apiKeyAuth");
const tenantResolver = require("../middlewares/tenantMiddleware");
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

router.post("/auth/register", apiController.register);
router.post("/auth/login", apiController.login);

router.get("/customer/:id", apiController.getProfile);
router.post("/customer/update", apiController.updateProfile);
router.get("/customer/:id/tickets", apiController.getCustomerTickets); 

router.post("/ticket/cancel", apiController.cancelTicket);

module.exports = router;