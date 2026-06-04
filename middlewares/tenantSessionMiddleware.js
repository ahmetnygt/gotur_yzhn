const DEFAULT_ARRAY = Object.freeze([]);

function ensureTenantsContainer(session) {
    if (!session.tenants || typeof session.tenants !== "object") {
        session.tenants = {};
    }
    return session.tenants;
}

function ensureTenantEntry(session, tenantKey) {
    const tenants = ensureTenantsContainer(session);

    if (!tenants[tenantKey]) {
        tenants[tenantKey] = {
            isAuthenticated: false,
            firmUser: null,
            permissions: [],
            firm: null,
        };
    }

    return tenants[tenantKey];
}

function defineTenantProxy(session, tenantKey, propertyName, defaultValue) {
    Object.defineProperty(session, propertyName, {
        configurable: true,
        enumerable: true,
        get() {
            const tenantSession = session.tenants?.[tenantKey];
            if (!tenantSession) {
                return defaultValue;
            }

            const value = tenantSession[propertyName];
            if (value === undefined || value === null) {
                return defaultValue;
            }

            if (propertyName === "permissions" && !Array.isArray(value)) {
                return DEFAULT_ARRAY;
            }

            return value;
        },
        set(value) {
            const tenants = ensureTenantsContainer(session);
            const tenantSession = tenants[tenantKey] || (tenants[tenantKey] = {});

            if (value === undefined) {
                delete tenantSession[propertyName];
                return;
            }

            tenantSession[propertyName] = value;
        },
    });
}

module.exports = (req, res, next) => {
    const tenantKey = req.tenantKey;
    if (!tenantKey || !req.session) {
        res.locals.firmUser = null;
        res.locals.permissions = DEFAULT_ARRAY;
        return next();
    }

    const tenantSession = ensureTenantEntry(req.session, tenantKey);

    defineTenantProxy(req.session, tenantKey, "firmUser", null);
    defineTenantProxy(req.session, tenantKey, "permissions", DEFAULT_ARRAY);
    defineTenantProxy(req.session, tenantKey, "firm", null);
    defineTenantProxy(req.session, tenantKey, "isAuthenticated", false);

    req.tenantSession = tenantSession;
    res.locals.firmUser = tenantSession.firmUser || null;
    res.locals.permissions = Array.isArray(tenantSession.permissions)
        ? tenantSession.permissions
        : DEFAULT_ARRAY;

    next();
};
