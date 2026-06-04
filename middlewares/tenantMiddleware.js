const { getTenantConnection } = require("../utilities/database");
const { initGoturModels } = require("../utilities/goturDb");
const { DEFAULT_TENANT_KEY, resolveTenantKey } = require("../utilities/tenantConfig");

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
            tenantKey = req.get("x-tenant-key") || req.get("x-tenant");

            if (!tenantKey) {
                console.error("❌ API call but tenant not found via API key.");
                return res.status(400).json({
                    error: "API tenant not found — Is X-Api-Key correct?"
                });
            }
        }

        else {
            tenantKey = resolveTenantKey(req.hostname);

            if (!tenantKey) {
                console.error("❌ Tenant/subdomain could not be resolved.");
                return res.status(400).send("Tenant could not be determined.");
            }
        }

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
