// Tenant anahtarları sadece küçük harf, rakam ve alt çizgiden oluşabilir.
// Bu, hem DB adı olarak (dolaylı) kullanılmasını hem de session/cache key
// olarak enjeksiyon riski taşımadan kullanılmasını garanti eder.
const TENANT_KEY_PATTERN = /^[a-z0-9_]+$/;

function isValidTenantKey(tenantKey) {
  return typeof tenantKey === "string" && tenantKey.length > 0 && tenantKey.length <= 64 && TENANT_KEY_PATTERN.test(tenantKey);
}

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

  const candidate = firstLabel === "www" ? (secondLabel || null) : firstLabel;

  // Geçersiz karakter içeren host etiketlerini (örn. path traversal/DB adı enjeksiyonu
  // denemeleri) burada eleyerek middleware zincirinin ilerisine hiç göndermiyoruz.
  if (!isValidTenantKey(candidate)) {
    return null;
  }

  return candidate;
}

module.exports = {
  resolveTenantKey,
  isValidTenantKey,
  TENANT_KEY_PATTERN,
};
