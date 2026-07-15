const crypto = require("crypto");
const { hashApiKey } = require("../utilities/apiKeyHash");

module.exports = async (req, res, next) => {
    try {
        const ApiKey = req.commonModels.ApiKey; // Comes from initGoturModels

        const apiKey = req.header("X-Api-Key");
        const tenant = req.header("X-Tenant-Key");

        if (!apiKey) {
            return res.status(401).json({ error: "API key is missing." });
        }

        if (!tenant) {
            return res.status(401).json({ error: "Tenant header is missing." });
        }

        // GÜVENLİK DÜZELTMESİ: Artık düz metin `keyValue` ile eşleştirme
        // yapılmıyor; gelen key hash'lenip `keyHash` ile karşılaştırılıyor.
        // Böylece DB'de hiçbir zaman kullanılabilir/ham bir API key tutulmuyor.
        const incomingKeyHash = hashApiKey(apiKey);

        const keyRecord = await ApiKey.findOne({
            where: {
                keyHash: incomingKeyHash,
                tenantKey: tenant,
                isActive: true
            }
        });

        if (!keyRecord || !keyRecord.keyHash) {
            return res.status(403).json({ error: "Invalid or inactive API key." });
        }

        // Ekstra sabit zamanlı karşılaştırma: DB lookup zaten hash'e göre exact
        // match yapıyor, ama bu ek kontrol savunma katmanı olarak korunuyor.
        const storedHashBuffer = Buffer.from(keyRecord.keyHash);
        const incomingHashBuffer = Buffer.from(incomingKeyHash);
        const isMatch =
            storedHashBuffer.length === incomingHashBuffer.length &&
            crypto.timingSafeEqual(storedHashBuffer, incomingHashBuffer);

        if (!isMatch) {
            return res.status(403).json({ error: "Invalid or inactive API key." });
        }

        req.apiClient = {
            id: keyRecord.id,
            name: keyRecord.name,
            tenantKey: keyRecord.tenantKey,
        };

        next();
    } catch (err) {
        console.error("API_KEY_AUTH_ERROR:", err);
        res.status(500).json({ error: "API authentication error", detail: err.message });
    }
};
