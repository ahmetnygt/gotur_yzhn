const axios = require("axios");

const NETGSM_SEND_URL = "https://api.netgsm.com.tr/sms/rest/v2/send";
const SMS_TEMPLATE_MAX_LEN = 500;

const DEFAULT_SMS_TEMPLATES = Object.freeze({
    reservation: "{firma} rezervasyonunuz alindi. PNR:{pnr} {when} {route}{seatPart}",
    complete: "{firma} rezervasyonunuz satisa cevrildi. PNR:{pnr} {when} {route}{seatPart}",
    web_sale: "{firma} web biletiniz olusturuldu. PNR:{pnr} {when} {route}{seatPart}",
    web_reservation: "{firma} web rezervasyonunuz alindi. PNR:{pnr} {when} {route}{seatPart}",
    open_sale: "{firma} acik biletiniz olusturuldu. PNR:{pnr} {route}",
    cancel: "{firma} PNR {pnr} biletiniz iptal edildi.",
    refund: "{firma} PNR {pnr} biletiniz iade edildi.",
    transfer: "{firma} PNR {pnr} yeni sefer: {when}{seatPart}",
    open: "{firma} PNR {pnr} biletiniz aciga alindi.",
    sale: "{firma} biletiniz olusturuldu. PNR:{pnr} {when} {route}{seatPart}",
});

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

function stopTitle(stops, id) {
    if (id == null || !Array.isArray(stops)) return "";
    const found = stops.find((s) => s && String(s.id) === String(id));
    return found?.title || "";
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatSmsDate(raw) {
    if (raw == null || raw === "") return "";
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return `${pad2(raw.getDate())}.${pad2(raw.getMonth() + 1)}.${raw.getFullYear()}`;
    }
    const s = String(raw).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    const dmy = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
    if (dmy) return `${dmy[1]}.${dmy[2]}.${dmy[3]}`;
    return s;
}

function formatSmsTime(raw) {
    if (raw == null || raw === "") return "";
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}`;
    }
    const s = String(raw).split(".")[0].trim();
    const timePart = s.includes("T")
        ? s.split("T")[1]
        : (s.includes(" ") ? s.split(" ").pop() : s);
    const [h, m] = timePart.split(":");
    if (h == null || m == null || h === "") return "";
    return `${pad2(Number(h))}:${pad2(Number(m))}`;
}

function formatTripWhen(trip) {
    if (!trip) return "";
    return `${formatSmsDate(trip.date)} ${formatSmsTime(trip.time)}`.trim();
}

function fillTemplate(template, vars) {
    return String(template || "")
        .replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ""))
        .replace(/\s+/g, " ")
        .trim();
}

function mergeSmsTemplates(stored) {
    const result = { ...DEFAULT_SMS_TEMPLATES };
    const src = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    for (const key of Object.keys(DEFAULT_SMS_TEMPLATES)) {
        if (typeof src[key] === "string" && src[key].trim()) {
            result[key] = src[key];
        }
    }
    return result;
}

function sanitizeSmsTemplates(incoming, existing) {
    const prev = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
    const next = {};
    for (const key of Object.keys(DEFAULT_SMS_TEMPLATES)) {
        if (incoming && typeof incoming === "object" && typeof incoming[key] === "string") {
            next[key] = incoming[key].trim().slice(0, SMS_TEMPLATE_MAX_LEN);
        } else if (typeof prev[key] === "string") {
            next[key] = prev[key];
        }
    }
    return next;
}

function buildMessage(event, firm, trip, group, stops) {
    const firma = firm?.displayName || firm?.key || "GOTUR";
    const pnr = group[0]?.pnr || "-";
    const seats = group
        .map((t) => t.seatNo)
        .filter((s) => s !== null && s !== undefined && s !== "" && Number(s) !== 0)
        .join(",");
    const from = stopTitle(stops, group[0]?.fromRouteStopId);
    const to = stopTitle(stops, group[0]?.toRouteStopId);
    const when = formatTripWhen(trip);
    const route = from && to ? `${from}-${to}` : "";
    const seatPart = seats ? ` Koltuk:${seats}` : "";

    const templates = mergeSmsTemplates(firm?.smsTemplates);
    const key = DEFAULT_SMS_TEMPLATES[event] ? event : "sale";
    return fillTemplate(templates[key], {
        firma,
        pnr,
        when,
        from,
        to,
        route,
        seats,
        seatPart,
    });
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
    DEFAULT_SMS_TEMPLATES,
    SMS_TEMPLATE_MAX_LEN,
    normalizeTrPhone,
    formatTripWhen,
    fillTemplate,
    mergeSmsTemplates,
    sanitizeSmsTemplates,
    sendSms,
    notifyTicketSms,
};
