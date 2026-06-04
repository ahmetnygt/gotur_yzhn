const session = require("express-session")

module.exports = (req, res, next) => {
    const tenantKey = req.tenantKey;
    const tenantSession = tenantKey && req.session && req.session.tenants
        ? req.session.tenants[tenantKey]
        : null;

    if (tenantSession?.isAuthenticated) {
        return next();
    }
    req.session.redirectTo = req.originalUrl;
    req.session.errorMessage = "You must log in to access this page.";
    req.session.save(err => {
        if (err) return next(err);
        res.redirect("/login");
    });
};
