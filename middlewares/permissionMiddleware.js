module.exports = (requiredPermissions = []) => {
  const codes = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  return (req, res, next) => {
    try {
      if (!req.session || !req.session.user) {
        return res.status(401).json({ message: "You must be logged in." });
      }

      const userPermissions = req.session.permissions || [];
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