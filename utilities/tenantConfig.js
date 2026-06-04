function resolveTenantKey(hostname) {
  if (!hostname) {
    return null;
  }

  const normalizedHost = String(hostname).toLowerCase();
  const labels = normalizedHost
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (labels.length < 2) {
    return null;
  }

  const [firstLabel, secondLabel] = labels;

  if (firstLabel === "www") {
    return secondLabel || null;
  }

  return firstLabel
}

module.exports = {
  resolveTenantKey,
};
