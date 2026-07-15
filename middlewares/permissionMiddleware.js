module.exports = (requiredPermissions = []) => {
  const codes = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  return (req, res, next) => {
    try {
      // Oturum, tenant başına req.session.tenants[tenantKey] içinde tutuluyor
      // (bkz. middlewares/tenantSessionMiddleware.js); req.session.firmUser /
      // req.session.permissions bu tenant'a ait veriye proxy'lenmiş
      // getter'lardır. Eskiden burada var olmayan `req.session.user` kontrol
      // ediliyordu, bu yüzden bu middleware her zaman 401 dönüyordu.
      const tenantKey = req.tenantKey;
      const tenantSession = tenantKey && req.session && req.session.tenants
        ? req.session.tenants[tenantKey]
        : null;

      if (!tenantSession?.isAuthenticated || !tenantSession?.firmUser) {
        return res.status(401).json({ message: "You must be logged in." });
      }

      const userPermissions = Array.isArray(tenantSession.permissions) ? tenantSession.permissions : [];
      const hasAll = codes.every(code => userPermissions.includes(code));

      if (!hasAll) {
        return res.status(403).json({ message: "You do not have permission to perform this action." });
      }

      next();
    } catch (err) {
      console.error("Permission middleware error:", err);
      res.status(500).json({ message: "Server error." });
    }
  };
};