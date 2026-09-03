const crypto = require("crypto");

// GÜVENLİK: CSRF koruması - "double submit cookie" deseni. `csurf` paketi
// artık bakımsız/kullanımdan kaldırılmış olduğu için harici bağımlılık
// eklemeden basit ve güvenli bir alternatif uygulanıyor:
//  1) ensureCsrfToken: oturuma bağlı rastgele bir token üretir (yalnızca
//     güvenli metodlarda, bir kere), bunu hem res.locals'a (form'lardaki
//     hidden input için) hem de JS'in okuyabileceği (httpOnly=false) bir
//     cookie'ye yazar. Durum değiştiren isteklerde YENİ token üretilmez;
//     aksi halde boş/düşmüş session'da tarayıcıdaki eski token ile
//     eşleşmez ve her POST sahte CSRF hatası gibi görünür.
//  2) verifyCsrfToken: durum değiştiren isteklerde (POST/PUT/PATCH/DELETE)
//     istemcinin geri gönderdiği token'ı (header veya form alanı) oturumdaki
//     token ile karşılaştırır. Session'da token yoksa oturum düşmüş sayılır;
//     token var ama eşleşmiyorsa gerçek CSRF hatasıdır.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE_NAME = "XSRF-TOKEN";

function isAjaxRequest(req) {
    return Boolean(req.xhr || req.get("X-Requested-With") === "XMLHttpRequest");
}

function setCsrfCookie(req, res, token) {
    const sessionMaxAge = req.session?.cookie?.maxAge;
    res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        sameSite: "lax",
        secure: req.secure,
        path: "/",
        // Session cookie ile aynı ömür: maxAge yoksa tarayıcı kapanınca
        // XSRF-TOKEN silinir, connect.sid kalır ve POST'lar 403 olur.
        maxAge: typeof sessionMaxAge === "number" ? sessionMaxAge : 86400000,
    });
}

function ensureCsrfToken(req, res, next) {
    if (!req.session) return next();

    const isMutating = MUTATING_METHODS.has(req.method);
    const wasMissing = !req.session.csrfToken;

    if (wasMissing) {
        if (isMutating) {
            return next();
        }
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }

    if (req.session.csrfToken) {
        res.locals.csrfToken = req.session.csrfToken;
        // Not httpOnly: istemci tarafındaki erp.js / mobile.js bu cookie'yi
        // okuyup her AJAX isteğine header olarak ekliyor.
        setCsrfCookie(req, res, req.session.csrfToken);
    }

    if (wasMissing && !isMutating) {
        return req.session.save((err) => {
            if (err) return next(err);
            next();
        });
    }

    next();
}

function verifyCsrfToken(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) {
        return next();
    }

    const provided = req.get("x-csrf-token") || req.body?._csrf;
    const expected = req.session?.csrfToken;
    const ajax = isAjaxRequest(req);

    if (!expected) {
        if (ajax) {
            return res.status(401).json({
                code: "SESSION_EXPIRED",
                message: "Oturumunuz sona erdi. Lütfen sayfayı yenileyip tekrar giriş yapın.",
            });
        }
        return res.redirect("/login");
    }

    if (!provided || provided !== expected) {
        if (ajax) {
            return res.status(403).json({
                code: "CSRF_FAILED",
                message: "Güvenlik doğrulaması başarısız oldu. Lütfen sayfayı yenileyip tekrar deneyin.",
            });
        }
        return res.redirect("/login?error=csrf");
    }

    next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken, CSRF_COOKIE_NAME };
