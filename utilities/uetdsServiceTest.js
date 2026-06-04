const soap = require("soap");
const publicIp = require("public-ip");

const WSDL_URL = "https://servis.turkiye.gov.tr/services/g2g/kdgm/test/uetdsarizi?wsdl";

(async () => {
    try {
        const client = await soap.createClientAsync(WSDL_URL);

        const username = "999999"; // <== test kullanıcı adın
        const password = "999999testtest"; // <== test şifren
        // HTTP Basic Auth ekle
        client.setSecurity(new soap.BasicAuthSecurity(username, password));

        const [result] = await client.servisTestAsync({ testMsj1: "Merhaba Götür" });
        console.log(result);
        const [res] = await client.kullaniciKontrolAsync({
            wsuser: username,
            wspass: password
        });
        console.log(result);

        // DB’den alacaksan burayı dinamik yapabilirsin
        // 1️⃣ IP adresini otomatik bul
        const ip = await publicIp.publicIpv4();
        console.log("🌐 IP adresin:", ip);

        // 3️⃣ Gönderilecek XML parametreleri
        const args = {
            wsuser: {
                kullaniciAdi: username,
                sifre: password
            },
            ipBaslangic: ip
        };

        // 4️⃣ Çağrıyı gönder
        // console.log("📤 UETDS ipTanimla isteği gönderiliyor...");
        // const [resulttt,  soapHeader, rawRequest] = await client.ipTanimlaAsync(args);

        // // 5️⃣ Yanıtı yazdır
        // console.log("✅ UETDS ipTanimla sonucu:");
        // console.dir(resulttt, { depth: null });
        console.log("seferDetayCiktisiAl: ")
        console.log(client.describe().UdhbUetdsAriziService.UdhbUetdsAriziServicePort.seferDetayCiktisiAl)
    } catch (err) {
        console.error("❌ SOAP Hatası:", err);
    }
})();