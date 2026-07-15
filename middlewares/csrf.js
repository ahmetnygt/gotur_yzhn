const crypto = require("crypto");

// GÜVENLİK: CSRF koruması - "double submit cookie" deseni. `csurf` paketi
// artık bakımsız/kullanımdan kaldırılmış olduğu için harici bağımlılık
// eklemeden basit ve güvenli bir alternatif uygulanıyor:
//  1) ensureCsrfToken: oturuma bağlı rastgele bir token üretir (bir kere),
//     bunu hem res.locals'a (form'lardaki hidden input için) hem de
//     JS'in okuyabileceği (httpOnly=false) bir cookie'ye yazar.
//  2) verifyCsrfToken: durum değiştiren isteklerde (POST/PUT/PATCH/DELETE)
//     istemcinin geri gönderdiği token'ı (header veya form alanı) oturumdaki
//     token ile karşılaştırır. Saldırganın farklı bir origin'den bu cookie'yi
//     OKUYAMAMASI (same-origin policy) sayesinde koruma sağlanır.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE_NAME = "XSRF-TOKEN";

function ensureCsrfToken(req, res, next) {
    if (!req.session) return next();

    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }

    res.locals.csrfToken = req.session.csrfToken;

    // Not httpOnly: istemci tarafındaki erp.js bu cookie'yi okuyup her
    // AJAX isteğine header olarak ekliyor (bkz. public/scripts/erp.js
    // en üstündeki $.ajaxSetup çağrısı).
    res.cookie(CSRF_COOKIE_NAME, req.session.csrfToken, {
        httpOnly: false,
        sameSite: "lax",
        secure: req.app.get("env") === "production",
    });

    next();
}

function verifyCsrfToken(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) {
        return next();
    }

    const provided = req.get("x-csrf-token") || req.body?._csrf;
    const expected = req.session?.csrfToken;

    if (!expected || !provided || provided !== expected) {
        return res.status(403).json({
            message: "Güvenlik doğrulaması başarısız oldu. Lütfen sayfayı yenileyip tekrar deneyin.",
        });
    }

    next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken, CSRF_COOKIE_NAME };
