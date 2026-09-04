const { getTenantConnection, TenantNotFoundError } = require("../utilities/database");
const { initGoturModels } = require("../utilities/goturDb");
const { resolveTenantKey } = require("../utilities/tenantConfig");

const PUBLIC_SITE_URL = "https://goturyzhn.com";
const UNKNOWN_TENANT_MESSAGE =
    "Bu adreste kayıtlı bir Götür firması yok. Panel adresiniz firmaniz.goturyzhn.com formatındadır.";

let cachedCommonModels;
function getCommonModels() {
    if (!cachedCommonModels) cachedCommonModels = initGoturModels();
    return cachedCommonModels;
}

function isApiRequest(req) {
    return (
        req.originalUrl.startsWith("/api/") ||
        req.path.startsWith("/api/")
    );
}

function respondUnknownTenant(req, res, err) {
    console.warn("Bilinmeyen tenant:", err?.message || err, req.ip);

    if (isApiRequest(req)) {
        return res.status(404).json({ error: "Unknown tenant." });
    }

    return res.status(404).render("error", {
        status: 404,
        isNotFound: true,
        isUnknownTenant: true,
        isNoNavbar: true,
        title: "Firma bulunamadı",
        message: UNKNOWN_TENANT_MESSAGE,
        homeUrl: PUBLIC_SITE_URL,
        permissions: [],
        error: {},
    });
}

function respondTenantFailure(req, res) {
    if (isApiRequest(req)) {
        return res.status(500).json({ error: "Tenant resolution error" });
    }

    return res.status(500).render("error", {
        status: 500,
        isNotFound: false,
        isNoNavbar: true,
        title: "Hata",
        message: "Beklenmeyen bir hata oluştu.",
        permissions: [],
        error: {},
    });
}

module.exports = async (req, res, next) => {
    try {
        let tenantKey;

        if (isApiRequest(req)) {
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
                return respondUnknownTenant(
                    req,
                    res,
                    new TenantNotFoundError("Geçersiz veya tanımsız tenant anahtarı.")
                );
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
        if (err instanceof TenantNotFoundError) {
            return respondUnknownTenant(req, res, err);
        }

        console.error("Tenant middleware:", err);
        return respondTenantFailure(req, res);
    }
};
