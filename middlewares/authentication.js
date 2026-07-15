const session = require("express-session")

// Şifre değiştirme akışı ve çıkış işlemi, zorunlu şifre sıfırlama sırasında
// dahi her zaman erişilebilir olmalı.
const PASSWORD_RESET_EXEMPT_PATHS = new Set(["/post-change-password", "/logout"]);

module.exports = (req, res, next) => {
    const tenantKey = req.tenantKey;
    const tenantSession = tenantKey && req.session && req.session.tenants
        ? req.session.tenants[tenantKey]
        : null;

    if (!tenantSession?.isAuthenticated) {
        req.session.redirectTo = req.originalUrl;
        req.session.errorMessage = "You must log in to access this page.";
        return req.session.save(err => {
            if (err) return next(err);
            res.redirect("/login");
        });
    }

    // Kullanıcı ilk girişte (veya bir yönetici tarafından) zorunlu şifre
    // sıfırlamaya tabi tutulduysa, şifresini değiştirene kadar veri değiştiren
    // hiçbir işlemi gerçekleştiremesin. Sayfa görüntüleme (GET) engellenmez ki
    // arayüz "şifrenizi değiştirin" uyarısını gösterebilsin.
    const isMutatingRequest = req.method !== "GET" && req.method !== "HEAD";
    if (tenantSession.forcePasswordReset && isMutatingRequest && !PASSWORD_RESET_EXEMPT_PATHS.has(req.path)) {
        return res.status(403).json({
            message: "Devam etmeden önce şifrenizi değiştirmeniz gerekiyor.",
            forcePasswordReset: true,
        });
    }

    return next();
};
