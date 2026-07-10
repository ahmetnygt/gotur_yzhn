const { getTenantConnection } = require("../utilities/database");
const { initGoturModels } = require("../utilities/goturDb");
const { resolveTenantKey } = require("../utilities/tenantConfig");

let cachedCommonModels;
function getCommonModels() {
    if (!cachedCommonModels) cachedCommonModels = initGoturModels();
    return cachedCommonModels;
}

module.exports = async (req, res, next) => {
    try {
        let tenantKey;

        const isApiRequest =
            req.originalUrl.startsWith("/api/") ||
            req.path.startsWith("/api/");

        if (isApiRequest) {
            // API İsteklerinde tenantKey artık doğrudan apiKeyAuth'dan (güvenli kaynaktan) gelecek.
            // Header'a güvenmek yerine, DB'den onaylanmış token'ın yetkili olduğu tenantı kullanıyoruz.
            if (!req.apiClient || !req.apiClient.tenantKey) {
                console.error("❌ Unauthorized API tenant request.");
                return res.status(401).json({ error: "Unauthorized tenant." });
            }
            tenantKey = req.apiClient.tenantKey;
        }
        else {
            // Web isteklerinde subdomain üzerinden tenant tespiti
            tenantKey = resolveTenantKey(req.hostname);

            if (!tenantKey) {
                console.error("❌ Tenant/subdomain could not be resolved.");
                return res.status(400).send("Tenant could not be determined.");
            }
        }

        // Veritabanı bağlantısını kur veya hazır olanı getir
        const { sequelize, models } = await getTenantConnection(tenantKey);

        req.db = sequelize;
        req.models = models;
        req.commonModels = getCommonModels();
        req.tenantKey = tenantKey;

        return next();

    } catch (err) {
        console.error("❌ Tenant Middleware Crash:", err);
        return res.status(500).json({ error: "Tenant resolution error", detail: err.message });
    }
};