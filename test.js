import fetch from "node-fetch";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://uetds.unetws.udhb.gov.tr/">
  <soap:Body>
    <tns:seferSorgula>
      <UetdsYtsUser>
        <kullaniciAdi>999999</kullaniciAdi>
        <sifre>999999testtest</sifre>
      </UetdsYtsUser>
      <uetdsSeferSorgulaInput>
        <firmaSeferNo>162</firmaSeferNo>
      </uetdsSeferSorgulaInput>
    </tns:seferSorgula>
  </soap:Body>
</soap:Envelope>`;

const res = await fetch("https://servis.turkiye.gov.tr/services/g2g/kdgm/test/uetdsarizi", {
    method: "POST",
    headers: {
        "Content-Type": "text/xml;charset=utf-8",
        "SOAPAction": "http://uetds.unetws.udhb.gov.tr/uetdsarizi/seferSorgula",
        "Authorization": "Basic " + Buffer.from("999999:999999testtest").toString("base64")
    },
    body: xml
});

console.log(await res.text());