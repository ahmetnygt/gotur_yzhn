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

        const keyRecord = await ApiKey.findOne({
            where: {
                keyValue: apiKey,
                tenantKey: tenant,
                isActive: true
            }
        });

        if (!keyRecord) {
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
