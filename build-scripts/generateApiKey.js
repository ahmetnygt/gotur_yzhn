// Kullanım: node build-scripts/generateApiKey.js
// Ham (rastgele) bir API key üretir ve karşılık gelen hash'i yazdırır.
// Ham key partnere/istemciye verilir (X-Api-Key header'ında kullanılır);
// hash ise `apiKey` tablosundaki `keyHash` kolonuna kaydedilir. Ham key
// üretildikten sonra hiçbir yerde saklanmaz, bu yüzden tekrar görüntülenemez.
require("dotenv").config();
const { generateApiKey } = require("../utilities/apiKeyHash");

const { rawKey, keyHash } = generateApiKey();

console.log("Ham API key (partnere verilecek, bir daha gösterilmeyecek):");
console.log(rawKey);
console.log("\nDB'ye kaydedilecek hash (apiKey.keyHash):");
console.log(keyHash);
