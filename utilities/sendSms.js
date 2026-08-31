const axios = require("axios");

const NETGSM_SEND_URL = "https://api.netgsm.com.tr/sms/rest/v2/send";

function normalizeTrPhone(raw) {
    if (raw == null) return null;
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;

    let n = digits;
    if (n.startsWith("90") && n.length >= 12) n = n.slice(2);
    if (n.startsWith("0") && n.length === 11) n = n.slice(1);
    if (n.length === 10 && n.startsWith("5")) return n;
    return null;
}

function foldTr(str) {
    if (!str) return "";
    return String(str)
        .replace(/[Çç]/g, "C")
        .replace(/[Ğğ]/g, "G")
        .replace(/[İIıi]/g, "I")
        .replace(/[Öö]/g, "O")
        .replace(/[Şş]/g, "S")
        .replace(/[Üü]/g, "U");
}

function stopTitle(stops, id) {
    if (id == null || !Array.isArray(stops)) return "";
    const found = stops.find((s) => s && String(s.id) === String(id));
    return found?.title || "";
}

function formatTripWhen(trip) {
    if (!trip) return "";
    return `${trip.date || ""} ${trip.time || ""}`.trim();
}

function buildMessage(event, firm, trip, group, stops) {
    const firma = foldTr(firm.displayName || firm.key || "GOTUR");
    const pnr = group[0]?.pnr || "-";
    const seats = group
        .map((t) => t.seatNo)
        .filter((s) => s !== null && s !== undefined && s !== "" && Number(s) !== 0)
        .join(",");
    const from = foldTr(stopTitle(stops, group[0]?.fromRouteStopId));
    const to = foldTr(stopTitle(stops, group[0]?.toRouteStopId));
    const when = formatTripWhen(trip);
    const route = from && to ? `${from}-${to}` : "";
    const seatPart = seats ? ` Koltuk:${seats}` : "";

    switch (event) {
        case "reservation":
            return `${firma} rezervasyonunuz alindi. PNR:${pnr} ${when} ${route}${seatPart}`.replace(/\s+/g, " ").trim();
        case "complete":
            return `${firma} rezervasyonunuz satisa cevrildi. PNR:${pnr} ${when} ${route}${seatPart}`.replace(/\s+/g, " ").trim();
        case "web_sale":
            return `${firma} web biletiniz olusturuldu. PNR:${pnr} ${when} ${route}${seatPart}`.replace(/\s+/g, " ").trim();
        case "web_reservation":
            return `${firma} web rezervasyonunuz alindi. PNR:${pnr} ${when} ${route}${seatPart}`.replace(/\s+/g, " ").trim();
        case "open_sale":
            return `${firma} acik biletiniz olusturuldu. PNR:${pnr} ${route}`.replace(/\s+/g, " ").trim();
        case "cancel":
            return `${firma} PNR ${pnr} biletiniz iptal edildi.`;
        case "refund":
            return `${firma} PNR ${pnr} biletiniz iade edildi.`;
        case "transfer":
            return `${firma} PNR ${pnr} yeni sefer: ${when}${seatPart}`.replace(/\s+/g, " ").trim();
        case "open":
            return `${firma} PNR ${pnr} biletiniz aciga alindi.`;
        case "sale":
        default:
            return `${firma} biletiniz olusturuldu. PNR:${pnr} ${when} ${route}${seatPart}`.replace(/\s+/g, " ").trim();
    }
}

async function sendSms(firm, phone, message) {
    try {
        if (!firm?.isSmsActive) return { skipped: true };

        const to = normalizeTrPhone(phone);
        const username = (firm.smsUsername || "").trim();
        const password = (firm.smsPassword || "").trim();
        const header = (firm.smsHeader || "").trim();
        if (!to || !username || !password || !header || !message) {
            return { skipped: true };
        }

        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        const { data } = await axios.post(
            NETGSM_SEND_URL,
            {
                msgheader: header,
                encoding: "TR",
                iysfilter: "0",
                appname: "goturyzhn",
                messages: [{ msg: message, no: to }],
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${auth}`,
                },
                timeout: 8000,
            }
        );

        if (data?.code !== "00") {
            console.error("NetGSM hata:", data?.code, data?.description);
            return { ok: false, code: data?.code };
        }

        return { ok: true, jobid: data?.jobid };
    } catch (err) {
        console.error("SMS gonderilemedi:", err.message);
        return { ok: false };
    }
}

async function sendQueuedTicketSms({ event, tickets, trip, stops, tenantKey, commonModels }) {
    const list = tickets || [];
    if (!list.length) return;

    const firm = await commonModels?.Firm?.findOne({ where: { key: tenantKey } });
    if (!firm?.isSmsActive) return;

    const byPhone = new Map();
    for (const t of list) {
        const key = normalizeTrPhone(t.phoneNumber);
        if (!key) continue;
        if (!byPhone.has(key)) byPhone.set(key, []);
        byPhone.get(key).push(t);
    }

    for (const [phone, group] of byPhone) {
        const message = buildMessage(event, firm, trip, group, stops);
        await sendSms(firm, phone, message);
    }
}

// Bilet HTTP yanıtını NetGSM gecikmesine bağlamamak için arka planda gönderilir.
function notifyTicketSms(req, { event, tickets, trip, stops }) {
    const payload = {
        event,
        tenantKey: req.tenantKey,
        commonModels: req.commonModels,
        tickets: (tickets || []).filter(Boolean).map((t) => ({
            phoneNumber: t.phoneNumber,
            pnr: t.pnr,
            seatNo: t.seatNo,
            fromRouteStopId: t.fromRouteStopId,
            toRouteStopId: t.toRouteStopId,
        })),
        trip: trip ? { date: trip.date, time: trip.time } : null,
        stops: (stops || []).filter(Boolean).map((s) => ({
            id: s.id,
            title: s.title,
        })),
    };

    setImmediate(() => {
        sendQueuedTicketSms(payload).catch((err) => {
            console.error("notifyTicketSms:", err.message);
        });
    });
}

module.exports = {
    normalizeTrPhone,
    sendSms,
    notifyTicketSms,
};
