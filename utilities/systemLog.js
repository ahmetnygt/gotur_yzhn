// Sistem kayıtları (systemLogs) yazma katmanı.
//
// TEMEL KURAL: Log yazımı hiçbir zaman iş akışını bozmaz. Buradaki fonksiyonlar
// asla exception fırlatmaz; hata olursa konsola yazıp sessizce devam eder.
// Bir satış, log tablosuna yazamadığı için başarısız olmamalı.

const MAX_DESCRIPTION_LENGTH = 255;

// systemLogModel.module ENUM'u ile aynı olmak zorunda.
const LOG_MODULES = Object.freeze({
    TICKET: "ticket",
    TRANSACTION: "transaction",
    AUTH: "auth",
    REPORT: "report",
    USER: "user",
});

// Koltuk geçmişinde ve panelde gösterilen işlem tipleri.
const LOG_ACTIONS = Object.freeze({
    SELL: "sell",
    RESERVE: "reserve",
    COMPLETE: "complete",
    EDIT: "edit",
    CANCEL: "cancel",
    REFUND: "refund",
    OPEN: "open",
    ATTACH_OPEN: "attach_open",
    MOVE_OUT: "move_out",
    MOVE_IN: "move_in",
    DELETE_PENDING: "delete_pending",
    SELL_OPEN: "sell_open",
    WEB_SALE: "web_sale",
    WEB_RESERVE: "web_reserve",
    WEB_CANCEL: "web_cancel",
    WEB_REFUND: "web_refund",
    AUTO_CANCEL: "auto_cancel",
    AUTO_DELETE: "auto_delete",
    LOGIN: "login",
    LOGIN_FAILED: "login_failed",
    LOGOUT: "logout",
});

// Arayüzde gösterilen Türkçe karşılıklar. Koltuk geçmişi ve sistem kayıtları
// paneli aynı sözlüğü kullanır; panelin işlem filtresi de buradan üretilir.
const LOG_MODULE_LABELS = Object.freeze({
    ticket: "Bilet",
    transaction: "Kasa",
    auth: "Oturum",
    report: "Rapor",
    user: "Kullanıcı",
});

const LOG_ACTION_LABELS = Object.freeze({
    sell: "Satış",
    reserve: "Rezervasyon",
    complete: "Satışa çevirme",
    edit: "Düzenleme",
    cancel: "İptal",
    refund: "İade",
    open: "Açığa alma",
    attach_open: "Sefere bağlama",
    move_out: "Transfer (çıkış)",
    move_in: "Transfer (giriş)",
    delete_pending: "Koltuk kilidi kaldırma",
    sell_open: "Açık bilet satışı",
    web_sale: "Web satışı",
    web_reserve: "Web rezervasyonu",
    web_cancel: "Web iptali",
    web_refund: "Web iadesi",
    auto_cancel: "Otomatik iptal",
    auto_delete: "Otomatik silme",
    login: "Giriş",
    login_failed: "Başarısız giriş",
    logout: "Çıkış",
});

function moduleLabel(value) {
    return LOG_MODULE_LABELS[value] || value || "-";
}

function actionLabel(value) {
    return LOG_ACTION_LABELS[value] || value || "-";
}

// Bilet anlık görüntüsünde tutulan alanlar. Tüm satırı JSON'a gömmek yerine
// geçmiş ekranında anlamlı olan alanlarla sınırlı tutuluyor.
const TICKET_SNAPSHOT_FIELDS = Object.freeze([
    "id",
    "tripId",
    "seatNo",
    "status",
    "pnr",
    "name",
    "surname",
    "idNumber",
    "phoneNumber",
    "gender",
    "price",
    "payment",
    "fromRouteStopId",
    "toRouteStopId",
    "optionDate",
    "optionTime",
    "ticketGroupId",
]);

function toNullableId(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function truncateDescription(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    return text.length > MAX_DESCRIPTION_LENGTH
        ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
        : text;
}

function resolveActor(req) {
    const firmUser = req?.session?.firmUser || null;

    return {
        userId: toNullableId(firmUser?.id),
        branchId: toNullableId(firmUser?.branchId),
    };
}

// Sequelize instance'ı da düz obje de kabul eder.
function ticketSnapshot(ticket, extra = null) {
    if (!ticket) {
        return extra ? { ...extra } : null;
    }

    const source = typeof ticket.get === "function" ? ticket.get({ plain: true }) : ticket;
    const snapshot = {};

    TICKET_SNAPSHOT_FIELDS.forEach((field) => {
        const value = source[field];
        if (value === undefined) {
            return;
        }
        // DECIMAL alanlar (price) Sequelize'dan string gelebiliyor; JSON'da
        // tutarlı olsun diye sayıya çeviriyoruz.
        snapshot[field] = value instanceof Date ? value.toISOString() : value;
    });

    return extra ? { ...snapshot, ...extra } : snapshot;
}

// Düzenleme (edit) loglarında tüm alanları değil, gerçekten değişenleri tutar.
function diffSnapshots(before, after) {
    const oldData = {};
    const newData = {};

    const keys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {}),
    ]);

    keys.forEach((key) => {
        const previous = before ? before[key] : undefined;
        const next = after ? after[key] : undefined;

        if (String(previous ?? "") === String(next ?? "")) {
            return;
        }

        oldData[key] = previous ?? null;
        newData[key] = next ?? null;
    });

    if (!Object.keys(newData).length) {
        return null;
    }

    return { oldData, newData };
}

function buildRow(actor, entry) {
    if (!entry || !entry.module || !entry.action) {
        return null;
    }

    return {
        userId: entry.userId !== undefined ? toNullableId(entry.userId) : actor.userId,
        branchId: entry.branchId !== undefined ? toNullableId(entry.branchId) : actor.branchId,
        module: entry.module,
        action: entry.action,
        referenceId: toNullableId(entry.referenceId),
        tripId: toNullableId(entry.tripId),
        seatNo: toNullableId(entry.seatNo),
        oldData: entry.oldData ?? null,
        newData: entry.newData ?? null,
        description: truncateDescription(entry.description),
    };
}

/**
 * Birden fazla kaydı tek sorguda yazar.
 *
 * @param {object} req Express isteği (req.models.SystemLog ve oturum için)
 * @param {Array<object>} entries { module, action, referenceId, tripId, seatNo, oldData, newData, description }
 * @param {object} [options] { transaction } — verilirse log, işlemle birlikte geri alınır
 */
async function logSystemEvents(req, entries, options = {}) {
    try {
        const SystemLog = req?.models?.SystemLog;
        if (!SystemLog) {
            return [];
        }

        const list = Array.isArray(entries) ? entries : [entries];
        const actor = resolveActor(req);
        const rows = list.map((entry) => buildRow(actor, entry)).filter(Boolean);

        if (!rows.length) {
            return [];
        }

        return await SystemLog.bulkCreate(rows, { transaction: options.transaction });
    } catch (error) {
        // Loglama, ana işlemi asla düşürmez.
        console.error("SystemLog yazılamadı:", error?.message || error);
        return [];
    }
}

async function logSystemEvent(req, entry, options = {}) {
    const created = await logSystemEvents(req, [entry], options);
    return created[0] || null;
}

module.exports = {
    LOG_MODULES,
    LOG_ACTIONS,
    LOG_MODULE_LABELS,
    LOG_ACTION_LABELS,
    moduleLabel,
    actionLabel,
    logSystemEvent,
    logSystemEvents,
    ticketSnapshot,
    diffSnapshots,
};
