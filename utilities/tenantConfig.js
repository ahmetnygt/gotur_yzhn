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

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// Bir hostname'in gerçekten bir kiracıya (firma) ait subdomain mi taşıdığını,
// yoksa "çıplak" (subdomainsiz) kök alan adı mı olduğunu belirler.
//   - "localhost"                -> false (subdomain yok, tek etiket)
//   - "goturyzhn.com"            -> false (sadece kök alan adı, 2 etiket)
//   - "www.goturyzhn.com"        -> false ("www" gerçek bir firma değildir)
//   - "acente1.goturyzhn.com"    -> true  (gerçek firma subdomain'i)
//   - "acente1.localhost"        -> true  (local geliştirmede "localhost" kök
//                                    alan adı gibi davranır; "acente1" subdomain'dir)
function hasSubdomain(hostname) {
  if (!hostname) {
    return false;
  }

  const normalizedHost = String(hostname).toLowerCase();

  // IP adresi üzerinden erişim (örn. sunucuya doğrudan "1.2.3.4" ile bağlanmak)
  // subdomain kavramı taşımaz; ilk oktet'i firma anahtarı gibi yorumlamamalıyız.
  if (IPV4_PATTERN.test(normalizedHost)) {
    return false;
  }

  const labels = normalizedHost
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (labels.length <= 1) {
    return false;
  }

  const [firstLabel, secondLabel] = labels;

  if (labels.length === 2 && secondLabel !== "localhost") {
    return false;
  }

  if (labels.length === 3 && firstLabel === "www") {
    return false;
  }

  return true;
}

module.exports = {
  resolveTenantKey,
  isValidTenantKey,
  hasSubdomain,
  TENANT_KEY_PATTERN,
};
