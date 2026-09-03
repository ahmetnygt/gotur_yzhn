// Şifre değiştirme akışı ve çıkış işlemi, zorunlu şifre sıfırlama sırasında
// dahi her zaman erişilebilir olmalı.
const PASSWORD_RESET_EXEMPT_PATHS = new Set(["/post-change-password", "/logout"]);

function isAjaxRequest(req) {
    if (req.xhr) {
        return true;
    }

    const requestedWith = String(req.get("X-Requested-With") || "");
    if (requestedWith.toLowerCase() === "xmlhttprequest") {
        return true;
    }

    const accept = String(req.get("Accept") || "");
    return accept.includes("application/json") && !accept.includes("text/html");
}

module.exports = (req, res, next) => {
    const tenantKey = req.tenantKey;
    const tenantSession = tenantKey && req.session && req.session.tenants
        ? req.session.tenants[tenantKey]
        : null;

    if (!tenantSession?.isAuthenticated) {
        // AJAX/fetch isteklerinde 302 /login HTML'i jQuery success'e düşüp
        // sefer listesi gibi panellere basılıyordu. JSON 401 ile istemci
        // tam sayfa login'e yönlendirilir.
        if (isAjaxRequest(req)) {
            return res.status(401).json({
                message: "You must log in to access this page.",
                redirect: "/login",
            });
        }

        // /logout gibi çıkış adresini dönüş yolu olarak saklama; girişten
        // sonra tekrar /logout'a düşüp 404'te kalınmasına yol açıyordu.
        if (req.method === "GET" && req.path !== "/logout") {
            req.session.redirectTo = req.originalUrl;
        }
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
