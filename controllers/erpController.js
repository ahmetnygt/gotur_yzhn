var express = require('express');
var router = express.Router();
const bcrypt = require("bcrypt")
const { Op } = require('sequelize');
const fs = require("fs");
const path = require("path");
const { generateAccountReceiptFromDb } = require('../utilities/reports/accountCutRecipe');
const generateTripSeatPlanReport = require('../utilities/reports/tripSeatPlanReport');
const generateSalesRefundReportDetailed = require('../utilities/reports/salesRefundReportDetailed');
const generateSalesRefundReportSummary = require('../utilities/reports/salesRefundReportSummary');
const generateWebTicketsReportByBusSummary = require('../utilities/reports/webTicketsByBusSummary');
const generateWebTicketsReportByBusDetailed = require('../utilities/reports/webTicketsByBusDetailed');
const generateWebTicketsReportByStopDetailed = require('../utilities/reports/webTicketsByStopDetailed');
const generateWebTicketsReportByStopSummary = require('../utilities/reports/webTicketsByStopSummary');
const { generateDailyUserAccountReport, formatCurrency: formatDailyCurrency } = require('../utilities/reports/dailyUserAccountReport');
const generateUpcomingTicketsReport = require("../utilities/reports/upcomingTicketsReport");
const generateExternalReturnTicketsReport = require('../utilities/reports/externalReturnTicketsReport');
const generateBusTransactionsReport = require("../utilities/reports/busTransactionsReport");
const countries = require("world-countries");
const { seferEkle, kullaniciKontrol, seferIptal, seferAktif, seferPlakaDegistir, personelEkle, personelIptal, seferGrupGuncelle, yolcuEkle, seferGrupListesi, seferGrupEkle, yolcuIptalUetdsYolcuRefNoIle, seferDetayCiktisiAl } = require('../utilities/uetdsService');

const TURKISH_COLLATOR = (() => {
    try {
        return new Intl.Collator("tr", { sensitivity: "base" });
    } catch (error) {
        return {
            compare: (a = "", b = "") => String(a).localeCompare(String(b), "tr", { sensitivity: "base" }),
        };
    }
})();

const NATIONALITY_OPTIONS = Object.freeze(
    countries
        .map(country => {
            const rawCode = (country?.cca2 || "").toUpperCase();

            if (!rawCode) {
                return null;
            }

            const turkishName = country?.translations?.tur?.common;
            const englishName = country?.name?.common;
            const displayName = turkishName || englishName || rawCode;
            const label = `${rawCode} - ${displayName}`;

            const searchParts = new Set();
            if (turkishName) searchParts.add(turkishName);
            if (englishName) searchParts.add(englishName);
            if (country?.name?.official) searchParts.add(country.name.official);
            if (Array.isArray(country?.altSpellings)) {
                country.altSpellings.forEach(spelling => {
                    if (spelling) {
                        searchParts.add(spelling);
                    }
                });
            }
            if (country?.cca3) searchParts.add(country.cca3);
            if (country?.cioc) searchParts.add(country.cioc);
            searchParts.add(rawCode);
            searchParts.add(rawCode.toLowerCase());

            return {
                value: rawCode.toLowerCase(),
                label,
                searchText: Array.from(searchParts).join(" "),
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.value === "tr") return -1;
            if (b.value === "tr") return 1;
            return TURKISH_COLLATOR.compare(a.label, b.label);
        })
);

async function generatePNR(models, fromId, toId, stops) {
    const from = stops.find(s => s.id == fromId)?.title;
    const to = stops.find(s => s.id == toId)?.title;
    const turkishMap = { "Ç": "C", "Ş": "S", "İ": "I", "Ğ": "G", "Ü": "U", "Ö": "O", "ç": "C", "ş": "S", "ı": "I", "ğ": "G", "ü": "U", "ö": "O" };

    const clean = str => str
        .split('')
        .map(c => turkishMap[c] || c)
        .join('')
        .toUpperCase()
        .substring(0, 2);

    const fromCode = clean(from);
    const toCode = clean(to);

    let pnr;
    let exists = true;

    while (exists) {
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        pnr = `${fromCode}${toCode}${rand}`;
        exists = await models.Ticket.findOne({ where: { pnr } });
    }

    return pnr;
};

function emptyLikeToNull(value) {
    if (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return null;
    }
    return value;
}

const removeDiacritics = (value) =>
    typeof value === "string"
        ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        : value;

function normalizeTakeText(value) {
    if (typeof value !== "string") {
        return "";
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }

    let lowered;
    try {
        lowered = trimmed.toLocaleLowerCase("tr-TR");
    } catch (error) {
        lowered = trimmed.toLowerCase();
    }

    return removeDiacritics(lowered).replace(/\s+/g, " ").trim();
}

async function prepareTakeValueCache(model) {
    if (!model) {
        return null;
    }

    const entries = await model.findAll();
    const map = new Map();

    entries.forEach(entry => {
        const key = normalizeTakeText(entry?.title || "");
        if (key) {
            map.set(key, entry);
        }
    });

    return { model, map };
}

async function ensureTakeValue(cache, title) {
    const trimmed = typeof title === "string" ? title.trim() : "";
    if (!trimmed) {
        return null;
    }

    if (!cache) {
        return trimmed;
    }

    const normalized = normalizeTakeText(trimmed);
    if (!normalized) {
        return trimmed;
    }

    let record = cache.map.get(normalized) || null;

    if (record) {
        if (record.title !== trimmed) {
            record.title = trimmed;
            await record.save();
        }
        return record.title;
    }

    record = await cache.model.create({ title: trimmed });
    cache.map.set(normalized, record);
    return record.title;
}

const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
const DEFAULT_LOGIN_LOGO = "gotur_yzhn_logo.png";
const LOGIN_LOGO_DIRECTORY = path.join(__dirname, "..", "public", "images");

const NON_ACTIVE_TICKET_STATUSES = Object.freeze(["canceled", "cancelled", "refund"]);

function sanitizeForLogoLookup(value) {
    if (!value) {
        return "";
    }

    return value
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}

function normalizeIdentityNumber(value) {
    if (value === undefined || value === null) {
        return "";
    }

    const str = typeof value === "string" ? value : String(value);
    return str.trim();
}

async function resolveFirmLoginLogo(req, firm = null) {
    const candidates = [];

    if (req.tenantKey) {
        candidates.push(req.tenantKey);
    }

    let resolvedFirm = firm;

    if (!resolvedFirm && req.commonModels?.Firm && req.tenantKey) {
        try {
            resolvedFirm = await req.commonModels.Firm.findOne({ where: { key: req.tenantKey } });
        } catch (error) {
            console.error("Firm lookup error:", error);
        }
    }

    if (resolvedFirm?.displayName) {
        candidates.push(resolvedFirm.displayName);
    }

    const seen = new Set();

    for (const candidate of candidates) {
        const sanitized = sanitizeForLogoLookup(candidate);

        if (!sanitized || seen.has(sanitized)) {
            continue;
        }

        seen.add(sanitized);

        for (const ext of LOGO_EXTENSIONS) {
            const fileName = `${sanitized}${ext}`;
            const filePath = path.join(LOGIN_LOGO_DIRECTORY, fileName);

            if (fs.existsSync(filePath)) {
                return fileName;
            }
        }
    }

    return DEFAULT_LOGIN_LOGO;
}

function convertEmptyFieldsToNull(obj) {
    const result = {};
    for (const key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) {
            result[key] = emptyLikeToNull(obj[key]);
        }
    }
    return result;
}

function formatTripDateTime(dateStr, timeStr) {
    if (!dateStr) {
        return '';
    }

    const [year = '', month = '', day = ''] = String(dateStr).split('-');
    if (!year || !month || !day) {
        return '';
    }

    const [hour = '00', minute = '00'] = String(timeStr || '').split(':');
    const pad = value => String(value ?? '').padStart(2, '0');

    return `${pad(day)}/${pad(month)}/${year} ${pad(hour)}:${pad(minute)}`;
}

function normalizePlanBinary(planBinary) {
    if (Array.isArray(planBinary)) {
        return planBinary.map(value => (Number(value) ? 1 : 0));
    }

    if (planBinary === null || planBinary === undefined) {
        return [];
    }

    const raw = String(planBinary).trim();
    if (!raw) {
        return [];
    }

    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map(value => (Number(value) ? 1 : 0));
            }
        } catch (err) {
            console.warn('PlanBinary JSON parse failed:', err.message);
        }
    }

    const sanitized = /^[01]+$/.test(raw) ? raw : raw.replace(/[^01]/g, '');
    return Array.from(sanitized).map(char => (char === '1' ? 1 : 0));
}

async function calculateBusAccountData(models, tripId, stopId, user) {
    const tickets = await models.Ticket.findAll({
        where: {
            tripId,
            fromRouteStopId: stopId,
            status: { [Op.in]: ["completed"] }
        },
        raw: true
    });

    const branch = await models.Branch.findOne({
        where: { id: user.branchId },
        raw: true
    });
    const isPaysInternet = branch?.isPaysInternet

    let webTickets = [];
    if (isPaysInternet) {
        webTickets = await models.Ticket.findAll({
            where: {
                tripId,
                fromRouteStopId: stopId,
                status: { [Op.in]: ["web", "gotur"] }
            },
            raw: true
        });
    }

    const cargos = await models.Cargo.findAll({
        where: { tripId, fromStopId: stopId },
        raw: true
    });

    const allTickets = [...tickets, ...webTickets];

    const ticketUserIds = allTickets.map(t => t.userId).filter(Boolean);
    const cargoUserIds = cargos.map(c => c.userId).filter(Boolean);
    const userIds = [...new Set([...ticketUserIds, ...cargoUserIds])];

    const users = await models.FirmUser.findAll({
        where: { id: { [Op.in]: userIds } },
        raw: true
    });

    const userBranch = {};
    users.forEach(u => (userBranch[u.id] = u.branchId));

    const totalCount = allTickets.length + cargos.length;
    let totalAmount = 0;
    let myCash = 0,
        myCard = 0,
        otherBranches = 0;
    let cargoCount = 0;
    let cargoAmount = 0;

    const parseAmount = value => {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    };

    const accumulateByOwner = (amount, payment, ownerId) => {
        const branchId = userBranch[ownerId];
        if (ownerId === user.id) {
            if (payment === "cash") myCash += amount;
            else if (payment === "card") myCard += amount;
        } else if (branchId !== undefined && branchId !== null && branchId !== user.branchId) {
            otherBranches += amount;
        }
    };

    allTickets.forEach(t => {
        const amount = parseAmount(t.price);
        totalAmount += amount;
        accumulateByOwner(amount, t.payment, t.userId);
    });

    cargos.forEach(c => {
        const amount = parseAmount(c.price);
        cargoCount += 1;
        cargoAmount += amount;
        totalAmount += amount;
        accumulateByOwner(amount, c.payment, c.userId);
    });

    const allTotal = myCash + myCard + otherBranches;

    return {
        totalCount,
        totalAmount,
        myCash,
        myCard,
        otherBranches,
        allTotal,
        cargoCount,
        cargoAmount,
        isPaysInternet
    };
}

function addTime(baseTime, addTime) {
    const [h1, m1, s1] = baseTime.split(":").map(Number);
    const [h2, m2, s2] = addTime.split(":").map(Number);

    let totalSeconds = (h1 * 3600 + m1 * 60 + s1) + (h2 * 3600 + m2 * 60 + s2);

    totalSeconds = totalSeconds % (24 * 3600);

    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor(totalSeconds % 3600 / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");

    return `${hh}:${mm}:${ss}`;
}

function timeToSeconds(timeString) {
    if (!timeString || typeof timeString !== "string") {
        return 0;
    }

    const parts = timeString.split(":").map(Number);
    if (!parts.length || parts.some(isNaN)) {
        return 0;
    }

    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

function parseDateTimeInput(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const [datePart, timePart = ""] = trimmed.split(/\s+/);
    if (!datePart) {
        return null;
    }

    const [year, month, day] = datePart.split("-").map(Number);
    if (![year, month, day].every(num => Number.isFinite(num))) {
        return null;
    }

    const [hourRaw = 0, minuteRaw = 0] = timePart.split(":").map(Number);
    const hour = Number.isFinite(hourRaw) ? hourRaw : 0;
    const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;

    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return date;
}

function secondsToTime(totalSeconds) {
    const secondsInDay = 24 * 3600;
    const normalized = ((totalSeconds % secondsInDay) + secondsInDay) % secondsInDay;

    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);
    const seconds = normalized % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTimeWithoutSeconds(timeString) {
    if (!timeString) {
        return timeString;
    }
    return timeString.endsWith(":00") ? timeString.slice(0, -3) : timeString;
}

function buildOffsetMap(offsetRows = []) {
    const map = new Map();
    offsetRows.forEach(row => {
        const routeStopId = row.routeStopId ?? row.get?.("routeStopId");
        const rawOffset = row.offsetMinutes ?? row.get?.("offsetMinutes");
        if (routeStopId === undefined || routeStopId === null) {
            return;
        }
        const offset = Number(rawOffset) || 0;
        map.set(Number(routeStopId), offset);
    });
    return map;
}

function computeRouteStopTimes(trip, routeStops = [], offsetMap = new Map()) {
    const results = [];
    let baseSeconds = timeToSeconds(trip.time);
    let cumulativeOffsetSeconds = 0;

    for (const rs of routeStops) {
        baseSeconds += timeToSeconds(rs.duration);
        const routeStopKey = Number(rs.id);
        const offsetMinutes = offsetMap.get(routeStopKey) || 0;
        cumulativeOffsetSeconds += offsetMinutes * 60;
        const adjustedSeconds = baseSeconds + cumulativeOffsetSeconds;
        results.push({
            routeStopId: routeStopKey,
            stopId: rs.stopId,
            order: rs.order,
            time: secondsToTime(adjustedSeconds),
        });
    }

    return results;
}

function normalizeTicketIdToken(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        const tokenMatch = trimmed.match(/^ticket-(\d+)$/i);
        if (tokenMatch) {
            const parsed = Number(tokenMatch[1]);
            return Number.isNaN(parsed) ? null : parsed;
        }

        const parsed = Number(trimmed);
        return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
}

function parseTicketIdTokens(rawValues) {
    if (!Array.isArray(rawValues)) {
        return { ids: [], invalid: true };
    }

    const seen = new Set();
    const ids = [];

    for (const value of rawValues) {
        const normalized = normalizeTicketIdToken(value);
        if (normalized === null) {
            return { ids: [], invalid: true };
        }

        if (seen.has(normalized)) {
            return { ids: [], invalid: true };
        }

        seen.add(normalized);
        ids.push(normalized);
    }

    return { ids, invalid: false };
}

async function buildOpenTicketMoveContext(models, tickets) {
    if (!Array.isArray(tickets) || !tickets.length) {
        return {
            trip: { dateString: "--/--", timeString: "--.--" },
            tickets: [],
        };
    }

    const stopIds = new Set();
    tickets.forEach(ticket => {
        if (ticket?.fromRouteStopId) {
            stopIds.add(Number(ticket.fromRouteStopId));
        }
        if (ticket?.toRouteStopId) {
            stopIds.add(Number(ticket.toRouteStopId));
        }
    });

    const stops = stopIds.size
        ? await models.Stop.findAll({ where: { id: { [Op.in]: [...stopIds] } } })
        : [];
    const stopMap = new Map(stops.map(stop => [String(stop.id), stop.title]));

    const firstTicket = tickets[0];

    const pad = value => String(value).padStart(2, "0");

    let dateString = "--/--";
    if (firstTicket?.optionDate) {
        const date = new Date(firstTicket.optionDate);
        if (!Number.isNaN(date)) {
            dateString = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
        }
    }

    let rawTime = firstTicket?.optionTime || "";
    if (rawTime.includes(" ")) {
        rawTime = rawTime.split(" ").pop();
    }
    const timeParts = rawTime ? rawTime.split(":") : [];
    const hourPart = timeParts[0] ? pad(timeParts[0]) : null;
    const minutePart = timeParts[1] ? pad(timeParts[1]) : null;
    const timeString = hourPart && minutePart ? `${hourPart}.${minutePart}` : "--.--";

    const trip = {
        dateString,
        timeString,
    };

    const assignValue = (ticket, key, value) => {
        if (!ticket) {
            return;
        }
        if (typeof ticket.setDataValue === "function") {
            ticket.setDataValue(key, value);
        } else {
            ticket[key] = value;
        }
    };

    tickets.forEach((ticket, index) => {
        const fromTitle = stopMap.get(String(ticket.fromRouteStopId)) || "-";
        const toTitle = stopMap.get(String(ticket.toRouteStopId)) || "-";

        assignValue(ticket, "fromPlaceString", fromTitle);
        assignValue(ticket, "toPlaceString", toTitle);
        assignValue(ticket, "displaySeatNo", String(index + 1).padStart(2, "0"));
        assignValue(ticket, "moveToken", `ticket-${ticket.id}`);
    });

    if (tickets[0]) {
        const first = tickets[0];
        assignValue(first, "fromPlaceString", first.fromPlaceString || "-");
        assignValue(first, "toPlaceString", first.toPlaceString || "-");
    }

    return { trip, tickets };
}

function computeRouteStopDateTimes(trip, routeStops = [], offsetMap = new Map()) {
    if (!trip) {
        return new Map();
    }

    const baseDateTime = parseDateTimeInput(`${trip.date} ${trip.time}`) || new Date(`${trip.date}T${trip.time || "00:00:00"}`);
    if (!(baseDateTime instanceof Date) || Number.isNaN(baseDateTime.getTime())) {
        return new Map();
    }

    const map = new Map();
    let cumulativeDurationSeconds = 0;
    let cumulativeOffsetSeconds = 0;

    for (const rs of routeStops) {
        const routeStopId = Number(rs.id);
        cumulativeDurationSeconds += timeToSeconds(rs.duration);
        const offsetMinutes = offsetMap.get(routeStopId) || 0;
        cumulativeOffsetSeconds += Number(offsetMinutes) * 60;
        const totalSecondsFromStart = cumulativeDurationSeconds + cumulativeOffsetSeconds;
        const computedDate = new Date(baseDateTime.getTime() + totalSecondsFromStart * 1000);
        map.set(routeStopId, computedDate);
    }

    return map;
}

function formatTripDateForDisplay(dateString) {
    if (!dateString || typeof dateString !== "string") {
        return "";
    }

    const [year, month, day] = dateString.split("-").map(Number);
    if ([year, month, day].some(value => !Number.isFinite(value))) {
        return dateString;
    }

    return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

async function buildBusTransactionDescription(models, trip, stopId, bus, routeStops = [], stops = []) {
    if (!trip) {
        return "";
    }

    const orderedRouteStops = [...routeStops].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const offsets = orderedRouteStops.length
        ? await models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true })
        : [];
    const offsetMap = buildOffsetMap(offsets);
    const stopTimes = computeRouteStopTimes(trip, orderedRouteStops, offsetMap);

    const matchedRouteStop = orderedRouteStops.find(rs => rs.stopId == stopId);
    let stopTimeString = trip.time;

    if (matchedRouteStop) {
        const matchedRouteStopId = Number(matchedRouteStop.id);
        const matchedStopTime = stopTimes.find(st => Number(st.routeStopId) === matchedRouteStopId);
        if (matchedStopTime?.time) {
            stopTimeString = matchedStopTime.time;
        }
    }

    const formattedTime = formatTimeWithoutSeconds(stopTimeString);
    const formattedDate = formatTripDateForDisplay(trip.date);

    const startStop = stops.find(s => s.id == stopId);
    const lastRouteStop = orderedRouteStops[orderedRouteStops.length - 1];
    const endStop = lastRouteStop ? stops.find(s => s.id == lastRouteStop.stopId) : undefined;

    const segments = [];

    if (bus?.licensePlate) {
        segments.push(bus.licensePlate);
    }

    const dateTimeSegment = [formattedDate, formattedTime].filter(Boolean).join(" ").trim();
    if (dateTimeSegment) {
        segments.push(dateTimeSegment);
    }

    const routeSegmentParts = [];
    if (startStop?.title) {
        routeSegmentParts.push(startStop.title);
    }
    if (endStop?.title) {
        routeSegmentParts.push(endStop.title);
    }
    if (routeSegmentParts.length) {
        segments.push(routeSegmentParts.join(" - "));
    }

    return segments.join(" | ");
}

function parseTimeInputToMinutes(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    const parts = value.split(":").map(Number);
    if (!parts.length || parts.some(isNaN)) {
        return null;
    }

    const [hours = 0, minutes = 0, seconds = 0] = parts;
    const totalSeconds = (hours * 60 + minutes) * 60 + seconds;
    return Math.floor(totalSeconds / 60);
}

function getSeatTypes(planBinary) {
    const SEATS_PER_ROW = 5;
    const seatTypes = {};
    let seatNo = 0;

    for (let i = 0; i < planBinary.length; i++) {
        if (planBinary[i] !== '1') continue;

        seatNo++;
        const col = i % SEATS_PER_ROW;

        const hasLeft = col > 0 && planBinary[i - 1] === '1';
        const hasRight = col < SEATS_PER_ROW - 1 && planBinary[i + 1] === '1';
        seatTypes[seatNo] = (hasLeft || hasRight) ? 'double' : 'single';
    }

    return seatTypes;
}

exports.getSeatTypes = getSeatTypes;

const ACTIVE_TICKET_STATUSES_FOR_SINGLE_SEAT_LIMIT = ["completed", "reservation", "web", "gotur"];

function normalizeTimeInput(value) {
    if (!value && value !== 0) {
        return null;
    }

    if (typeof value !== "string") {
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    if (/^\d{1,2}:\d{2}:\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
        return `${trimmed}:00`;
    }

    return trimmed;
}

function toIntegerOrNull(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return null;
    }

    return parsed;
}

async function checkReservationLimit(models, trip, route, newReservationCount) {
    if (!trip || !route) {
        return { exceeded: false };
    }

    const limit = toIntegerOrNull(route.maxReservationCount);
    if (!limit || limit <= 0) {
        return { exceeded: false };
    }

    const existingCount = await models.Ticket.count({
        where: { tripId: trip.id, status: "reservation" },
    });

    if (existingCount + newReservationCount > limit) {
        return { exceeded: true, limit, existingCount };
    }

    return { exceeded: false, limit, existingCount };
}

async function checkSingleSeatLimit(models, trip, route, seatNumbers, excludedTicketIds = []) {
    if (!trip || !route || !Array.isArray(seatNumbers) || !seatNumbers.length) {
        return { exceeded: false };
    }

    const limit = toIntegerOrNull(route.maxSingleSeatCount);
    if (!limit || limit <= 0) {
        return { exceeded: false };
    }

    const busModel = await models.BusModel.findByPk(trip.busModelId, { raw: true });
    if (!busModel?.planBinary) {
        return { exceeded: false };
    }

    const seatTypes = getSeatTypes(busModel.planBinary);
    const singleSeatNumbers = Object.entries(seatTypes)
        .filter(([, type]) => type === "single")
        .map(([seat]) => Number(seat))
        .filter(num => !Number.isNaN(num));

    if (!singleSeatNumbers.length) {
        return { exceeded: false };
    }

    const uniqueSeatNumbers = [...new Set(seatNumbers.map(num => Number(num)).filter(num => !Number.isNaN(num)))];
    const newSingleSeatCount = uniqueSeatNumbers.filter(seat => singleSeatNumbers.includes(seat)).length;

    if (!newSingleSeatCount) {
        return { exceeded: false, limit };
    }

    const where = {
        tripId: trip.id,
        status: { [Op.in]: ACTIVE_TICKET_STATUSES_FOR_SINGLE_SEAT_LIMIT },
        seatNo: { [Op.in]: singleSeatNumbers },
    };

    if (excludedTicketIds.length) {
        where.id = { [Op.notIn]: excludedTicketIds };
    }

    const existingCount = await models.Ticket.count({ where });

    if (existingCount + newSingleSeatCount > limit) {
        return { exceeded: true, limit, existingCount, newSingleSeatCount };
    }

    return { exceeded: false, limit, existingCount, newSingleSeatCount };
}

exports.test = async (req, res, next) => {
    try {
        const tripId = 13;
        await generateAccountReceiptFromDb(tripId, 1, 'ticket.pdf');
        res.send('ticket.pdf created');
    } catch (err) {
        console.error('PDF generation error:', err);
        res.status(500).json({ message: err.message });
    }
};
exports.getDayTripsList = async (req, res, next) => {
    try {
        const date = req.query.date;
        var stopId = req.query.stopId;
        const tripId = req.query.tripId;

        if (!stopId) {
            const branch = await req.models.Branch.findOne({ where: { id: req.session.firmUser.branchId } })
            if (branch)
                stopId = branch.stopId
        }

        if (!date) {
            return res.status(400).json({ error: "Date information is missing." });
        }

        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ error: "Invalid date format." });
        }

        const routeStopsByPlace = await req.models.RouteStop.findAll({ where: { stopId: stopId } })
        const routeIds = [...new Set(routeStopsByPlace.map(s => s.routeId))];

        const isPastPermission = req.session.permissions.includes("TRIP_PAST_VIEW")
        const isInactivePermission = req.session.permissions.includes("TRIP_CANCELLED_VIEW")
        const isRestrictionDisabledLocal = value =>
            value === false || value === "false" || value === 0 || value === "0";

        const trips = await req.models.Trip.findAll({
            where: { date: date, routeId: { [Op.in]: routeIds } },
            include: [
                {
                    model: req.models.Route, as: "route", attributes: ["id", "routeCode", "title"], include: [
                        { model: req.models.Stop, as: "fromStop", attributes: ["id", "title"] },
                        { model: req.models.Stop, as: "toStop", attributes: ["id", "title"] }
                    ]
                },
                { model: req.models.BusModel, as: "busModel", attributes: ["id", "title", "maxPassenger", "planBinary"] },
                { model: req.models.Bus, as: "bus", attributes: ["id", "licensePlate"] },
                { model: req.models.Staff, as: "captain", attributes: ["id", "name", "surname"] }
            ], order: [["time", "ASC"]]
        });

        const fromStop = await req.models.Stop.findOne({ where: { id: stopId } })

        const busModels = await req.models.BusModel.findAll({ where: { id: { [Op.in]: [...new Set(trips.map(t => t.busModelId))] } } })

        var newTrips = []
        for (let i = 0; i < trips.length; i++) {
            const t = trips[i];

            t.fromPlaceString = fromStop.title

            t.isExpired = new Date(`${t.date} ${t.time}`) < new Date()

            if (!isPastPermission) {
                if (t.isExpired) {
                    continue
                }
            }
            if (!isInactivePermission) {
                if (!t.isActive) {
                    continue
                }
            }

            t.modifiedTime = t.time

            const ticketCount = await req.models.Ticket.count({ where: { tripId: t.id } })

            t.fullness = `${ticketCount}/${busModels.find(bm => bm.id == t.busModelId).maxPassenger}`

            const routeStops = await req.models.RouteStop.findAll({ where: { routeId: t.routeId }, order: [["order", "ASC"]] })
            const matchedRouteStop = routeStops.find(rs => rs.stopId == stopId)
            if (!matchedRouteStop) {
                continue
            }
            const routeStopOrder = matchedRouteStop.order

            const futureRouteStops = routeStops.filter(rs => rs.order > routeStopOrder)
            if (futureRouteStops.length) {
                const restrictions = await req.models.RouteStopRestriction.findAll({
                    where: { tripId: t.id, fromRouteStopId: matchedRouteStop.id },
                    attributes: ["toRouteStopId", "isAllowed"],
                    raw: true
                })

                const restrictionMap = new Map(
                    restrictions.map(r => [String(r.toRouteStopId), r.isAllowed])
                )

                const allRestricted = futureRouteStops.every(rs => {
                    const key = String(rs.id)
                    if (!restrictionMap.has(key)) {
                        return false
                    }

                    return isRestrictionDisabledLocal(restrictionMap.get(key))
                })

                if (allRestricted) {
                    continue
                }
            }

            if (routeStopOrder !== routeStops.length - 1) {
                const offsets = await req.models.TripStopTime.findAll({ where: { tripId: t.id }, raw: true })
                const offsetMap = buildOffsetMap(offsets)
                const stopTimes = computeRouteStopTimes(t, routeStops, offsetMap)
                const currentStopTime = stopTimes.find(st => st.order === routeStopOrder)
                if (currentStopTime) {
                    t.modifiedTime = currentStopTime.time
                }

                newTrips.push(t)
            }
        }

        const tripArray = newTrips.map(trip => {
            const tripDate = new Date(trip.date);
            const [hours, minutes] = trip.modifiedTime.split(":");
            const pad = (num) => String(num).padStart(2, "0");

            return {
                ...trip.toJSON(),
                dateString: `${new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(tripDate)}`,
                timeString: `${hours}.${minutes}`,
                isExpired: trip.isExpired,
                fullness: trip.fullness
            };
        });
        res.render("mixins/tripRow", { trips: tripArray, tripId })
    } catch (err) {
        console.error("getDayTripsList error:", err);
        res.status(500).json({ error: "Server error." });
    }
};

exports.getTrip = async (req, res, next) => {
    const tripDate = req.query.date
    const tripTime = req.query.time
    const tripId = req.query.tripId
    var stopId = req.query.stopId

    if (!stopId) {
        const branch = await req.models.Branch.findOne({ where: { id: req.session.firmUser.branchId } })
        if (branch)
            stopId = branch.stopId
    }

    const trip = await req.models.Trip.findOne({ where: { date: tripDate, time: tripTime, id: tripId }, include: [{ model: req.models.Route, as: "route", include: [{ model: req.models.Stop, as: "fromStop", attributes: ["id", "title"] }, { model: req.models.Stop, as: "toStop", attributes: ["id", "title"] }] }, { model: req.models.BusModel, as: "busModel", attributes: ["id", "title", "planBinary", "maxPassenger"] }, { model: req.models.Bus, as: "bus", attributes: ["id", "licensePlate"] }, { model: req.models.Staff, as: "captain", attributes: ["id", "name", "surname", "duty"] }] })

    if (trip) {
        const captain = await req.models.Staff.findOne({ where: { id: trip.captainId, duty: "driver" } })
        const route = await req.models.Route.findOne({ where: { id: trip.routeId } })
        const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })
        const busModel = await req.models.BusModel.findOne({ where: { id: trip.busModelId } })
        const seatTypes = getSeatTypes(trip?.busModel?.planBinary || [])
        const accountCut = await req.models.BusAccountCut.findOne({ where: { tripId: trip.id, stopId: stopId } })

        const currentRouteStop = routeStops.find(rs => rs.stopId == stopId)
        const currentStopOrder = currentRouteStop ? currentRouteStop.order : null

        trip.modifiedTime = trip.time
        trip.isExpired = new Date(`${trip.date} ${trip.time}`) < new Date()
        trip.isAccountCut = accountCut ? true : false

        if (currentRouteStop) {
            const offsets = await req.models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true })
            const offsetMap = buildOffsetMap(offsets)
            const stopTimes = computeRouteStopTimes(trip, routeStops, offsetMap)
            const matchedStopTime = stopTimes.find(st => st.order === currentStopOrder)
            if (matchedStopTime) {
                trip.modifiedTime = matchedStopTime.time
            }
        }

        const tripDate = new Date(trip.date);
        const [hours, minutes] = trip.modifiedTime.split(":");
        const pad = (num) => String(num).padStart(2, "0");
        trip.dateString = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(tripDate);
        trip.timeString = `${hours}.${minutes}`

        const ticketRecords = await req.models.Ticket.findAll({ where: { tripId: trip.id, status: { [Op.notIn]: ['canceled', 'refund'] } } });
        const cargos = await req.models.Cargo.findAll({ where: { tripId: trip.id, fromStopId: stopId } });
        const tickets = ticketRecords.map(t => t.get({ plain: true }));
        const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [...new Set(tickets.map(t => t.userId))] } } })
        const branches = await req.models.Branch.findAll({ where: { id: { [Op.in]: [...new Set(users.map(u => u.branchId)), req.session.firmUser.branchId] } } })

        const routeStopOrderMap = routeStops.reduce((acc, rs) => {
            acc[rs.stopId] = rs.order;
            return acc;
        }, {});
        const stopsMap = stops.reduce((acc, s) => {
            acc[s.id] = s.title;
            return acc;
        }, {});
        const userMap = users.reduce((acc, u) => {
            acc[u.id] = u;
            return acc;
        }, {});
        const branchMap = branches.reduce((acc, b) => {
            acc[b.id] = b;
            return acc;
        }, {});

        trip.isOwnBranchStop = (stopId == branchMap[req.session.firmUser.branchId]?.stopId).toString()

        let newTicketArray = []
        const soldStatuses = ["completed", "web"]
        let currentSoldCount = 0
        let currentSoldAmount = 0
        let totalSoldCount = 0
        let totalSoldAmount = 0
        let currentReservedCount = 0
        let currentReservedAmount = 0
        let totalReservedCount = 0
        let totalReservedAmount = 0
        let cargoCount = 0
        let cargoAmount = 0
        const seatFutureStopInfo = {}
        if (currentStopOrder !== null && currentStopOrder !== undefined) {
            for (let i = 0; i < tickets.length; i++) {
                const ticket = tickets[i]
                const futureOrder = routeStopOrderMap[ticket.fromRouteStopId]
                if (typeof futureOrder !== "number" || futureOrder <= currentStopOrder) {
                    continue
                }

                const existing = seatFutureStopInfo[ticket.seatNo]
                if (!existing || futureOrder < existing.order) {
                    seatFutureStopInfo[ticket.seatNo] = {
                        order: futureOrder,
                        stopId: ticket.fromRouteStopId,
                    }
                }
            }
        }

        for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const ticketPlaceOrder = routeStopOrderMap[ticket.fromRouteStopId];

            if (ticketPlaceOrder == currentStopOrder) {
                ticket.stopOrder = "even"
            }
            else if (ticketPlaceOrder > currentStopOrder) {
                ticket.stopOrder = "ahead"
                ticket.createdAt = null
            }
            else if (ticketPlaceOrder < currentStopOrder) {
                ticket.stopOrder = "before"
                ticket.createdAt = null
            }

            const futureInfo = seatFutureStopInfo[ticket.seatNo]
            ticket.nextRouteStopOrder = futureInfo ? futureInfo.order : null
            ticket.nextRouteStopId = futureInfo ? futureInfo.stopId : null

            const user = userMap[ticket.userId];
            const branch = branchMap[user?.branchId];
            ticket.from = stopsMap[ticket.fromRouteStopId];
            ticket.to = stopsMap[ticket.toRouteStopId];
            ticket.user = user?.name;
            ticket.userBranch = branch?.title;
            ticket.isOwnBranchTicket = (user?.branchId == req.session.firmUser?.branchId).toString();
            ticket.isOwnBranchStop = (ticket.fromRouteStopId == branchMap[req.session.firmUser?.branchId]?.stopId).toString()
            ticket.tripRefundOptionDate = trip.refundOptionDate

            newTicketArray[ticket.seatNo] = ticket

            if (soldStatuses.includes(ticket.status)) {
                totalSoldCount++
                totalSoldAmount += ticket.price
                if (ticket.fromRouteStopId == stopId) {
                    currentSoldCount++
                    currentSoldAmount += ticket.price
                }
            } else if (ticket.status === "reservation") {
                totalReservedCount++
                totalReservedAmount += ticket.price
                if (ticket.fromRouteStopId == stopId) {
                    currentReservedCount++
                    currentReservedAmount += ticket.price
                }
            }
        }

        cargos.forEach(cargoInstance => {
            const cargo = cargoInstance.get({ plain: true });
            const amount = Number(cargo.price);
            cargoCount += 1
            if (!Number.isNaN(amount)) {
                cargoAmount += amount
            }
        })
        const fromStr = stops.find(s => s.id == stopId).title
        const toStr = stops.find(s => s.id == routeStops[routeStops.length - 1].stopId).title
        const incomes = {
            currentSoldCount,
            currentSoldAmount,
            totalSoldCount,
            totalSoldAmount,
            currentReservedCount,
            currentReservedAmount,
            totalReservedCount,
            totalReservedAmount,
            cargoCount,
            cargoAmount,
            grandCount: totalSoldCount + totalReservedCount + cargoCount,
            grandAmount: totalSoldAmount + totalReservedAmount + cargoAmount
        }

        res.render("mixins/busPlan", { trip, busModel, captain, route, tickets: newTicketArray, seatTypes, tripDate: tripDate, tripTime: tripTime, tripId: trip.id, fromId: stopId, toId: routeStops[routeStops.length - 1].stopId, fromStr, toStr, incomes })
    }
    else {
        res.status(404).json({ error: "Trip not found." })
    }

}

exports.getTripStops = async (req, res, next) => {
    try {
        const tripId = Number(req.query.tripId);
        if (!tripId) {
            return res.status(400).json({ message: "Trip information missing." });
        }

        const trip = await req.models.Trip.findOne({ where: { id: tripId } });
        if (!trip) {
            return res.status(404).json({ message: "Trip not found." });
        }

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: trip.routeId },
            order: [["order", "ASC"]]
        });

        const stopIds = [...new Set(routeStops.map(rs => rs.stopId))];
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } } });
        const stopMap = new Map(stops.map(stop => [stop.id, stop.title]));

        const result = routeStops.map(rs => ({
            id: rs.stopId,
            routeStopId: rs.id,
            order: rs.order,
            title: stopMap.get(rs.stopId) || ""
        }));

        res.json(result);
    } catch (err) {
        console.error("Trip stops error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getTripTable = async (req, res, next) => {
    const tripDate = req.query.date
    const tripTime = req.query.time
    const currentStopId = req.query.stopId

    const trip = await req.models.Trip.findOne({ where: { date: tripDate, time: tripTime } })
    const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
    const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })

    const tickets = await req.models.Ticket.findAll({ where: { tripId: trip.id, status: { [Op.notIn]: ["pending"] } }, order: [["seatNo", "ASC"]] })
    const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [...new Set(tickets.map(t => t.userId))] } } })
    const branches = await req.models.Branch.findAll({ where: { id: { [Op.in]: [...new Set(users.map(u => u.branchId)), req.session.firmUser.branchId] } } })

    const userMap = users.reduce((acc, u) => { acc[u.id] = u; return acc }, {})
    const branchMap = branches.reduce((acc, b) => { acc[b.id] = b; return acc }, {})

    const canceledStatuses = ["canceled", "refund"]
    const activeTickets = []
    const canceledTickets = []

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i].get({ plain: true })

        ticket.from = stops.find(s => s.id == ticket.fromRouteStopId)?.title || ""
        ticket.to = stops.find(s => s.id == ticket.toRouteStopId)?.title || ""
        ticket.gender = ticket.gender === "m" ? "MALE" : "FEMALE"
        ticket.isOtherStop = currentStopId && ticket.fromRouteStopId != currentStopId

        const user = userMap[ticket.userId]
        const branch = branchMap[user.branchId]
        ticket.isOwnBranchTicket = (user.branchId == req.session.firmUser.branchId).toString()
        ticket.isOwnBranchStop = (ticket.fromRouteStopId == branchMap[req.session.firmUser.branchId]?.stopId).toString()
        ticket.tripRefundOptionDate = trip.refundOptionDate

        if (canceledStatuses.includes(ticket.status)) {
            canceledTickets.push(ticket)
        } else {
            activeTickets.push(ticket)
        }
    }

    res.render("mixins/passengersTable", { activeTickets, canceledTickets })
}

exports.getTripNotes = async (req, res, next) => {
    const tripId = req.query.tripId

    const notes = await req.models.TripNote.findAll({ where: { tripId: tripId, isActive: true } })

    const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [...new Set(notes.map(n => n.userId))] } } })

    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];

        note.user = users.find(u => u.id == note.userId)?.name

        note.isOwn = note.userId == req.session.firmUser.id
    }

    res.render("mixins/tripNotes", { notes: notes })
}

exports.postTripNote = async (req, res, next) => {
    try {
        const tripDate = req.body.date;
        const tripTime = req.body.time;
        const tripId = req.body.tripId;
        const noteText = req.body.text;

        const trip = await req.models.Trip.findOne({
            where: { id: tripId, date: tripDate, time: tripTime }
        });

        if (!trip) {
            return res.status(404).json({ message: "Trip not found" });
        }

        await req.models.TripNote.create({
            tripId: tripId,
            noteText: noteText,
            userId: req.session.firmUser.id
        });

        return res.status(201).json({ message: "Note created successfully" });

    } catch (error) {
        console.error("postTripNotes error:", error);
        return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

exports.getBusAccountCutData = async (req, res, next) => {
    try {
        const BUS_COMISSION_PERCENT = 20;
        const { tripId, stopId } = req.query;
        const firmUser = req.session.firmUser;

        const data = await calculateBusAccountData(req.models, tripId, stopId, firmUser);

        const parseOptionalNumber = value => {
            if (value === null || value === undefined) return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        let comissionPercent = null;
        let defaultDeductions = null;
        let autoFilledFromBranchStop = false;

        const trip = await req.models.Trip.findByPk(tripId, { raw: true });
        if (trip?.busId) {
            const bus = await req.models.Bus.findByPk(trip.busId, { raw: true });
            const busCommission = parseOptionalNumber(bus?.customCommissionRate);
            if (busCommission !== null) comissionPercent = busCommission;
        }

        const sessionBranchId = firmUser?.branchId;
        if (sessionBranchId) {
            const branch = await req.models.Branch.findByPk(sessionBranchId, { raw: true });
            if (branch && Number(branch.stopId) === Number(stopId)) {
                autoFilledFromBranchStop = true;

                const branchPercent = parseOptionalNumber(branch.ownStopSalesCommission);
                if (branchPercent !== null && comissionPercent === null)
                    comissionPercent = branchPercent;

                const deductions = [
                    branch.defaultDeduction1,
                    branch.defaultDeduction2,
                    branch.defaultDeduction3,
                    branch.defaultDeduction4,
                    branch.defaultDeduction5
                ].map(parseOptionalNumber);

                defaultDeductions = deductions;
            }
        }

        if (comissionPercent === null) {
            const firmCommission = parseOptionalNumber(req.session?.firm?.comissionRate);
            if (firmCommission !== null) comissionPercent = firmCommission;
        }

        if (comissionPercent === null) comissionPercent = BUS_COMISSION_PERCENT;

        const comissionAmount = data.allTotal * comissionPercent / 100;
        const needToPay = data.allTotal - comissionAmount;
        const isPaysInternet = data.isPaysInternet

        res.json({
            ...data,
            comissionPercent,
            comissionAmount,
            needToPay,
            defaultDeductions,
            autoFilledFromBranchStop,
            isPaysInternet
        });
    } catch (err) {
        console.error("getBusAccountCutData error:", err);
        res.status(500).json({ message: "Could not retrieve account information." });
    }
};

exports.postBusAccountCut = async (req, res, next) => {
    try {
        const { tripId, stopId } = req.body;
        const parse = v => Number(v) || 0;
        const BUS_COMISSION_PERCENT = parse(req.body.comissionPercent);
        const d1 = parse(req.body.deduction1);
        const d2 = parse(req.body.deduction2);
        const d3 = parse(req.body.deduction3);
        const d4 = parse(req.body.deduction4);
        const d5 = parse(req.body.deduction5);
        const tip = parse(req.body.tip);
        const payedAmount = parse(req.body.payedAmount);
        const description = req.body.description || "";

        const trip = await req.models.Trip.findOne({ where: { id: tripId } })
        const bus = await req.models.Bus.findOne({ where: { id: trip.busId } })
        const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })

        const data = await calculateBusAccountData(req.models, tripId, stopId, req.session.firmUser);
        const comissionAmount = data.allTotal * BUS_COMISSION_PERCENT / 100;
        const needToPay = data.allTotal - comissionAmount - d1 - d2 - d3 - d4 - d5 - tip;

        await req.models.BusAccountCut.create({
            tripId,
            stopId,
            comissionPercent: BUS_COMISSION_PERCENT,
            comissionAmount,
            deduction1: d1,
            deduction2: d2,
            deduction3: d3,
            deduction4: d4,
            deduction5: d5,
            tip,
            description,
            needToPayAmount: needToPay,
            payedAmount
        });

        const baseDescription = await buildBusTransactionDescription(req.models, trip, stopId, bus, routeStops, stops);

        await req.models.Transaction.create({
            userId: req.session.firmUser.id,
            type: "expense",
            category: "payed_to_bus",
            amount: payedAmount,
            description: baseDescription
        });

        if (bus && payedAmount > 0) {
            await req.models.BusTransaction.create({
                busId: bus.id,
                userId: req.session.firmUser.id,
                type: "income",
                amount: payedAmount,
                description: baseDescription
            });
        }

        const register = await req.models.CashRegister.findOne({ where: { userId: req.session.firmUser.id } });
        if (register) {
            register.cash_balance = (register.cash_balance || 0) - (payedAmount || 0);
            await register.save();
        }

        res.json({ message: "OK" });
    } catch (err) {
        console.error("postBusAccountCut error:", err);
        res.status(500).json({ message: "Account cut failed." });
    }
};

exports.getBusAccountCutRecord = async (req, res, next) => {
    try {
        const { tripId, stopId } = req.query;
        const record = await req.models.BusAccountCut.findOne({ where: { tripId, stopId } });
        if (!record) return res.status(404).json({ message: "Account not found." });
        const data = await calculateBusAccountData(req.models, tripId, stopId, req.session.firmUser);
        res.json({
            id: record.id,
            myCash: data.myCash,
            myCard: data.myCard,
            otherBranches: data.otherBranches,
            allTotal: data.allTotal,
            cargoCount: data.cargoCount,
            cargoAmount: data.cargoAmount,
            comissionPercent: record.comissionPercent,
            comissionAmount: record.comissionAmount,
            deduction1: record.deduction1,
            deduction2: record.deduction2,
            deduction3: record.deduction3,
            deduction4: record.deduction4,
            deduction5: record.deduction5,
            tip: record.tip,
            description: record.description,
            needToPay: record.needToPayAmount,
            payedAmount: record.payedAmount
        });
    } catch (err) {
        console.error("getBusAccountCutRecord error:", err);
        res.status(500).json({ message: "Account information could not be retrieved." });
    }
};

exports.postDeleteBusAccountCut = async (req, res, next) => {
    try {
        const { id } = req.body;
        const accountCut = await req.models.BusAccountCut.findOne({ where: { id } });
        if (!accountCut) {
            return res.status(404).json({ message: "Account not found." });
        }

        const payedAmount = Number(accountCut.payedAmount) || 0;
        const trip = await req.models.Trip.findOne({ where: { id: accountCut.tripId } })
        if (!trip) {
            await accountCut.destroy();
            return res.json({ message: "OK" });
        }
        const bus = await req.models.Bus.findOne({ where: { id: trip.busId } })
        const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })

        const baseDescription = await buildBusTransactionDescription(req.models, trip, accountCut.stopId, bus, routeStops, stops);
        const fullDescription = baseDescription ? `Account cut reverted | ${baseDescription}` : "Account cut reverted";

        await req.models.Transaction.create({
            userId: req.session.firmUser.id,
            type: "income",
            category: "payed_to_bus",
            amount: payedAmount,
            description: fullDescription
        });

        if (bus && payedAmount > 0) {
            await req.models.BusTransaction.create({
                busId: bus.id,
                userId: req.session.firmUser.id,
                type: "expense",
                amount: payedAmount,
                description: fullDescription
            });
        }

        const register = await req.models.CashRegister.findOne({ where: { userId: req.session.firmUser.id } });
        if (register) {
            register.cash_balance = (register.cash_balance || 0) + payedAmount;
            await register.save();
        }

        await accountCut.destroy();

        res.json({ message: "OK" });
    } catch (err) {
        console.error("postDeleteBusAccountCut error:", err);
        res.status(500).json({ message: "Account revert failed." });
    }
};

exports.getBusAccountCutReceipt = async (req, res, next) => {
    try {
        const { tripId, stopId } = req.query;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="account_receipt.pdf"');
        await generateAccountReceiptFromDb(tripId, stopId, res, req.models);
    } catch (err) {
        console.error("getBusAccountCutReceipt error:", err);
        res.status(500).json({ message: "Account receipt could not be generated." });
    }
};

exports.getSeferDetayCiktisi = async (req, res, next) => {
    try {
        const { tripId } = req.params;
        if (!tripId) return res.status(400).json({ message: "tripId is required." });

        const result = await seferDetayCiktisiAl(req, tripId);
        res.json(result);
    } catch (err) {
        console.error("❌ seferDetayCiktisiAl error:", err);
        res.status(500).json({ message: err.message });
    }
};


exports.getTripSeatPlanReport = async (req, res, next) => {
    try {
        const tripId = Number(req.query.tripId);
        const rawStopId = req.query.stopId;
        const stopId = rawStopId !== undefined ? Number(rawStopId) : null;
        const isStopIdValid = Number.isFinite(stopId);

        if (!Number.isFinite(tripId) || tripId <= 0) {
            return res.status(400).json({ message: 'Trip information missing.' });
        }

        const trip = await req.models.Trip.findOne({ where: { id: tripId }, raw: true });
        if (!trip) {
            return res.status(404).json({ message: 'Trip not found.' });
        }

        const [route, busModel, bus, captain] = await Promise.all([
            req.models.Route.findOne({ where: { id: trip.routeId }, raw: true }),
            trip.busModelId ? req.models.BusModel.findOne({ where: { id: trip.busModelId }, raw: true }) : null,
            trip.busId ? req.models.Bus.findOne({ where: { id: trip.busId }, raw: true }) : null,
            trip.captainId ? req.models.Staff.findOne({ where: { id: trip.captainId }, raw: true }) : null,
        ]);

        const planArray = normalizePlanBinary(trip.busPlanString ?? busModel?.planBinary);
        if (!planArray.length) {
            return res.status(400).json({ message: 'Seat plan not found for this trip.' });
        }

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: trip.routeId },
            order: [["order", "ASC"]],
            raw: true,
        });

        const stopIds = [...new Set(routeStops.map(rs => rs.stopId))];
        const stops = stopIds.length
            ? await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } }, raw: true })
            : [];

        const toKey = value => (value === null || value === undefined ? null : String(value));
        const stopTitleMap = new Map(stops.map(stop => [toKey(stop.id), stop.title]));
        const stopKey = isStopIdValid ? String(stopId) : null;

        const includedStatuses = ['completed', 'web', 'gotur', 'reservation', 'open'];
        const tickets = await req.models.Ticket.findAll({
            where: {
                tripId,
                status: { [Op.in]: includedStatuses },
            },
            order: [["seatNo", "ASC"]],
            raw: true,
        });

        const seatMap = {};
        let totalAmount = 0;
        let totalCount = 0;
        let filteredAmount = 0;
        let filteredCount = 0;

        tickets.forEach(ticket => {
            const seatNo = Number(ticket.seatNo);
            if (!Number.isFinite(seatNo) || seatNo <= 0) {
                return;
            }

            const price = Number(ticket.price) || 0;
            totalAmount += price;
            totalCount += 1;

            const matchesStop = stopKey ? toKey(ticket.fromRouteStopId) === stopKey : true;
            if (matchesStop) {
                filteredAmount += price;
                filteredCount += 1;
            }

            seatMap[seatNo] = {
                name: [ticket.name, ticket.surname].filter(Boolean).join(' ').trim(),
                gender: ticket.gender,
                price,
                from: stopTitleMap.get(toKey(ticket.fromRouteStopId)) || '',
                to: stopTitleMap.get(toKey(ticket.toRouteStopId)) || '',
                status: ticket.status,
                payment: ticket.payment,
                pnr: ticket.pnr,
                isCurrentStop: matchesStop,
            };
        });

        const fromTitle = route?.fromStopId !== undefined ? stopTitleMap.get(toKey(route.fromStopId)) || '' : '';
        const toTitle = route?.toStopId !== undefined ? stopTitleMap.get(toKey(route.toStopId)) || '' : '';
        const currentStopTitle = stopKey ? (stopTitleMap.get(stopKey) || '') : fromTitle;

        const headerData = {
            departure: formatTripDateTime(trip.date, trip.time),
            plate: bus?.licensePlate || '',
            arrival: toTitle || '',
            owner: bus?.owner || '',
            taxOffice: bus?.taxOffice || '',
            taxNumber: bus?.taxNumber || '',
            route: [fromTitle, toTitle].filter(Boolean).join(' - '),
            routeCode: route?.routeCode || '',
            busModel: busModel?.title || '',
            driver: captain ? [captain.name, captain.surname].filter(Boolean).join(' ').trim() : '',
        };

        const footerData = {
            label: currentStopTitle || fromTitle || '',
            count: stopKey ? filteredCount : totalCount,
            amount: stopKey ? filteredAmount : totalAmount,
        };

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="trip_seat_plan.pdf"');

        await generateTripSeatPlanReport({
            header: headerData,
            layout: {
                plan: planArray,
                columns: 5,
                seats: seatMap,
                highlightByStop: Boolean(stopKey),
            },
            footer: footerData,
        }, res);
    } catch (err) {
        console.error('getTripSeatPlanReport error:', err);
        res.status(500).json({ message: 'Seat plan report could not be generated.' });
    }
};

exports.postEditTripNote = async (req, res, next) => {
    try {
        const noteId = req.body.id;
        const noteText = req.body.text;

        const note = await req.models.TripNote.findOne({ where: { id: noteId } });

        if (!note) {
            return res.status(404).json({ message: "Note not found" });
        }

        await note.update({
            noteText: noteText,
            userId: req.session.firmUser.id
        });

        return res.status(200).json({ message: "Note updated successfully" });

    } catch (error) {
        console.error("postEditTripNote error:", error);
        return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

exports.postDeleteTripNote = async (req, res, next) => {
    try {
        const noteId = req.body.id;

        const note = await req.models.TripNote.findOne({ where: { id: noteId } });

        if (!note) {
            return res.status(404).json({ message: "Note not found" });
        }

        await note.update({
            isActive: false
        });

        return res.status(200).json({ message: "Note deleted successfully" });

    } catch (error) {
        console.error("postDeleteTripNote error:", error);
        return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

exports.getRouteStopsTimeList = async (req, res, next) => {
    const date = req.query.date
    const time = req.query.time
    const tripId = req.query.tripId

    const trip = await req.models.Trip.findOne({ where: { id: tripId, date: date, time: time } })
    const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]], include: [{ model: req.models.Stop, as: "stop", attributes: ["id", "title"] }] });

    const offsets = await req.models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true })
    const offsetMap = buildOffsetMap(offsets)
    const stopTimes = computeRouteStopTimes(trip, routeStops, offsetMap)
    const timeMap = new Map(stopTimes.map(st => [st.routeStopId, st.time]))

    for (let i = 0; i < routeStops.length; i++) {
        const rs = routeStops[i];
        const timeStr = timeMap.get(rs.id) || trip.time
        rs.timeStamp = formatTimeWithoutSeconds(timeStr)
        rs.stopStr = rs.stop?.title || ""
    }

    res.render('mixins/routeStopsTimeList', { routeStops });
}

exports.getTripStopRestriction = async (req, res, next) => {
    try {
        const tripId = req.query.tripId;
        if (!tripId) {
            return res.status(400).json({ error: "Trip ID required" });
        }

        const trip = await req.models.Trip.findByPk(tripId);
        if (!trip) {
            return res.status(404).send("Trip not found");
        }

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: trip.routeId },
            order: [["order", "ASC"]]
        });
        const stopIds = routeStops.map(rs => rs.stopId);
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } } });
        const stopMap = new Map(stops.map(s => [s.id, s.title]));

        const rsData = routeStops.map(rs => ({
            id: rs.id,
            order: rs.order,
            title: stopMap.get(rs.stopId) || ""
        }));

        const restrictions = await req.models.RouteStopRestriction.findAll({ where: { tripId } });
        res.render("mixins/tripStopRestriction", { routeStops: rsData, restrictions });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
};

const moment = require("moment");
const { seferGuncelle } = require("../utilities/uetdsService");

const parseAllowedValue = value => value === true || value === "true" || value === 1 || value === "1";
const isRestrictionDisabled = value => value === false || value === "false" || value === 0 || value === "0";

async function applyTripStopRestrictionChange(req, tripId, fromRouteStopId, toRouteStopId, isAllowedInput) {
    const normalizedTripId = Number(tripId);
    const normalizedFromId = Number(fromRouteStopId);
    const normalizedToId = Number(toRouteStopId);

    if (!normalizedTripId || !normalizedFromId || !normalizedToId) {
        throw new Error("Invalid trip or stop information.");
    }

    const allowed = parseAllowedValue(isAllowedInput);

    const restriction = await req.models.RouteStopRestriction.findOne({
        where: {
            tripId: normalizedTripId,
            fromRouteStopId: normalizedFromId,
            toRouteStopId: normalizedToId,
        },
    });

    if (restriction) {
        await restriction.update({ isAllowed: allowed });
    } else {
        await req.models.RouteStopRestriction.create({
            tripId: normalizedTripId,
            fromRouteStopId: normalizedFromId,
            toRouteStopId: normalizedToId,
            isAllowed: allowed,
        });
    }

    const trip = await req.models.Trip.findOne({
        where: { id: normalizedTripId },
        include: [
            {
                model: req.models.Route,
                as: "route",
                include: [
                    { model: req.models.Stop, as: "fromStop", attributes: ["id", "title"] },
                    { model: req.models.Stop, as: "toStop", attributes: ["id", "title"] },
                ],
            },
            { model: req.models.Bus, as: "bus", attributes: ["licensePlate", "phoneNumber"] },
        ],
    });

    if (!trip) {
        throw new Error("Trip not found.");
    }

    const routeStopsRaw = await req.models.RouteStop.findAll({
        where: { routeId: trip.routeId },
        order: [["order", "ASC"]],
        raw: true,
    });

    if (!routeStopsRaw.length) {
        throw new Error("Route stops not found.");
    }

    const stopIds = routeStopsRaw.map(rs => rs.stopId);
    const stops = await req.models.Stop.findAll({
        where: { id: { [Op.in]: stopIds } },
        raw: true,
    });
    const stopTitleMap = new Map(stops.map(stop => [Number(stop.id), stop.title || ""]));

    const routeStops = routeStopsRaw.map(rs => ({
        ...rs,
        title: stopTitleMap.get(Number(rs.stopId)) || "",
    }));

    const firstStop = routeStops[0];
    const lastStop = routeStops[routeStops.length - 1];
    let newFirstStop = firstStop;
    let newLastStop = lastStop;

    const restrictions = await req.models.RouteStopRestriction.findAll({
        where: { tripId: normalizedTripId },
        raw: true,
    });

    const isStopRestricted = (routeStopId, field = "fromRouteStopId") =>
        restrictions.some(
            r => Number(r[field]) === Number(routeStopId) && isRestrictionDisabled(r.isAllowed)
        );

    if (isStopRestricted(firstStop.id, "fromRouteStopId")) {
        for (let i = 1; i < routeStops.length; i += 1) {
            if (!isStopRestricted(routeStops[i].id, "fromRouteStopId")) {
                newFirstStop = routeStops[i];
                break;
            }
        }
    } else {
        newFirstStop = firstStop;
    }

    if (isStopRestricted(lastStop.id, "toRouteStopId")) {
        for (let i = routeStops.length - 2; i >= 0; i -= 1) {
            if (!isStopRestricted(routeStops[i].id, "toRouteStopId")) {
                newLastStop = routeStops[i];
                break;
            }
        }
    } else {
        newLastStop = lastStop;
    }

    const changed = newFirstStop.id !== firstStop.id || newLastStop.id !== lastStop.id;
    let uetdsResult = null;

    if (changed) {
        const startIndex = routeStops.findIndex(r => Number(r.id) === Number(newFirstStop.id));
        const endIndex = routeStops.findIndex(r => Number(r.id) === Number(newLastStop.id));
        const sliceStart = Math.min(startIndex, endIndex);
        const sliceEnd = Math.max(startIndex, endIndex) + 1;
        const subRoute = routeStops.slice(sliceStart, sliceEnd);

        const totalSeconds = subRoute.reduce((acc, stop) => {
            if (!stop.duration) return acc;
            const [h = 0, m = 0, s = 0] = String(stop.duration)
                .split(":")
                .map(n => parseInt(n || 0, 10));
            return acc + h * 3600 + m * 60 + s;
        }, 0);

        const hareketTarihi = moment(trip.date).format("YYYY-MM-DD");
        const hareketSaati = moment(trip.time, ["HH:mm", "HH:mm:ss"]).format("HH:mm");
        const startDateTime = moment(`${hareketTarihi} ${hareketSaati}`, "YYYY-MM-DD HH:mm");
        const endDateTime = startDateTime.clone().add(totalSeconds, "seconds");

        const seferBitisTarihi = endDateTime.format("YYYY-MM-DD");
        const seferBitisSaati = endDateTime.format("HH:mm");

        uetdsResult = await seferGuncelle(req, trip.id, {
            referansNo: trip.uetdsRefNo,
            seferAciklama: `${newFirstStop.title} - ${newLastStop.title}`.trim(),
            hareketTarihi,
            hareketSaati,
            seferBitisTarihi,
            seferBitisSaati,
        });
    }

    return {
        message: changed ? "Restriction changed, UETDS updated." : "Restriction saved, route did not change.",
        updated: changed,
        uetds: uetdsResult,
    };
}

exports.postTripStopRestriction = async (req, res, next) => {
    try {
        const { tripId, fromId, toId, isAllowed } = req.body;

        if (!tripId || !fromId || !toId) {
            return res.status(400).json({ message: "Invalid restriction information." });
        }

        const result = await applyTripStopRestrictionChange(req, tripId, fromId, toId, isAllowed);
        res.json(result);
    } catch (err) {
        console.error("❌ Restriction operation error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.postTripStopRestrictionAll = async (req, res, next) => {
    try {
        const { tripId, changes } = req.body;

        const normalizedTripId = Number(tripId);
        if (!normalizedTripId) {
            return res.status(400).json({ message: "Invalid trip information." });
        }

        let parsedChanges = changes;
        if (typeof parsedChanges === "string") {
            try {
                parsedChanges = JSON.parse(parsedChanges);
            } catch (error) {
                return res.status(400).json({ message: "Invalid restriction data." });
            }
        }

        if (!Array.isArray(parsedChanges)) {
            parsedChanges = [];
        }

        const normalizedChanges = parsedChanges
            .map(change => ({
                fromId: change?.fromId ?? change?.fromRouteStopId,
                toId: change?.toId ?? change?.toRouteStopId,
                isAllowed: change?.isAllowed,
            }))
            .filter(change => Number(change.fromId) && Number(change.toId));

        if (!normalizedChanges.length) {
            return res.status(400).json({ message: "No restriction changes found." });
        }

        const baseTrip = await req.models.Trip.findByPk(normalizedTripId);
        if (!baseTrip) {
            return res.status(404).json({ message: "Trip not found." });
        }

        const now = moment();
        const today = now.format("YYYY-MM-DD");

        const candidateTrips = await req.models.Trip.findAll({
            where: {
                routeId: baseTrip.routeId,
                date: { [Op.gte]: today },
            },
        });

        const targetTrips = candidateTrips
            .filter(trip => {
                const tripMoment = moment(`${trip.date} ${trip.time}`, [
                    "YYYY-MM-DD HH:mm:ss",
                    "YYYY-MM-DD HH:mm",
                ]);
                return tripMoment.isSameOrAfter(now);
            })
            .sort((a, b) => {
                const aMoment = moment(`${a.date} ${a.time}`, ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"]);
                const bMoment = moment(`${b.date} ${b.time}`, ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"]);
                if (aMoment.isBefore(bMoment)) return -1;
                if (aMoment.isAfter(bMoment)) return 1;
                return a.id - b.id;
            });

        if (!targetTrips.length) {
            return res.json({
                success: true,
                message: "No active trip found to apply.",
                appliedTripIds: [],
            });
        }

        const results = [];

        for (const trip of targetTrips) {
            for (const change of normalizedChanges) {
                const result = await applyTripStopRestrictionChange(
                    req,
                    trip.id,
                    change.fromId,
                    change.toId,
                    change.isAllowed
                );
                results.push({
                    tripId: trip.id,
                    fromId: Number(change.fromId),
                    toId: Number(change.toId),
                    updated: result.updated,
                });
            }
        }

        res.json({
            success: true,
            message: "Restriction changes applied to relevant trips.",
            appliedTripIds: targetTrips.map(t => t.id),
            results,
        });
    } catch (err) {
        console.error("postTripStopRestrictionAll error:", err);
        res.status(500).json({ message: err.message || "Internal Server Error" });
    }
};

exports.postTripTimeAdjustment = async (req, res, next) => {
    try {
        const { tripId, routeStopId, direction, amount } = req.body;

        const numericTripId = Number(tripId);
        const numericRouteStopId = Number(routeStopId);

        if (!numericTripId || !numericRouteStopId)
            return res.status(400).json({ message: "Invalid trip or stop information." });

        const normalizedDirection =
            direction === "backward" ? "backward" : direction === "forward" ? "forward" : null;
        if (!normalizedDirection)
            return res.status(400).json({ message: "Please select a valid direction." });

        const minutes = parseTimeInputToMinutes(amount);
        if (minutes === null) return res.status(400).json({ message: "Please enter a valid duration." });
        if (minutes === 0) return res.status(400).json({ message: "Duration cannot be 0." });

        const hasPermission =
            (req.session.permissions || []).includes("TRIP_TIME_ADJUST") ||
            (req.session.permissions || []).includes("TRIP_STOP_RESTRICT");

        if (!hasPermission)
            return res.status(403).json({ message: "You are not authorized for this operation." });

        const trip = await req.models.Trip.findByPk(numericTripId);
        if (!trip) return res.status(404).json({ message: "Trip not found." });

        const routeStop = await req.models.RouteStop.findOne({
            where: { id: numericRouteStopId, routeId: trip.routeId },
        });
        if (!routeStop) return res.status(404).json({ message: "Trip stop not found." });

        const delta = minutes * (normalizedDirection === "backward" ? -1 : 1);

        const [record, created] = await req.models.TripStopTime.findOrCreate({
            where: { tripId: numericTripId, routeStopId: numericRouteStopId },
            defaults: { offsetMinutes: delta },
        });

        if (!created) {
            const current = Number(record.offsetMinutes) || 0;
            const updated = current + delta;
            if (updated === 0) await record.destroy();
            else {
                record.offsetMinutes = updated;
                await record.save();
            }
        }

        const offsets = await req.models.TripStopTime.findAll({
            where: { tripId: numericTripId },
            raw: true,
        });

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: trip.routeId },
            order: [["order", "ASC"]],
            raw: true,
        });

        if (!routeStops.length)
            return res.status(400).json({ message: "Route stops not found." });

        const firstStop = routeStops[0];
        const firstOffsetRec = offsets.find(o => o.routeStopId === firstStop.id);
        const firstOffsetMinutes = firstOffsetRec ? Number(firstOffsetRec.offsetMinutes) || 0 : 0;

        const totalDurationSeconds = routeStops.reduce((acc, stop) => {
            if (!stop.duration) return acc;
            const [h, m, s] = stop.duration.split(":").map(n => parseInt(n || 0, 10));
            return acc + h * 3600 + m * 60 + (s || 0);
        }, 0);

        const totalOffsetSeconds = offsets.reduce(
            (acc, o) => acc + ((Number(o.offsetMinutes) || 0) * 60),
            0
        );

        const hareketTarihi = moment(trip.date).format("YYYY-MM-DD");
        const baseStart = moment(trip.time, ["HH:mm", "HH:mm:ss"]);
        const hareketSaati = baseStart.clone().add(firstOffsetMinutes, "minutes").format("HH:mm");
        const startDateTime = moment(`${hareketTarihi} ${hareketSaati}`, "YYYY-MM-DD HH:mm");

        const totalSecondsForEnd = totalDurationSeconds + (totalOffsetSeconds - (firstOffsetMinutes * 60));
        const endDateTime = startDateTime.clone().add(totalSecondsForEnd, "seconds");

        const seferBitisTarihi = endDateTime.format("YYYY-MM-DD");
        const seferBitisSaati = endDateTime.format("HH:mm");

        console.log(`🕓 New times → Departure: ${hareketSaati} | Arrival: ${seferBitisSaati}`);

        if (trip.uetdsRefNo) {
            const result = await seferGuncelle(req, trip.id, {
                referansNo: trip.uetdsRefNo,
                hareketTarihi,
                hareketSaati,
                seferBitisTarihi,
                seferBitisSaati,
            });
            console.log("📡 [UETDS] Trip update result:", result);
        } else {
            console.log("⚠️ Trip has no UETDS ref number, skipping update.");
        }

        res.json({
            success: true,
            message: "Time adjusted and UETDS updated.",
            newTimes: {
                hareketTarihi,
                hareketSaati,
                seferBitisTarihi,
                seferBitisSaati,
            },
        });
    } catch (err) {
        console.error("postTripTimeAdjustment error:", err);
        res.status(500).json({ message: err.message || "Trip time could not be updated." });
    }
};

exports.getTripRevenues = async (req, res, next) => {
    try {
        const { tripId, stopId } = req.query;

        const tickets = await req.models.Ticket.findAll({
            where: {
                tripId,
                status: { [Op.in]: ["completed", "reservation", "web"] }
            },
            raw: true
        });

        const userIds = [...new Set(tickets.map(t => t.userId).filter(id => id))];
        const users = await req.models.FirmUser.findAll({ where: { id: userIds }, raw: true });
        const branchIds = [...new Set(users.map(u => u.branchId).filter(id => id))];
        const branches = await req.models.Branch.findAll({ where: { id: { [Op.in]: branchIds } }, raw: true });

        const userBranch = {};
        users.forEach(u => userBranch[u.id] = u.branchId);

        const branchTitles = {};
        branches.forEach(b => branchTitles[b.id] = b.title);

        const branchData = {};
        tickets.forEach(ticket => {
            const branchId = userBranch[ticket.userId];
            if (!branchId) return;

            if (!branchData[branchId]) {
                branchData[branchId] = {
                    title: branchTitles[branchId] || "",
                    currentAmount: 0,
                    currentCount: 0,
                    totalAmount: 0,
                    totalCount: 0
                };
            }

            const amount = Number(ticket.price);
            branchData[branchId].totalAmount += amount;
            branchData[branchId].totalCount += 1;

            if (ticket.fromRouteStopId == stopId) {
                branchData[branchId].currentAmount += amount;
                branchData[branchId].currentCount += 1;
            }
        });

        const branchesArr = Object.values(branchData);
        const totals = branchesArr.reduce((acc, b) => {
            acc.currentAmount += b.currentAmount;
            acc.currentCount += b.currentCount;
            acc.totalAmount += b.totalAmount;
            acc.totalCount += b.totalCount;
            return acc;
        }, { currentAmount: 0, currentCount: 0, totalAmount: 0, totalCount: 0 });

        res.json({ branches: branchesArr, totals });
    } catch (err) {
        console.error("getTripRevenues error:", err);
        res.status(500).json({ message: "Revenue information could not be retrieved." });
    }
};

exports.postAddCargo = async (req, res, next) => {
    try {
        const tripId = Number(req.body.tripId);
        const fromStopId = Number(req.body.fromStopId);
        const toStopId = Number(req.body.toStopId);
        const senderName = (req.body.senderName || "").trim();
        const senderPhone = (req.body.senderPhone || "").trim();
        const senderIdentity = (req.body.senderIdentity || "").trim();
        const description = (req.body.description || "").trim();
        const payment = req.body.payment;
        const price = Number(req.body.price);

        if (!tripId) {
            return res.status(400).json({ message: "Trip information missing." });
        }
        if (!fromStopId || !toStopId) {
            return res.status(400).json({ message: "Stop information missing." });
        }
        if (!senderName) {
            return res.status(400).json({ message: "Sender name is required." });
        }
        if (!senderPhone) {
            return res.status(400).json({ message: "Sender phone information is required." });
        }
        if (!senderIdentity) {
            return res.status(400).json({ message: "Sender ID info is required." });
        }
        if (!payment || !["cash", "card"].includes(payment)) {
            return res.status(400).json({ message: "Invalid payment type." });
        }
        if (!price || Number.isNaN(price) || price <= 0) {
            return res.status(400).json({ message: "Please enter a valid price." });
        }

        const trip = await req.models.Trip.findOne({ where: { id: tripId } });
        if (!trip) {
            return res.status(404).json({ message: "Trip not found." });
        }

        const cargo = await req.models.Cargo.create({
            userId: req.session.firmUser.id,
            tripId,
            fromStopId,
            toStopId,
            senderName,
            senderPhone,
            senderIdentity,
            description,
            payment,
            price
        });

        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [fromStopId, toStopId] } } });
        const fromStop = stops.find(s => s.id == fromStopId);
        const toStop = stops.find(s => s.id == toStopId);

        await req.models.Transaction.create({
            userId: req.session.firmUser.id,
            type: "income",
            category: payment === "cash" ? "cash_sale" : "card_sale",
            amount: price,
            description: `Cargo | ${trip.date} ${trip.time} | ${(fromStop ? fromStop.title : "")} - ${(toStop ? toStop.title : "")}`
        });

        const register = await req.models.CashRegister.findOne({ where: { userId: req.session.firmUser.id } });
        if (register) {
            if (payment === "cash") {
                register.cash_balance = Number(register.cash_balance) + price;
            } else {
                register.card_balance = Number(register.card_balance) + price;
            }
            await register.save();
        }

        res.json({ success: true, cargoId: cargo.id });
    } catch (err) {
        console.error("Cargo add error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.postRefundCargo = async (req, res, next) => {
    try {
        const cargoId = Number(req.body.cargoId);

        if (!cargoId) {
            return res.status(400).json({ message: "Invalid cargo information." });
        }

        if (!req.session.firmUser || !req.session.firmUser.id) {
            return res.status(401).json({ message: "Session information not found." });
        }

        const cargo = await req.models.Cargo.findOne({ where: { id: cargoId } });
        if (!cargo) {
            return res.status(404).json({ message: "Cargo record not found." });
        }

        const amountNum = Number.parseFloat(cargo.price);
        const amount = Number.isNaN(amountNum) ? 0 : amountNum;

        let tripInfo = "";
        let routeInfo = "";

        if (cargo.tripId) {
            const trip = await req.models.Trip.findOne({ where: { id: cargo.tripId }, raw: true });
            if (trip) {
                const tripParts = [trip.date || "", trip.time || ""].map(part => (part || "").toString().trim()).filter(Boolean);
                if (tripParts.length) {
                    tripInfo = tripParts.join(" ");
                }
            }
        }

        const stopIds = [cargo.fromStopId, cargo.toStopId]
            .map(id => (id === undefined || id === null) ? null : Number(id))
            .filter(id => id !== null && !Number.isNaN(id));

        const uniqueStopIds = [...new Set(stopIds)];

        if (uniqueStopIds.length) {
            const stops = await req.models.Stop.findAll({
                where: { id: { [Op.in]: uniqueStopIds } },
                raw: true
            });

            const fromTitle = stops.find(s => Number(s.id) === Number(cargo.fromStopId))?.title || "";
            const toTitle = stops.find(s => Number(s.id) === Number(cargo.toStopId))?.title || "";
            const routeParts = [fromTitle, toTitle].map(part => (part || "").toString().trim()).filter(Boolean);
            if (routeParts.length) {
                routeInfo = routeParts.join(" - ");
            }
        }

        const descriptionParts = ["Cargo refunded"];
        if (tripInfo) descriptionParts.push(tripInfo);
        if (routeInfo) descriptionParts.push(routeInfo);
        const description = descriptionParts.join(" | ");

        await req.models.Transaction.create({
            userId: req.session.firmUser.id,
            type: "expense",
            category: cargo.payment === "card" ? "card_refund" : "cash_refund",
            amount: amount,
            description
        });

        const register = await req.models.CashRegister.findOne({ where: { userId: req.session.firmUser.id } });
        if (register && amount > 0) {
            if (cargo.payment === "cash") {
                register.cash_balance = Number(register.cash_balance) - amount;
            } else if (cargo.payment === "card") {
                register.card_balance = Number(register.card_balance) - amount;
            }
            await register.save();
        }

        await cargo.destroy();

        res.json({ success: true });
    } catch (err) {
        console.error("Cargo refund error:", err);
        res.status(500).json({ success: false, message: "An error occurred during cargo refund." });
    }
};

exports.getTripCargoList = async (req, res, next) => {
    try {
        const tripId = Number(req.query.tripId);

        if (!tripId) {
            return res.status(400).json({ message: "Trip information is missing." });
        }

        const cargos = await req.models.Cargo.findAll({ where: { tripId }, order: [["createdAt", "DESC"]], include: [{ model: req.models.Stop, as: "fromStop", attributes: ["id", "title"] }, { model: req.models.Stop, as: "toStop", attributes: ["id", "title"] }, { model: req.models.FirmUser, as: "firmUser", attributes: ["id", "username", "branchId"] }] });

        if (!cargos.length) {
            return res.render("mixins/tripCargoList", { cargos: [] });
        }

        const stopIdSet = new Set();
        cargos.forEach(cargo => {
            const fromId = Number(cargo.fromStopId);
            if (!Number.isNaN(fromId)) {
                stopIdSet.add(fromId);
            }
            const toId = Number(cargo.toStopId);
            if (!Number.isNaN(toId)) {
                stopIdSet.add(toId);
            }
        });

        const stopMap = {};
        const stopIds = Array.from(stopIdSet);
        if (stopIds.length) {
            const stops = await req.models.Stop.findAll({
                where: { id: { [Op.in]: stopIds } },
                raw: true
            });

            stops.forEach(stop => {
                stopMap[String(stop.id)] = stop.title;
            });
        }

        const formatAmount = amount => {
            const num = Number(amount);
            if (Number.isNaN(num)) {
                return amount ? String(amount) : "";
            }
            return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        const formatted = cargos.map(cargo => {
            const priceNum = Number(cargo.price);
            const priceValue = Number.isNaN(priceNum) ? cargo.price : priceNum;

            const fromKey = cargo.fromStopId !== undefined && cargo.fromStopId !== null
                ? String(cargo.fromStopId)
                : "";
            const toKey = cargo.toStopId !== undefined && cargo.toStopId !== null
                ? String(cargo.toStopId)
                : "";

            return {
                ...cargo,
                description: cargo.description || "",
                senderName: cargo.senderName || "",
                senderPhone: cargo.senderPhone || "",
                fromTitle: cargo.fromStop?.title || "",
                toTitle: cargo.toStop?.title || "",
                price: priceValue,
                priceFormatted: formatAmount(cargo.price),
                paymentLabel: cargo.payment === "card" ? "Card" : "Cash"
            };
        });

        res.render("mixins/tripCargoList", { cargos: formatted });
    } catch (err) {
        console.error("getTripCargoList error:", err);
        res.status(500).json({ message: "Could not retrieve cargo list." });
    }
};

exports.getTicketOpsPopUp = async (req, res, next) => {
    const tripDate = req.query.date
    const tripTime = req.query.time
    const tripId = req.query.tripId
    var stopId = req.query.stopId

    const trip = await req.models.Trip.findOne({ where: { date: tripDate, time: tripTime, id: tripId } })
    const branch = await req.models.Branch.findOne({ where: { id: req.session.firmUser.branchId } })

    if (!stopId) {
        stopId = branch.stopId
    }

    const isOwnBranchStop = (stopId == branch?.stopId).toString()

    const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
    const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })
    const currentRouteStop = routeStops.find(rs => rs.stopId == stopId)
    const placeOrder = currentRouteStop?.order

    if (placeOrder == undefined || placeOrder == null) {
        return;
    }

    const restrictions = await req.models.RouteStopRestriction.findAll({ where: { tripId, fromRouteStopId: currentRouteStop.id } })
    const restrictionMap = new Map(restrictions.map(r => [r.toRouteStopId, r.isAllowed]))
    let newRouteStopsArray = []
    if ((placeOrder !== undefined && placeOrder !== null)) {
        for (let i = 0; i < routeStops.length; i++) {
            const rs = routeStops[i];
            if (placeOrder < rs.order) {
                rs.title = stops.find(s => s.id == rs.stopId).title
                const allowed = restrictionMap.has(rs.id) ? restrictionMap.get(rs.id) : true
                rs.isRestricted = !allowed

                newRouteStopsArray[rs.order] = rs
            }
        }
    }

    res.render("mixins/ticketOpsPopUp", { routeStops: newRouteStopsArray, isOwnBranchStop, reservationOptionDate: trip.reservationOptionDate })
}

exports.getErp = async (req, res, next) => {
    let busModel = await req.models.BusModel.findAll()
    let staff = await req.models.Staff.findAll()
    let branches = await req.models.Branch.findAll()
    let user = await req.models.FirmUser.findOne({ where: { id: req.session.firmUser.id } })
    let places = await req.commonModels.Place.findAll()
    let stops = await req.models.Stop.findAll()

    const userPerms = await req.models.FirmUserPermission.findAll({
        where: { firmUserId: req.session.firmUser.id, allow: true },
        attributes: ["permissionId"],
    });

    const permissionIds = userPerms.map(p => p.permissionId);
    if (permissionIds.length) {
        const permissionRows = await req.models.Permission.findAll({
            where: { id: { [Op.in]: permissionIds } },
            attributes: ["code"],
        });
        req.session.permissions = permissionRows.map(p => p.code);
    } else {
        req.session.permissions = [];
    }

    await req.session.save()

    const branchStopId = stops.find(s => s.id == branches.find(b => b.id == req.session.firmUser.branchId)?.stopId)?.id

    const customerModel = req.models.Customer;
    const getEnumValues = attributeName => {
        if (!customerModel?.rawAttributes?.[attributeName]) {
            return [];
        }

        const values = customerModel.rawAttributes[attributeName].values;
        return Array.isArray(values) ? values : [];
    };

    const labelFromMap = (value, map) => (map && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value);

    const genderLabelMap = { m: "Male", f: "Female" };
    const typeLabelMap = {
        adult: "Adult",
        child: "Child",
        student: "Student",
        disabled: "Disabled",
        retired: "Retired",
    };
    const categoryLabelMap = { normal: "Normal", member: "Member", guest: "Guest" };
    const pointOrPercentLabelMap = { point: "Point", percent: "Discount" };

    const customerFieldOptions = {
        gender: getEnumValues("gender").map(value => ({ value, label: labelFromMap(value, genderLabelMap) })),
        customerType: getEnumValues("customerType").map(value => ({ value, label: labelFromMap(value, typeLabelMap) })),
        customerCategory: getEnumValues("customerCategory").map(value => ({ value, label: labelFromMap(value, categoryLabelMap) })),
        pointOrPercent: getEnumValues("pointOrPercent").map(value => ({ value, label: labelFromMap(value, pointOrPercentLabelMap) })),
    };

    const logo = await resolveFirmLoginLogo(req)

    res.render('erpscreen', {
        title: req.session?.firm?.displayName || "GötürYZHN",
        busModel,
        staff,
        tenantKey: req.tenantKey,
        user,
        places,
        stops,
        branches,
        branchStopId,
        customerFieldOptions,
        nationalityOptions: NATIONALITY_OPTIONS,
    });
}

exports.getErpLogin = async (req, res, next) => {
    const DEFAULT_TITLE = "GötürYZHN";
    let firmRecord = req.session?.firm || null;

    if (!firmRecord && req.commonModels?.Firm && req.tenantKey) {
        try {
            firmRecord = await req.commonModels.Firm.findOne({ where: { key: req.tenantKey } });
        } catch (error) {
            console.error("Firm lookup error:", error);
        }
    }

    const title = firmRecord?.displayName || DEFAULT_TITLE;

    console.log(DEFAULT_LOGIN_LOGO)

    try {
        const firmLogo = await resolveFirmLoginLogo(req, firmRecord);
        res.render("erplogin", { isNoNavbar: true, firmLogo, title });
    } catch (error) {
        console.error("Login logo resolution failed:", error);
        res.render("erplogin", { isNoNavbar: true, firmLogo: DEFAULT_LOGIN_LOGO, title });
    }
}

exports.postErpLogin = async (req, res, next) => {
    try {
        const { username, password } = req.body;

        const u = await req.models.FirmUser.findOne({ where: { username } });
        if (!u) {
            return res.redirect("/login?error=1");
        }

        const success = await bcrypt.compare(password, u.password);
        if (!success) {
            return res.redirect("/login?error=1");
        }

        req.session.firmUser = u;
        req.session.isAuthenticated = true;
        req.session.firm = await req.commonModels.Firm.findOne({ where: { key: req.tenantKey } })

        const userPerms = await req.models.FirmUserPermission.findAll({
            where: { firmUserId: u.id, allow: true },
            attributes: ["permissionId"],
        });

        const permissionIds = userPerms.map(p => p.permissionId);
        if (permissionIds.length) {
            const permissionRows = await req.models.Permission.findAll({
                where: { id: { [Op.in]: permissionIds } },
                attributes: ["code"],
            });
            req.session.permissions = permissionRows.map(p => p.code);
        } else {
            req.session.permissions = [];
        }

        req.session.save(() => {
            const url = "/";

            console.log("Logged in user:", u.name);
            res.redirect(url);
        });


    } catch (err) {
        console.error(err);
        next(err);
    }
};

exports.postErpLogout = (req, res, next) => {
    if (!req.session) {
        return res.redirect("/login");
    }

    const tenantKey = req.tenantKey;
    if (tenantKey && req.session.tenants && req.session.tenants[tenantKey]) {
        delete req.session.tenants[tenantKey];
    }

    const remainingTenants = req.session.tenants && Object.keys(req.session.tenants).length > 0;

    if (!remainingTenants) {
        return req.session.destroy((err) => {
            if (err) {
                console.error("Error during logout:", err);
                return next(err);
            }

            res.clearCookie("connect.sid");
            res.redirect("/login");
        });
    }

    req.session.save((err) => {
        if (err) {
            console.error("Error during logout:", err);
            return next(err);
        }

        res.redirect("/login");
    });
};

exports.getPermissions = (req, res) => res.json(req.session.permissions || []);

exports.getTicketRow = async (req, res, next) => {
    const { isOpen, isTaken, date: tripDate, time: tripTime, tripId, stopId, seatTypes, action } = req.query;

    const tripWhere = {};
    if (tripDate) tripWhere.date = tripDate;
    if (tripTime) tripWhere.time = tripTime;
    if (tripId) tripWhere.id = tripId;

    const trip = await req.models.Trip.findOne({ where: tripWhere });
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const [takeOnOptions, takeOffOptions] = await Promise.all([
        req.models.TakeOn ? req.models.TakeOn.findAll({ order: [["title", "ASC"]] }) : [],
        req.models.TakeOff ? req.models.TakeOff.findAll({ order: [["title", "ASC"]] }) : [],
    ]);

    const branch = await req.models.Branch.findOne({ where: { id: req.session.firmUser.branchId } });
    const isOwnBranch = stopId ? branch?.stopId == stopId : false;

    const routeStops = await req.models.RouteStop.findAll({
        where: { routeId: trip.routeId },
        order: [["order", "ASC"]],
    });

    const findPriceForStops = async (fromStopId, toStopId) => {
        if (!fromStopId || !toStopId) return null;

        let priceRecord = await req.models.Price.findOne({ where: { fromStopId, toStopId } });
        if (!priceRecord) {
            priceRecord = await req.models.Price.findOne({
                where: {
                    fromStopId: toStopId,
                    toStopId: fromStopId,
                    isBidirectional: true,
                },
            });
        }

        return priceRecord;
    };

    const routeStopOrder = stopId
        ? routeStops.find((rs) => String(rs.stopId) === String(stopId))?.order
        : null;

    trip.modifiedTime = trip.time;
    if (routeStopOrder !== null) {
        const offsets = await req.models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true });
        const offsetMap = buildOffsetMap(offsets);
        const stopTimes = computeRouteStopTimes(trip, routeStops, offsetMap);
        const matchedStopTime = stopTimes.find(st => st.order === routeStopOrder);
        if (matchedStopTime) {
            trip.modifiedTime = matchedStopTime.time;
        }
    }

    if (isOpen) {
        const { fromId, toId, count } = req.query;
        let price = 0;
        if (fromId && toId) {
            const p = await findPriceForStops(fromId, toId);
            price = p ? p : 0;
        }

        let seats = []
        let gender = []
        for (let i = 0; i < count; i++) {
            seats.push(0)
            gender.push("m")
        }
        return res.render("mixins/ticketRow", {
            gender,
            seats,
            price,
            trip,
            isOwnBranch,
            seatTypes,
            action,
            takeOnOptions,
            takeOffOptions,
            nationalityOptions: NATIONALITY_OPTIONS,
        });
    }

    if (isTaken) {
        const { seatNumbers } = req.query;
        const ticket = seatNumbers
            ? await req.models.Ticket.findAll({ where: { tripId: trip.id, seatNo: { [Op.in]: seatNumbers }, fromRouteStopId: stopId, status: { [Op.notIn]: ["cancelled", "refund"] } } })
            : [];

        if (!ticket.length) {
            return res.status(404).json({ message: "Ticket not found" });
        }

        const user = await req.models.FirmUser.findOne({ where: { id: ticket[0].userId } });
        const ticketUserBranch = user ? await req.models.Branch.findOne({ where: { id: user.branchId } }) : null;

        const gender = ticket.map((t) => t.gender);

        let pricesForTickets = [];

        if (ticket.length) {
            const routeStopIds = ticket.reduce((ids, t) => {
                if (t.fromRouteStopId) ids.add(t.fromRouteStopId);
                if (t.toRouteStopId) ids.add(t.toRouteStopId);
                return ids;
            }, new Set());

            const routeStops = routeStopIds.size
                ? await req.models.RouteStop.findAll({ where: { id: { [Op.in]: Array.from(routeStopIds) } } })
                : [];

            const routeStopMap = routeStops.reduce((acc, rs) => {
                acc[rs.id] = rs.stopId;
                return acc;
            }, {});

            const priceCache = {};

            for (const t of ticket) {
                const fromStopId = routeStopMap[t.fromRouteStopId];
                const toStopId = routeStopMap[t.toRouteStopId];

                let priceForSeat = null;

                if (fromStopId && toStopId) {
                    const key = `${fromStopId}-${toStopId}`;

                    if (!(key in priceCache)) {
                        priceCache[key] = await findPriceForStops(fromStopId, toStopId);
                    }

                    priceForSeat = priceCache[key];
                }

                pricesForTickets.push(priceForSeat);
            }
        }

        return res.render("mixins/ticketRow", {
            gender,
            seats: seatNumbers,
            ticket,
            trip,
            isOwnBranch,
            seatTypes,
            action,
            price: pricesForTickets,
            takeOnOptions,
            takeOffOptions,
            nationalityOptions: NATIONALITY_OPTIONS,
        });
    }

    const { fromId, toId, seats: seatParam, gender: genderParam } = req.query;
    const seatArray = Array.isArray(seatParam)
        ? seatParam
        : seatParam !== undefined && seatParam !== null && seatParam !== ""
            ? [seatParam]
            : [];

    if (!seatArray.length) {
        return res.status(400).json({ message: "Please select at least one seat." });
    }

    const gender = seatArray.map(() => genderParam);
    let price = 0;
    if (fromId && toId) {
        const p = await findPriceForStops(fromId, toId);
        price = p ? p : null;
    }

    const routeStopOrderMap = routeStops.reduce((acc, rs) => {
        acc[String(rs.stopId)] = Number(rs.order);
        return acc;
    }, {});

    const fromOrder = routeStopOrderMap[String(fromId)];
    const toOrder = routeStopOrderMap[String(toId)];

    if (!Number.isFinite(fromOrder) || !Number.isFinite(toOrder)) {
        return res.status(400).json({ message: "Selected stops not found in trip route." });
    }

    if (fromOrder >= toOrder) {
        return res.status(400).json({ message: "Please select a valid route." });
    }

    const seatLabelMap = new Map();
    for (const seat of seatArray) {
        const numericSeat = Number(seat);
        if (!Number.isFinite(numericSeat)) {
            continue;
        }
        if (!seatLabelMap.has(numericSeat)) {
            seatLabelMap.set(numericSeat, String(seat));
        }
    }

    if (!seatLabelMap.size) {
        return res.status(400).json({ message: "No valid seat selection found." });
    }

    const seatNumbers = Array.from(seatLabelMap.keys());

    const existingTickets = await req.models.Ticket.findAll({
        where: {
            tripId: trip.id,
            seatNo: { [Op.in]: seatNumbers },
            status: { [Op.notIn]: ["canceled", "cancelled", "refund"] },
        },
        attributes: ["seatNo", "fromRouteStopId", "toRouteStopId"],
        raw: true,
    });

    const segmentsOverlap = (startA, endA, startB, endB) => {
        const values = [startA, endA, startB, endB];
        if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
            return true;
        }

        if (startA >= endA || startB >= endB) {
            return true;
        }

        return startA < endB && startB < endA;
    };

    let conflictingSeatNumber = null;

    for (const seatNumber of seatNumbers) {
        const seatTickets = existingTickets.filter((ticket) => Number(ticket.seatNo) === seatNumber);

        for (const ticket of seatTickets) {
            const ticketFromOrder = routeStopOrderMap[String(ticket.fromRouteStopId)];
            const ticketToOrder = routeStopOrderMap[String(ticket.toRouteStopId)];

            if (segmentsOverlap(fromOrder, toOrder, ticketFromOrder, ticketToOrder)) {
                conflictingSeatNumber = seatNumber;
                break;
            }
        }

        if (conflictingSeatNumber !== null) {
            break;
        }
    }

    if (conflictingSeatNumber !== null) {
        const seatLabel = seatLabelMap.get(conflictingSeatNumber) ?? String(conflictingSeatNumber);
        return res.status(409).json({
            message: `Seat number ${seatLabel} is not available for the selected route.`,
        });
    }

    const group = await req.models.TicketGroup.create({ tripId: trip.id });
    const ticketGroupId = group.id;

    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const nowDate = now.toISOString().split("T")[0];
    const nowTime = now.toTimeString().split(" ")[0];

    let pendingIds = []

    for (let i = 0; i < seatArray.length; i++) {
        const seatNumber = seatArray[i];

        const ticket = await req.models.Ticket.create({
            seatNo: seatNumber,
            gender: gender[i],
            nationality: "tr",
            tripId: trip.id,
            ticketGroupId: ticketGroupId,
            status: "pending",
            optionTime: nowTime,
            optionDate: nowDate,
            fromRouteStopId: fromId,
            toRouteStopId: toId,
            userId: req.session.firmUser.id,
        });

        await ticket.save()

        pendingIds.push(ticket.id)
    }

    return res.render("mixins/ticketRow", {
        gender,
        seats: seatArray,
        price,
        trip,
        isOwnBranch,
        seatTypes,
        action,
        pendingIds,
        takeOnOptions,
        takeOffOptions,
        nationalityOptions: NATIONALITY_OPTIONS,
    });
};

exports.postTickets = async (req, res, next) => {
    try {
        const tickets = Array.isArray(req.body.tickets)
            ? req.body.tickets
            : JSON.parse(req.body.tickets || "[]");

        const tripDate = req.body.tripDate;
        const tripTime = req.body.tripTime;
        const tripId = req.body.tripId;
        const status = req.body.status;
        const fromId = req.body.fromId;
        const toId = req.body.toId;

        let normalizedIdNumbers = [];
        const seenIdNumbers = new Set();
        const requiresIdentityNumber = status !== "reservation";

        for (const ticket of tickets) {
            const normalizedIdNumber = normalizeIdentityNumber(ticket?.idNumber);

            if (!normalizedIdNumber) {
                if (requiresIdentityNumber) {
                    return res.status(400).json({ message: "Please enter an ID number." });
                }

                ticket.idNumber = null;
                continue;
            }

            if (seenIdNumbers.has(normalizedIdNumber)) {
                return res.status(400).json({
                    message: `You selected multiple tickets for ID number ${normalizedIdNumber}.`,
                });
            }

            seenIdNumbers.add(normalizedIdNumber);
            normalizedIdNumbers.push(normalizedIdNumber);
            ticket.idNumber = normalizedIdNumber;
        }

        const tripWhere = {};
        if (tripDate) tripWhere.date = tripDate;
        if (tripTime) tripWhere.time = tripTime;
        if (tripId) tripWhere.id = tripId;

        if (Object.keys(tripWhere).length === 0) {
            return res.status(400).json({ message: "Invalid trip parameters." });
        }

        const trip = await req.models.Trip.findOne({ where: tripWhere });
        if (!trip) {
            return res.status(404).json({ message: "Trip not found." });
        }

        if (normalizedIdNumbers.length) {
            const existingTicketWithSameId = await req.models.Ticket.findOne({
                where: {
                    tripId: trip.id,
                    idNumber: { [Op.in]: normalizedIdNumbers },
                    status: { [Op.notIn]: NON_ACTIVE_TICKET_STATUSES },
                },
            });

            if (existingTicketWithSameId) {
                return res.status(409).json({
                    message: `A ticket already exists for ID number ${existingTicketWithSameId.idNumber} on this trip.`,
                });
            }
        }

        const route = trip.routeId ? await req.models.Route.findByPk(trip.routeId, { raw: true }) : null;

        if (status === "reservation") {
            const reservationCheck = await checkReservationLimit(req.models, trip, route, tickets.length);
            if (reservationCheck.exceeded) {
                return res.status(400).json({
                    message: `Maximum reservation limit (${reservationCheck.limit}) cannot be exceeded.`,
                });
            }
        }

        if (status === "reservation" || status === "completed") {
            const seatNumbers = tickets
                .map((t) => t?.seatNumber)
                .filter((seat) => seat !== undefined && seat !== null && seat !== "");
            const singleSeatCheck = await checkSingleSeatLimit(req.models, trip, route, seatNumbers);
            if (singleSeatCheck.exceeded) {
                return res.status(400).json({
                    message: `Single seat limit (${singleSeatCheck.limit}) exceeded. Please select different seats.`,
                });
            }
        }

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: trip.routeId },
            order: [["order", "ASC"]],
        });

        const stopIds = [...new Set(routeStops.map((rs) => rs?.stopId).filter(Boolean))];
        let stops = [];
        if (stopIds.length) {
            stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } } });
        }

        const group = await req.models.TicketGroup.create({ tripId: trip.id });
        const ticketGroupId = group.id;

        const pnr = fromId && toId ? await generatePNR(req.models, fromId, toId, stops) : null;

        const pendingIds = Array.isArray(req.body.pendingIds)
            ? req.body.pendingIds
            : JSON.parse(req.body.pendingIds);

        const takeOnCache = await prepareTakeValueCache(req.models.TakeOn);
        const takeOffCache = await prepareTakeValueCache(req.models.TakeOff);
        const isReservationStatus = status === "reservation";

        for (let i = 0; i < tickets.length; i++) {
            const t = tickets[i];
            if (!t) continue;

            const pendingTicket = await req.models.Ticket.findOne({
                where: {
                    id: pendingIds[i],
                    tripId: trip.id,
                    seatNo: t.seatNumber,
                    userId: req.session.firmUser.id,
                },
            });

            const pendingTicketGroupId = pendingTicket?.ticketGroupId;
            if (pendingTicket) await pendingTicket.destroy().then(() => console.log("pending deleted"));

            if (pendingTicketGroupId) {
                const remainingTicketsInGroup = await req.models.Ticket.count({
                    where: { ticketGroupId: pendingTicketGroupId },
                });

                if (remainingTicketsInGroup === 0) {
                    await req.models.TicketGroup.destroy({ where: { id: pendingTicketGroupId } }).then(() =>
                        console.log("pending group deleted")
                    );
                }
            }

            const takeOnTitle = await ensureTakeValue(takeOnCache, t.takeOn);
            const takeOffTitle = await ensureTakeValue(takeOffCache, t.takeOff);

            const ticket = await req.models.Ticket.create({
                seatNo: t.seatNumber,
                gender: t.gender,
                nationality: t.nationality,
                idNumber: t.idNumber,
                name: (t.name || "").toLocaleUpperCase("tr-TR"),
                surname: (t.surname || "").toLocaleUpperCase("tr-TR"),
                price: t.price ? t.price : null,
                tripId: trip.id,
                ticketGroupId: ticketGroupId,
                status: status,
                phoneNumber: t.phoneNumber,
                customerType: t.type,
                customerCategory: t.category,
                optionTime: t.optionTime,
                optionDate: t.optionDate,
                fromRouteStopId: fromId,
                toRouteStopId: toId,
                userId: req.session.firmUser.id,
                pnr: pnr,
                payment: t.payment,
                takeOnText: takeOnTitle,
                takeOffText: takeOffTitle,
            });

            const nameUp = (t.name || "").toLocaleUpperCase("tr-TR");
            const surnameUp = (t.surname || "").toLocaleUpperCase("tr-TR");

            const orConds = [];
            if (t.idNumber) orConds.push({ idNumber: t.idNumber });
            if (nameUp && surnameUp) orConds.push({ name: nameUp, surname: surnameUp });

            let existingCustomer = null;
            if (orConds.length) {
                existingCustomer = await req.models.Customer.findOne({ where: { [Op.or]: orConds } });
            }

            if (!existingCustomer && !isReservationStatus) {
                await req.models.Customer.create({
                    idNumber: t.idNumber || null,
                    name: nameUp || null,
                    surname: surnameUp || null,
                    phoneNumber: t.phoneNumber || null,
                    gender: t.gender || null,
                    nationality: t.nationality || null,
                    customerType: t.type || null,
                    customerCategory: t.category || null,
                });
            } else if (existingCustomer) {
                ticket.customerId = existingCustomer.id;
                if (
                    existingCustomer.customerCategory == "member" &&
                    existingCustomer.pointOrPercent == "point"
                ) {
                    if (ticket.payment === "point") {
                        existingCustomer.point_amount -= Number(ticket.price);
                    } else {
                        existingCustomer.point_amount += Number(ticket.price) * 0.05;
                    }
                }
                await ticket.save();
                await existingCustomer.save();
            }

            if (ticket.status === "completed" && ticket.payment !== "point") {
                const fromTitle = stops.find((s) => s.id == ticket.fromRouteStopId)?.title || "";
                const toTitle = stops.find((s) => s.id == ticket.toRouteStopId)?.title || "";

                await req.models.Transaction.create({
                    userId: req.session.firmUser.id,
                    type: "income",
                    category:
                        ticket.payment === "cash"
                            ? "cash_sale"
                            : ticket.payment === "card"
                                ? "card_sale"
                                : "point_sale",
                    amount: ticket.price,
                    description: `${trip.date} ${trip.time} | ${fromTitle} - ${toTitle}`,
                    ticketId: ticket.id,
                });

                const register = await req.models.CashRegister.findOne({
                    where: { userId: req.session.firmUser.id },
                });
                if (register) {
                    if (ticket.payment === "cash") {
                        register.cash_balance += Number(ticket.price) || 0;
                    } else if (ticket.payment === "card") {
                        register.card_balance += Number(ticket.price) || 0;
                    }
                    await register.save();
                }
            }

            if (status === "completed" && trip.uetdsRefNo) {
                try {
                    const grup = await seferGrupListesi(req, trip);
                    if (!grup) {
                        console.warn(`⚠️ Trip #${trip.id}: Group not found, passenger not sent.`);
                        continue;
                    }

                    const yolcuResult = await yolcuEkle(req, trip, grup.grupId, t);
                    console.log(`✅ [UETDS] ${t.name} ${t.surname} added:`, yolcuResult?.sonucMesaji);

                    const yolcuRefNo = yolcuResult?.uetdsYolcuRefNo || yolcuResult?.return?.uetdsYolcuRefNo;
                    if (yolcuRefNo) {
                        ticket.uetdsRefNo = yolcuRefNo;
                        await ticket.save();
                        console.log(`🎫 [UETDS] PassengerRefNo saved: ${yolcuRefNo} (Ticket #${ticket.id})`);
                    }

                    const toplamUcret = await req.models.Ticket.sum("price", {
                        where: { tripId: trip.id, status: "completed" },
                    });

                    if (toplamUcret > 0) {
                        const guncelleSonuc = await seferGrupGuncelle(req, trip, grup.grupId, {
                            grupUcret: toplamUcret,
                        });
                        console.log(
                            `💰 [UETDS] Group price updated (${toplamUcret}):`,
                            guncelleSonuc?.sonucMesaji
                        );
                    }
                } catch (uetdsErr) {
                    console.error(`❌ [UETDS] Trip #${trip.id} error:`, uetdsErr.message);
                }
            }

            console.log(`${t.name} Saved - ${pnr || "-"}`);
            res.locals.newRecordId = ticket.id;
        }

        return res.status(200).json({ message: "Tickets saved successfully." });
    } catch (err) {
        console.error("Save error:", err);
        return res.status(500).json({ message: "An error occurred during save." });
    }
};

exports.postCompleteTickets = async (req, res, next) => {
    try {
        const tickets = Array.isArray(req.body.tickets)
            ? req.body.tickets
            : JSON.parse(req.body.tickets || "[]");

        const tripDate = req.body.tripDate;
        const tripTime = req.body.tripTime;
        const tripId = req.body.tripId;
        const status = req.body.status;

        let normalizedIdNumbers = [];
        if (status === "completed") {
            const seenIdNumbers = new Set();
            for (const ticket of tickets) {
                const normalizedIdNumber = normalizeIdentityNumber(ticket?.idNumber);

                if (!normalizedIdNumber) {
                    return res.status(400).json({ message: "Please enter an ID number." });
                }

                if (seenIdNumbers.has(normalizedIdNumber)) {
                    return res.status(400).json({ message: `You selected multiple tickets for ID number ${normalizedIdNumber}.` });
                }

                seenIdNumbers.add(normalizedIdNumber);
                normalizedIdNumbers.push(normalizedIdNumber);
                ticket.idNumber = normalizedIdNumber;
            }
        }

        const pnr = tickets[0]?.pnr;
        const seatNumbers = tickets.map((t) => t.seatNumber);

        const tripWhere = {};
        if (tripDate) tripWhere.date = tripDate;
        if (tripTime) tripWhere.time = tripTime;
        if (tripId) tripWhere.id = tripId;

        if (Object.keys(tripWhere).length === 0) {
            return res.status(400).json({ message: "Invalid trip parameters." });
        }

        const trip = await req.models.Trip.findOne({ where: tripWhere });
        if (!trip) {
            return res.status(404).json({ message: "Trip not found." });
        }

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: trip.routeId },
            order: [["order", "ASC"]],
        });
        const stopIds = [...new Set(routeStops.map((rs) => rs?.stopId).filter(Boolean))];
        const stops = stopIds.length
            ? await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } } })
            : [];

        const foundTickets = await req.models.Ticket.findAll({
            where: { tripId: trip.id, pnr: pnr, seatNo: { [Op.in]: seatNumbers } },
        });

        if (normalizedIdNumbers.length) {
            const excludeIds = foundTickets.map((ticket) => ticket.id);
            const whereClause = {
                tripId: trip.id,
                idNumber: { [Op.in]: normalizedIdNumbers },
                status: { [Op.notIn]: NON_ACTIVE_TICKET_STATUSES },
            };

            if (excludeIds.length) {
                whereClause.id = { [Op.notIn]: excludeIds };
            }

            const existingTicketWithSameId = await req.models.Ticket.findOne({
                where: whereClause,
            });

            if (existingTicketWithSameId) {
                return res.status(409).json({
                    message: `A ticket already exists for ID number ${existingTicketWithSameId.idNumber} on this trip.`,
                });
            }
        }

        const takeOnCache = await prepareTakeValueCache(req.models.TakeOn);
        const takeOffCache = await prepareTakeValueCache(req.models.TakeOff);

        for (let i = 0; i < foundTickets.length; i++) {
            const ticket = foundTickets[i];
            const incomingTicket = tickets[i] || {};

            const normalizedIdNumber =
                typeof incomingTicket.idNumber === "string"
                    ? incomingTicket.idNumber.trim()
                    : incomingTicket.idNumber !== undefined && incomingTicket.idNumber !== null
                        ? String(incomingTicket.idNumber).trim()
                        : "";

            ticket.userId = req.session.firmUser.id;
            ticket.idNumber = normalizedIdNumber;
            ticket.name = incomingTicket.name;
            ticket.surname = incomingTicket.surname;
            ticket.phoneNumber = incomingTicket.phoneNumber;
            ticket.gender = incomingTicket.gender;
            ticket.nationality = incomingTicket.nationality;

            ticket.customerType = incomingTicket.type;
            ticket.customerCategory = incomingTicket.category;

            ticket.optionTime = incomingTicket.optionTime;
            ticket.price = incomingTicket.price;
            ticket.payment = incomingTicket.payment;
            ticket.status = "completed";
            ticket.createdAt = new Date();

            const takeOnTitle = await ensureTakeValue(takeOnCache, incomingTicket.takeOn);
            const takeOffTitle = await ensureTakeValue(takeOffCache, incomingTicket.takeOff);
            ticket.takeOnText = takeOnTitle;
            ticket.takeOffText = takeOffTitle;

            const nameUp = (ticket.name || "").toLocaleUpperCase("tr-TR");
            const surnameUp = (ticket.surname || "").toLocaleUpperCase("tr-TR");

            const orConds = [];
            if (ticket.idNumber) orConds.push({ idNumber: ticket.idNumber });
            if (nameUp && surnameUp) orConds.push({ name: nameUp, surname: surnameUp });

            let existingCustomer = null;
            if (orConds.length) {
                existingCustomer = await req.models.Customer.findOne({ where: { [Op.or]: orConds } });
            }

            if (!existingCustomer) {
                const customer = await req.models.Customer.create({
                    idNumber: ticket.idNumber || null,
                    name: nameUp || null,
                    surname: surnameUp || null,
                    phoneNumber: ticket.phoneNumber || null,
                    gender: ticket.gender || null,
                    nationality: ticket.nationality || null,
                    customerType: ticket.customerType || null,
                    customerCategory: ticket.customerCategory || null,
                });
                ticket.customerId = customer.id;
            }

            await ticket.save();

            const fromTitle = stops.find((s) => s.id == ticket.fromRouteStopId)?.title || "";
            const toTitle = stops.find((s) => s.id == ticket.toRouteStopId)?.title || "";

            await req.models.Transaction.create({
                userId: req.session.firmUser.id,
                type: "income",
                category:
                    ticket.payment === "cash"
                        ? "cash_sale"
                        : ticket.payment === "card"
                            ? "card_sale"
                            : "point_sale",
                amount: ticket.price,
                description: `${trip.date} ${trip.time} | ${fromTitle} - ${toTitle}`,
                ticketId: ticket.id,
            });

            const register = await req.models.CashRegister.findOne({
                where: { userId: req.session.firmUser.id },
            });
            if (register) {
                if (ticket.payment === "cash") {
                    register.cash_balance = Number(register.cash_balance) + (Number(ticket.price) || 0);
                } else if (ticket.payment === "card") {
                    register.card_balance = Number(register.card_balance) + (Number(ticket.price) || 0);
                }
                await register.save();
            }
        }

        return res.status(200).json({ message: "Tickets saved successfully." });
    } catch (err) {
        console.error("Save error:", err);
        return res.status(500).json({ message: "An error occurred during save." });
    }
};

exports.postSellOpenTickets = async (req, res, next) => {
    try {
        const { tickets: rawTickets, status, fromId, toId } = req.body;
        const tickets = JSON.parse(rawTickets);
        const userId = req.session.firmUser.id;
        const isReservation = status === "reservation";

        const toUpperTR = (val) => (val || "").toLocaleUpperCase("tr-TR");

        const stops = await req.models.Stop.findAll({
            where: { id: [fromId, toId] }
        });
        const fromStop = stops.find(s => s.id == fromId);
        const toStop = stops.find(s => s.id == toId);

        const group = await req.models.TicketGroup.create({ tripId: null });
        const ticketGroupId = group.id;

        const pnr = (fromId && toId)
            ? await generatePNR(req.models, fromId, toId, stops)
            : null;

        const takeOnCache = await prepareTakeValueCache(req.models.TakeOn);
        const takeOffCache = await prepareTakeValueCache(req.models.TakeOff);

        const idNumbers = new Set();
        const namePairs = new Set();

        for (const t of tickets) {
            if (t.idNumber) idNumbers.add(t.idNumber);
            if (t.name && t.surname)
                namePairs.add(`${toUpperTR(t.name)}|${toUpperTR(t.surname)}`);
        }

        const existingCustomers = await req.models.Customer.findAll({
            where: {
                [Op.or]: [
                    { idNumber: { [Op.in]: Array.from(idNumbers) } },
                    ...Array.from(namePairs).map(pair => {
                        const [name, surname] = pair.split("|");
                        return { name, surname };
                    })
                ]
            }
        });

        const existingKeys = new Set(
            existingCustomers.map(c => c.idNumber || `${c.name}|${c.surname}`)
        );

        const ticketData = [];
        const transactionData = [];
        const newCustomers = [];

        for (const t of tickets) {
            const nameUp = toUpperTR(t.name);
            const surnameUp = toUpperTR(t.surname);
            const key = t.idNumber || `${nameUp}|${surnameUp}`;

            const takeOnTitle = takeOnCache[t.takeOn] || t.takeOn || "";
            const takeOffTitle = takeOffCache[t.takeOff] || t.takeOff || "";

            ticketData.push({
                seatNo: 0,
                gender: t.gender,
                nationality: t.nationality,
                idNumber: t.idNumber,
                name: nameUp,
                surname: surnameUp,
                price: t.price ?? 0,
                tripId: null,
                ticketGroupId,
                status,
                phoneNumber: t.phoneNumber,
                customerType: t.type,
                customerCategory: t.category,
                optionTime: t.optionTime,
                fromRouteStopId: fromId,
                toRouteStopId: toId,
                userId,
                pnr,
                payment: t.payment,
                takeOnText: takeOnTitle,
                takeOffText: takeOffTitle
            });

            if (!isReservation && !existingKeys.has(key)) {
                existingKeys.add(key);
                newCustomers.push({
                    idNumber: t.idNumber || null,
                    name: nameUp || null,
                    surname: surnameUp || null,
                    phoneNumber: t.phoneNumber || null,
                    gender: t.gender || null,
                    nationality: t.nationality || null,
                    customerType: t.type || null,
                    customerCategory: t.category || null
                });
            }

            transactionData.push({
                userId,
                type: "income",
                category:
                    t.payment === "cash"
                        ? "cash_sale"
                        : t.payment === "card"
                            ? "card_sale"
                            : "point_sale",
                amount: t.price ?? 0,
                description: `Open ticket sold | ${fromStop?.title || ""} - ${toStop?.title || ""}`
            });
        }

        if (newCustomers.length) {
            await req.models.Customer.bulkCreate(newCustomers, {
                ignoreDuplicates: true
            });
        }

        const createdTickets = await req.models.Ticket.bulkCreate(ticketData, {
            returning: true
        });

        transactionData.forEach((tr, i) => {
            tr.ticketId = createdTickets[i].id;
        });

        await req.models.Transaction.bulkCreate(transactionData);

        const register = await req.models.CashRegister.findOne({
            where: { userId }
        });

        if (register) {
            const cashTotal = tickets
                .filter(t => t.payment === "cash")
                .reduce((a, b) => a + (Number(b.price) || 0), 0);
            const cardTotal = tickets
                .filter(t => t.payment === "card")
                .reduce((a, b) => a + (Number(b.price) || 0), 0);

            register.cash_balance += cashTotal;
            register.card_balance += cardTotal;
            await register.save();
        }

        res.status(200).json({
            success: true,
            groupId: ticketGroupId,
            totalTickets: tickets.length,
            totalAmount: tickets.reduce((a, b) => a + (Number(b.price) || 0), 0)
        });

    } catch (err) {
        console.error("Save error:", err);
        res.status(500).json({
            message: "An error occurred during save.",
            error: err.message
        });
    }
};


exports.postEditTicket = async (req, res, next) => {
    try {
        const tickets = JSON.parse(req.body.tickets);
        const { tripDate, tripTime } = req.body;

        if (!tickets.length) {
            return res.status(400).json({ message: "No ticket information provided." });
        }

        const trip = await req.models.Trip.findOne({ where: { date: tripDate, time: tripTime } });
        if (!trip) {
            return res.status(404).json({ message: "Trip not found." });
        }

        const foundTickets = await req.models.Ticket.findAll({
            where: { pnr: tickets[0].pnr, tripId: trip.id },
            order: [["seatNo", "ASC"]]
        });

        if (foundTickets.length !== tickets.length) {
            return res.status(400).json({ message: "Invalid ticket information provided." });
        }

        const normalizePriceValue = (value) => {
            if (value === undefined || value === null) return null;
            if (typeof value === "string" && value.trim() === "") return null;
            const num = Number(value);
            return Number.isNaN(num) ? null : num;
        };

        for (let i = 0; i < foundTickets.length; i++) {
            const foundTicket = foundTickets[i];
            const incomingTicket = tickets[i] || {};
            const existingPrice = normalizePriceValue(foundTicket.price);
            const incomingPrice = normalizePriceValue(incomingTicket.price);

            if (existingPrice !== incomingPrice) {
                return res.status(400).json({ message: "Ticket price cannot be changed during editing." });
            }
        }

        const takeOnCache = await prepareTakeValueCache(req.models.TakeOn);
        const takeOffCache = await prepareTakeValueCache(req.models.TakeOff);

        await Promise.all(foundTickets.map(async (foundTicket, i) => {
            const incomingTicket = tickets[i] || {};
            foundTicket.idNumber = incomingTicket.idNumber;
            foundTicket.name = incomingTicket.name;
            foundTicket.surname = incomingTicket.surname;
            foundTicket.phoneNumber = incomingTicket.phoneNumber;
            foundTicket.gender = incomingTicket.gender;
            foundTicket.nationality = incomingTicket.nationality;
            foundTicket.customerType = incomingTicket.type;
            foundTicket.customerCategory = incomingTicket.category;
            const takeOnTitle = await ensureTakeValue(takeOnCache, incomingTicket.takeOn);
            const takeOffTitle = await ensureTakeValue(takeOffCache, incomingTicket.takeOff);
            foundTicket.takeOnText = takeOnTitle;
            foundTicket.takeOffText = takeOffTitle;
            return foundTicket.save();
        }));

        res.status(200).json({ message: "Tickets saved successfully." });
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).json({ message: "An error occurred during save." });
    }
};

exports.getCancelOpenTicket = async (req, res, next) => {
    const tripDate = req.query.date;
    const tripTime = req.query.time;
    const pnr = req.query.pnr;
    const seatsParam = req.query.seats;

    const normalizeSeatList = (value) => {
        if (Array.isArray(value)) {
            return value;
        }

        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (error) {
            }

            return value
                .split(",")
                .map(item => item.trim())
                .filter(item => item);
        }

        return [];
    };

    const seats = normalizeSeatList(seatsParam);

    const trip = await req.models.Trip.findOne({ where: { date: tripDate, time: tripTime } });
    if (!trip) {
        return res.status(404).json({ message: "Trip not found." });
    }

    const ticketWhere = seats.length
        ? { pnr, seatNo: { [Op.in]: seats }, tripId: trip.id }
        : { pnr, tripId: trip.id };
    const foundTickets = await req.models.Ticket.findAll({ where: ticketWhere });

    const routeStopsRaw = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] });
    const routeStops = routeStopsRaw.map(rs => rs.get({ plain: true }));

    const stopsRaw = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } });
    const stops = stopsRaw.map(stop => stop.get({ plain: true }));

    const stopTitleMap = new Map(stops.map(stop => [Number(stop.id), stop.title]));
    const routeStopByStopId = new Map(routeStops.map(rs => [Number(rs.stopId), rs]));

    const offsets = routeStops.length
        ? await req.models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true })
        : [];
    const offsetMap = buildOffsetMap(offsets);

    const orderedRouteStops = [...routeStops].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const tripPlain = trip.get({ plain: true });
    const routeStopDateMap = computeRouteStopDateTimes(tripPlain, orderedRouteStops, offsetMap);

    const baseTripDateTime = parseDateTimeInput(`${tripPlain.date} ${tripPlain.time}`);

    let targetRouteStopId = null;
    let targetRouteStopOrder = Number.POSITIVE_INFINITY;

    const tickets = [];

    for (const ticketInstance of foundTickets) {
        if (ticketInstance.tripId !== trip.id) {
            continue;
        }

        const ticket = ticketInstance.get({ plain: true });
        ticket.createdAt = new Date(ticket.createdAt).toLocaleString()
        const fromStopTitle = stopTitleMap.get(Number(ticket.fromRouteStopId));
        const toStopTitle = stopTitleMap.get(Number(ticket.toRouteStopId));
        ticket.from = fromStopTitle;
        ticket.to = toStopTitle;

        tickets.push(ticket);

        const matchedRouteStop = routeStopByStopId.get(Number(ticket.fromRouteStopId));
        if (matchedRouteStop) {
            const order = Number(matchedRouteStop.order);
            if (!Number.isNaN(order) && order < targetRouteStopOrder) {
                targetRouteStopOrder = order;
                targetRouteStopId = Number(matchedRouteStop.id);
            }
        }
    }

    const dateFormatter = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "long", year: "numeric" });
    const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

    const tripData = { ...tripPlain };
    let displayDate = baseTripDateTime && !Number.isNaN(baseTripDateTime.getTime()) ? baseTripDateTime : null;

    if (targetRouteStopId !== null) {
        const computedDate = routeStopDateMap.get(targetRouteStopId);
        if (computedDate instanceof Date && !Number.isNaN(computedDate.getTime())) {
            displayDate = computedDate;
        }
    }

    if (displayDate instanceof Date && !Number.isNaN(displayDate.getTime())) {
        tripData.date = dateFormatter.format(displayDate);
        tripData.time = timeFormatter.format(displayDate);
    } else {
        if (tripData.date) {
            const fallbackDate = parseDateTimeInput(`${tripData.date} ${tripData.time}`) || new Date(`${tripData.date}T${tripData.time || "00:00:00"}`);
            if (fallbackDate instanceof Date && !Number.isNaN(fallbackDate.getTime())) {
                tripData.date = dateFormatter.format(fallbackDate);
            }
        }
        tripData.time = formatTimeWithoutSeconds(tripData.time);
    }

    res.render("mixins/ticketCancelRefund", { tickets, trip: tripData });
}

exports.postCancelTicket = async (req, res, next) => {
    try {
        const tripDate = req.body.date;
        const tripTime = req.body.time;

        const trip = await req.models.Trip.findOne({
            where: { date: tripDate, time: tripTime },
        });
        if (!trip) return res.status(404).json({ message: "Trip not found." });

        const seats = JSON.parse(req.body.seats || "[]");
        const pnr = req.body.pnr;

        const tickets = await req.models.Ticket.findAll({
            where: { pnr, seatNo: { [Op.in]: seats }, tripId: trip.id },
        });
        if (!tickets.length) {
            return res.status(404).json({ message: "Ticket not found." });
        }

        const stopIds = [
            ...new Set(tickets.map((t) => t.fromRouteStopId)),
            ...new Set(tickets.map((t) => t.toRouteStopId)),
        ].filter(Boolean);

        const stops = stopIds.length
            ? await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } } })
            : [];

        let didAnyRefund = false;

        for (const ticket of tickets) {
            if (ticket.tripId !== trip.id) continue;

            const currentStatus = ticket.status;
            ticket.status = currentStatus === "reservation" ? "canceled" : "refund";
            await ticket.save();

            if (ticket.status === "refund" && ticket.payment !== "point") {
                didAnyRefund = true;

                const fromTitle = stops.find((s) => s.id == ticket.fromRouteStopId)?.title || "";
                const toTitle = stops.find((s) => s.id == ticket.toRouteStopId)?.title || "";

                await req.models.Transaction.create({
                    userId: req.session.firmUser.id,
                    type: "expense",
                    category:
                        ticket.payment === "cash"
                            ? "cash_refund"
                            : ticket.payment === "card"
                                ? "card_refund"
                                : "point_refund",
                    amount: ticket.price,
                    description: `Ticket refunded | ${fromTitle} - ${toTitle}`,
                    ticketId: ticket.id,
                });

                const register = await req.models.CashRegister.findOne({
                    where: { userId: req.session.firmUser.id },
                });
                if (register) {
                    if (ticket.payment === "cash") {
                        register.cash_balance -= Number(ticket.price) || 0;
                    } else if (ticket.payment === "card") {
                        register.card_balance -= Number(ticket.price) || 0;
                    }
                    await register.save();
                }
            }

            if (ticket.status === "refund" && ticket.payment === "point") {
                didAnyRefund = true;

                const nameUp = (ticket.name || "").toLocaleUpperCase("tr-TR");
                const surnameUp = (ticket.surname || "").toLocaleUpperCase("tr-TR");

                const orConds = [];
                if (ticket.idNumber) orConds.push({ idNumber: ticket.idNumber });
                if (nameUp && surnameUp) orConds.push({ name: nameUp, surname: surnameUp });

                if (orConds.length) {
                    const customer = await req.models.Customer.findOne({ where: { [Op.or]: orConds } });
                    if (
                        customer?.customerCategory === "member" &&
                        customer?.pointOrPercent === "point"
                    ) {
                        customer.point_amount = Number(customer.point_amount || 0) + Number(ticket.price || 0);
                        await customer.save();
                    }
                }
            }

            if (
                ticket.status === "refund" &&
                trip.uetdsRefNo &&
                ticket.uetdsRefNo
            ) {
                try {
                    await yolcuIptalUetdsYolcuRefNoIle(
                        req,
                        trip,
                        ticket.uetdsRefNo,
                        "Passenger refund processed"
                    );
                } catch (e) {
                    console.error(`❌ [UETDS] Passenger cancel error (Ticket #${ticket.id}):`, e.message);
                }
            }

            res.locals.newRecordId = ticket.id;
        }

        if (didAnyRefund && trip.uetdsRefNo) {
            try {
                const group = await seferGrupListesi(req, trip);
                if (!group) {
                    console.warn(`⚠️ Trip #${trip.id}: Group not found, price could not be updated.`);
                } else {
                    const toplamUcret = await req.models.Ticket.sum("price", {
                        where: { tripId: trip.id, status: "completed" },
                    });

                    const sonuc = await seferGrupGuncelle(req, trip, group.grupId, {
                        grupUcret: toplamUcret || 0,
                    });
                    console.log(
                        `💰 [UETDS] Group price updated (${toplamUcret || 0}):`,
                        sonuc?.sonucMesaji
                    );
                }
            } catch (e) {
                console.error(`❌ [UETDS] Group price update error (Trip #${trip.id}):`, e.message);
            }
        }

        return res.status(200).json({ message: "Tickets successfully canceled." });
    } catch (err) {
        console.error("Save error:", err);
        return res.status(500).json({ message: "An error occurred during save." });
    }
};

exports.postDeletePendingTickets = async (req, res, next) => {
    try {
        const { date, time, tripId } = req.body;
        const seats = JSON.parse(req.body.seats);
        const pendingIds = JSON.parse(req.body.pendingIds);

        console.log(pendingIds)

        const trip = await req.models.Trip.findOne({
            where: {
                date,
                time,
                id: tripId
            }
        })

        const deleted = await req.models.Ticket.destroy({
            where: {
                tripId: trip.id,
                seatNo: { [Op.in]: seats },
                id: { [Op.in]: pendingIds }
            }
        });

        if (deleted === 0) {
            return res.status(404).json({ message: "No eligible records found to delete." });
        }

        return res.status(200).json({
            message: "Pending ticket(s) successfully deleted.",
            deleted
        });
    } catch (err) {
        console.error("postDeletePendingTickets error:", err);
        return res.status(500).json({ message: "Server error." });
    }
};

exports.postOpenTicket = async (req, res, next) => {
    try {
        const tripDate = req.body.date
        const tripTime = req.body.time
        const trip = await req.models.Trip.findOne({ where: { date: tripDate, time: tripTime } })
        const seats = JSON.parse(req.body.seats);
        const pnr = req.body.pnr;

        const tickets = await req.models.Ticket.findAll({ where: { pnr: pnr, seatNo: { [Op.in]: seats }, tripId: trip.id } });

        for (let i = 0; i < tickets.length; i++) {
            if (tickets[i].tripId == trip.id) {
                tickets[i].status = "open"
                tickets[i].tripId = null
                tickets[i].seatNo = null

                await tickets[i].save()
            }
        }

        res.status(200).json({ message: "Tickets successfully moved to open status." });
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).json({ message: "An error occurred during save." });
    }
}

exports.getMoveTicket = async (req, res, next) => {
    const pnr = req.query.pnr
    const tripId = req.query.tripId
    const stopId = req.query.stopId

    const tickets = await req.models.Ticket.findAll({ where: { pnr, tripId }, order: [["seatNo", "ASC"]] })
    const trip = await req.models.Trip.findOne({ where: { id: tickets[0].tripId } })


    trip.modifiedTime = trip.time

    const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
    const currentRouteStop = routeStops.find(rs => rs.stopId == stopId)
    const routeStopOrder = currentRouteStop ? currentRouteStop.order : null

    if (currentRouteStop) {
        const offsets = await req.models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true })
        const offsetMap = buildOffsetMap(offsets)
        const stopTimes = computeRouteStopTimes(trip, routeStops, offsetMap)
        const matchedStopTime = stopTimes.find(st => st.order === routeStopOrder)
        if (matchedStopTime) {
            trip.modifiedTime = matchedStopTime.time
        }
    }

    const tripDate = new Date(trip.date);
    const [hours, minutes] = trip.modifiedTime.split(":");
    const pad = (num) => String(num).padStart(2, "0");
    trip.dateString = `${pad(tripDate.getDate())}/${pad(tripDate.getMonth() + 1)}`
    trip.timeString = `${hours}.${minutes}`

    const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })
    for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i];

        t.fromPlaceString = stops.find(s => s.id == t.fromRouteStopId).title
        t.toPlaceString = stops.find(s => s.id == t.toRouteStopId).title
    }

    res.render("mixins/moveTicket", { trip, tickets })
};

exports.getOpenMoveTicket = async (req, res, next) => {
    try {
        const { pnr } = req.query;

        if (!pnr) {
            return res.status(400).json({ message: "PNR is missing." });
        }

        const tickets = await req.models.Ticket.findAll({
            where: { pnr, tripId: null, status: "open" },
            order: [["id", "ASC"]],
        });

        if (!tickets.length) {
            return res.status(404).json({ message: "Open ticket not found." });
        }

        const context = await buildOpenTicketMoveContext(req.models, tickets);

        res.render("mixins/moveTicket", { trip: context.trip, tickets: context.tickets });
    } catch (error) {
        console.error("Open ticket query error:", error);
        res.status(500).json({ message: "Could not retrieve open ticket information." });
    }
};

exports.getAttachOpenTicket = async (req, res, next) => {
    try {
        const { pnr: rawPnr, ticketIds: rawTicketIds } = req.query;

        let parsedTicketIds = [];
        if (rawTicketIds !== undefined) {
            try {
                const ticketIdValues = JSON.parse(rawTicketIds);
                const parsed = parseTicketIdTokens(ticketIdValues);
                if (parsed.invalid) {
                    return res.status(400).json({ message: "Invalid ticket information." });
                }
                parsedTicketIds = parsed.ids;
            } catch (err) {
                return res.status(400).json({ message: "Invalid ticket information." });
            }
        }

        const normalizedPnr = typeof rawPnr === "string" ? rawPnr.trim() : "";

        if (!normalizedPnr && !parsedTicketIds.length) {
            return res.status(400).json({ message: "Open ticket information missing." });
        }

        const where = {
            status: "open",
            tripId: null,
        };

        if (normalizedPnr) {
            where.pnr = normalizedPnr;
        }

        if (parsedTicketIds.length) {
            where.id = { [Op.in]: parsedTicketIds };
        }

        const tickets = await req.models.Ticket.findAll({
            where,
            order: [["id", "ASC"]],
        });

        if (!tickets.length) {
            return res.status(404).json({ message: "Open ticket not found." });
        }

        let orderedTickets = tickets;
        if (parsedTicketIds.length) {
            const ticketMap = new Map(tickets.map(ticket => [String(ticket.id), ticket]));
            orderedTickets = parsedTicketIds
                .map(id => ticketMap.get(String(id)))
                .filter(Boolean);

            if (orderedTickets.length !== parsedTicketIds.length) {
                return res.status(404).json({ message: "Some selected open tickets could not be found." });
            }
        }

        const context = await buildOpenTicketMoveContext(req.models, orderedTickets);

        res.render("mixins/moveTicket", { trip: context.trip, tickets: context.tickets });
    } catch (error) {
        console.error("Attach open ticket query error:", error);
        res.status(500).json({ message: "Could not retrieve open ticket information." });
    }
};

exports.getRouteStopsListMoving = async (req, res, next) => {
    try {
        const date = req.query.date
        const time = req.query.time
        const tripId = req.query.tripId
        var stopId = req.query.stopId

        if (!stopId) {
            const branch = await req.models.Branch.findOne({ where: { id: req.session.firmUser.branchId } })
            if (branch)
                stopId = branch.stopId
        }

        if (!tripId) {
            res.json({ arr: [] })
            return
        }

        const trip = await req.models.Trip.findOne({ where: { date, time, id: tripId } })
        const routeStops = await req.models.RouteStop.findAll({ where: { routeId: trip.routeId }, order: [["order", "ASC"]] })
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(routeStops.map(rs => rs.stopId))] } } })
        const currentRouteStop = routeStops.find(rs => rs.stopId == stopId)
        const routeStopOrder = currentRouteStop.order

        const restrictions = await req.models.RouteStopRestriction.findAll({ where: { tripId, fromRouteStopId: currentRouteStop.id } })
        const restrictionMap = new Map(restrictions.map(r => [r.toRouteStopId, r.isAllowed]))

        let newRouteStopsArray = []
        for (let i = 0; i < routeStops.length; i++) {
            const rs = routeStops[i];
            if (rs.order > routeStopOrder) {
                rs.setDataValue("stopStr", stops.find(s => s.id == rs.stopId)?.title || "");
                const allowed = restrictionMap.has(rs.id) ? restrictionMap.get(rs.id) : true
                rs.setDataValue("isRestricted", !allowed)
                newRouteStopsArray.push(rs)
            }
        }
        res.json({ arr: newRouteStopsArray, selected: stopId })
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).json({ message: "An error occurred during save." });
    }
}

exports.postMoveTickets = async (req, res, next) => {
    try {
        const pnr = req.body.pnr;
        const rawOldSeats = JSON.parse(req.body.oldSeats);
        const newSeats = JSON.parse(req.body.newSeats);
        const newTripId = req.body.newTrip;
        const fromId = req.body.fromId;
        const toId = req.body.toId;

        if (
            !Array.isArray(rawOldSeats) ||
            !Array.isArray(newSeats) ||
            rawOldSeats.length !== newSeats.length
        ) {
            return res.status(400).json({
                message: "Number of selected tickets does not match target seats.",
            });
        }

        const newTrip = await req.models.Trip.findOne({ where: { id: newTripId } });
        if (!newTrip)
            return res.status(404).json({ message: "Target trip not found." });

        const tickets = await req.models.Ticket.findAll({
            where: { pnr, seatNo: { [Op.in]: rawOldSeats } },
        });

        if (!tickets.length)
            return res
                .status(404)
                .json({ message: "Tickets to move not found." });

        const route =
            newTrip?.routeId
                ? await req.models.Route.findByPk(newTrip.routeId, { raw: true })
                : null;

        const newSeatNumbers = Array.isArray(newSeats) ? newSeats : [];

        if (route) {
            const excludeIds = tickets.map((t) => t.id);
            const singleSeatCheck = await checkSingleSeatLimit(
                req.models,
                newTrip,
                route,
                newSeatNumbers,
                excludeIds
            );
            if (singleSeatCheck.exceeded) {
                return res.status(400).json({
                    message: `Single seat limit (${singleSeatCheck.limit}) exceeded. Please select different seats.`,
                });
            }
        }

        const oldTripIds = [...new Set(tickets.map((t) => t.tripId))];

        for (let i = 0; i < tickets.length; i++) {
            const t = tickets[i];

            if (t.uetdsRefNo && t.tripId) {
                try {
                    await yolcuIptalUetdsYolcuRefNoIle(req, { uetdsRefNo: t.tripUetdsRefNo }, t.uetdsRefNo, "Ticket moved");
                    console.log(`🧾 [UETDS] Old passenger removed: Ticket #${t.id}`);
                } catch (e) {
                    console.error(`❌ [UETDS] Old passenger removal error (#${t.id}):`, e.message);
                }
            }

            t.uetdsRefNo = null;

            t.tripId = newTrip.id;
            t.seatNo = newSeats[i];
            t.fromRouteStopId = fromId;
            t.toRouteStopId = toId;
            t.optionDate = newTrip.date;
            t.optionTime = `${newTrip.date} ${newTrip.time}`;
            if (t.status === "open") t.status = "completed";

            await t.save();

            const group = await seferGrupListesi(req, newTrip);

            if (newTrip.uetdsRefNo && group) {
                try {
                    const result = await yolcuEkle(req, newTrip, group.grupId, t);
                    if (result?.uetdsYolcuRefNo) {
                        t.uetdsRefNo = result.uetdsYolcuRefNo;
                        await t.save();
                        console.log(`✅ [UETDS] Passenger added to new trip: Ticket #${t.id}`);
                    }
                } catch (e) {
                    console.error(`❌ [UETDS] New passenger add error (#${t.id}):`, e.message);
                }
            }
        }

        try {
            for (const oldTripId of oldTripIds) {
                const oldTrip = await req.models.Trip.findByPk(oldTripId);
                if (oldTrip?.uetdsRefNo) {
                    const group = await seferGrupListesi(req, oldTrip);
                    if (group) {
                        const toplamUcret = await req.models.Ticket.sum("price", {
                            where: { tripId: oldTrip.id, status: "completed" },
                        });
                        await seferGrupGuncelle(req, oldTrip, group.grupId, {
                            grupUcret: toplamUcret || 0,
                        });
                        console.log(`💰 [UETDS] Old trip group price updated (${oldTrip.id})`);
                    }
                }
            }

            if (newTrip.uetdsRefNo) {
                const group = await seferGrupListesi(req, newTrip);
                if (group) {
                    const toplamUcret = await req.models.Ticket.sum("price", {
                        where: { tripId: newTrip.id, status: "completed" },
                    });
                    await seferGrupGuncelle(req, newTrip, group.grupId, {
                        grupUcret: toplamUcret || 0,
                    });
                    console.log(`💰 [UETDS] New trip group price updated (${newTrip.id})`);
                }
            }
        } catch (e) {
            console.error("⚠️ [UETDS] Group price update error:", e.message);
        }

        res.status(200).json({ message: "Ticket move operation completed successfully." });
    } catch (err) {
        console.error("Save error:", err);
        res.status(500).json({
            message: "An error occurred during save.",
            detail: err.message,
        });
    }
};

exports.postAttachOpenTicket = async (req, res, next) => {
    try {
        const { pnr: rawPnr, newSeat: rawNewSeat, tripId, stopId: rawStopId, toId: rawToId } = req.body;

        if (!tripId) {
            return res.status(400).json({ message: "Target trip information missing." });
        }

        const normalizedPnr = typeof rawPnr === "string" ? rawPnr.trim() : "";
        if (!normalizedPnr) {
            return res.status(400).json({ message: "PNR missing or invalid." });
        }

        const seatValue = rawNewSeat !== undefined && rawNewSeat !== null ? String(rawNewSeat).trim() : "";
        if (!seatValue) {
            return res.status(400).json({ message: "Seat information missing." });
        }

        const fromStopId = Number(String(rawStopId || "").trim());
        if (!Number.isFinite(fromStopId)) {
            return res.status(400).json({ message: "Invalid departure stop information." });
        }

        let toStopId = null;
        if (rawToId) {
            const parsedTo = Number(String(rawToId).trim());
            if (!Number.isFinite(parsedTo)) {
                return res.status(400).json({ message: "Invalid arrival stop information." });
            }
            toStopId = parsedTo;
        }

        const trip = await req.models.Trip.findOne({ where: { id: tripId } });
        if (!trip) {
            return res.status(404).json({ message: "Target trip not found." });
        }

        const ticket = await req.models.Ticket.findOne({
            where: { pnr: normalizedPnr, status: "open", tripId: null },
        });
        if (!ticket) {
            return res.status(404).json({ message: "Open ticket to attach not found." });
        }

        const route = trip?.routeId ? await req.models.Route.findByPk(trip.routeId, { raw: true }) : null;
        if (route) {
            const singleSeatCheck = await checkSingleSeatLimit(req.models, trip, route, [seatValue]);
            if (singleSeatCheck.exceeded) {
                return res.status(400).json({
                    message: `Single seat limit (${singleSeatCheck.limit}) exceeded. Please select different seats.`,
                });
            }
        }

        let effectiveTime = trip.time;
        if (trip.routeId) {
            const routeStops = await req.models.RouteStop.findAll({
                where: { routeId: trip.routeId },
                order: [["order", "ASC"]],
            });

            const currentRouteStop = routeStops.find(rs => String(rs.stopId) === String(fromStopId)) || null;
            if (toStopId !== null) {
                const targetRouteStop = routeStops.find(rs => String(rs.stopId) === String(toStopId));
                if (!targetRouteStop) {
                    return res.status(400).json({ message: "Please select a valid arrival stop." });
                }
                if (currentRouteStop && targetRouteStop.order <= currentRouteStop.order) {
                    return res.status(400).json({ message: "Arrival stop must be after departure stop." });
                }
            }

            if (currentRouteStop) {
                const offsets = await req.models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true });
                const offsetMap = buildOffsetMap(offsets);
                const stopTimes = computeRouteStopTimes(trip, routeStops, offsetMap);
                const matchedStopTime = stopTimes.find(st => st.order === currentRouteStop.order);
                if (matchedStopTime) {
                    effectiveTime = matchedStopTime.time;
                }
            }
        }

        ticket.seatNo = seatValue;
        ticket.tripId = trip.id;
        ticket.fromRouteStopId = fromStopId;
        if (toStopId !== null) ticket.toRouteStopId = toStopId;
        ticket.optionDate = trip.date;
        ticket.optionTime = `${trip.date} ${effectiveTime}`;
        ticket.status = "completed";

        await ticket.save();

        return res.status(200).json({ message: "Open ticket successfully attached to trip." });
    } catch (error) {
        console.error("Attach open ticket error:", error);
        res.status(500).json({ message: "An error occurred while attaching ticket." });
    }
};

exports.getSearchTable = async (req, res, next) => {
    try {
        const filters = {
            ...(req.query.name?.trim() && { name: req.query.name.trim() }),
            ...(req.query.surname?.trim() && { surname: req.query.surname.trim() }),
            ...(req.query.idnum?.trim() && { idNumber: req.query.idnum.trim() }),
            ...(req.query.phone?.trim() && { phoneNumber: req.query.phone.trim() }),
            ...(req.query.pnr?.trim() && { pnr: req.query.pnr.trim() }),
            ...(req.query.status?.trim() && { status: req.query.status.trim() }),
        };

        const where = Object.keys(filters).length ? filters : undefined;

        const tickets = await req.models.Ticket.findAll({
            ...(where && { where }),
            order: [["seatNo", "ASC"]],
        });

        if (!tickets.length) {
            return res.render("mixins/searchPassengersTable", {
                activeTickets: [],
                canceledTickets: []
            });
        }

        const tripIds = [...new Set(tickets.map((t) => t.tripId).filter(Boolean))];
        const stopMap = new Map();
        const tripMap = new Map();

        let stopIds = new Set();

        if (tripIds.length) {
            const trips = await req.models.Trip.findAll({
                where: { id: { [Op.in]: tripIds } },
            });

            trips.forEach(tr => tripMap.set(String(tr.id), { date: tr.date, time: tr.time }));

            const routeIds = [...new Set(trips.map((tr) => tr.routeId).filter(Boolean))];

            if (routeIds.length) {
                const routeStops = await req.models.RouteStop.findAll({
                    where: { routeId: { [Op.in]: routeIds } },
                    order: [["order", "ASC"]],
                });

                routeStops.forEach(rs => stopIds.add(rs.stopId));
            }
        }

        for (const t of tickets) {
            if (t.fromRouteStopId) stopIds.add(t.fromRouteStopId);
            if (t.toRouteStopId) stopIds.add(t.toRouteStopId);
        }

        if (stopIds.size > 0) {
            const stops = await req.models.Stop.findAll({
                where: { id: { [Op.in]: [...stopIds] } },
            });
            stops.forEach(s => stopMap.set(String(s.id), s.title));
        }

        const newTicketArray = tickets.map((ticket) => {
            const t = ticket.toJSON ? ticket.toJSON() : ticket;
            const fromTitle = stopMap.get(String(t.fromRouteStopId)) || "-";
            const toTitle = stopMap.get(String(t.toRouteStopId)) || "-";
            const tripInfo = tripMap.get(String(t.tripId)) || {};
            const tripDate = tripInfo.date || t.optionDate || "";
            const tripTime = tripInfo.time || "";

            return {
                ...t,
                from: fromTitle,
                to: toTitle,
                gender: t.gender === "m" ? "MALE" : "FEMALE",
                rawTripDate: tripDate,
                rawTripTime: tripTime,
                date: tripDate
                    ? new Intl.DateTimeFormat("en-US", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                    }).format(new Date(tripDate))
                    : "",
                time: tripTime
                    ? new Intl.DateTimeFormat("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    }).format(new Date(`1970-01-01T${tripTime}`))
                    : "",
            };
        });

        const canceledStatuses = ["canceled", "refund"];
        const activeTickets = newTicketArray.filter(
            (t) => !canceledStatuses.includes(t.status)
        );
        const canceledTickets = newTicketArray.filter((t) =>
            canceledStatuses.includes(t.status)
        );

        return res.render("mixins/searchPassengersTable", {
            activeTickets,
            canceledTickets,
        });
    } catch (err) {
        return next(err);
    }
};

exports.getBusPlanPanel = async (req, res, next) => {
    let id = req.query.id
    let busModel = null

    if (id) {
        busModel = await req.models.BusModel.findOne({ where: { id: id, isDeleted: false } })

        if (busModel) {
            busModel.plan = JSON.parse(busModel.plan)
        }
    }


    res.render("mixins/busPlanPanel", { busModel: busModel })
}

exports.postSaveBusPlan = async (req, res, next) => {
    try {
        console.log("Incoming data:", req.body);

        const data = convertEmptyFieldsToNull(req.body);

        const {
            id,
            title,
            description,
            plan,
            planBinary,
            maxPassenger,
            rowCount,
            colCount
        } = data;

        const [busModel, created] = await req.models.BusModel.upsert(
            {
                id,
                title,
                description,
                plan,
                planBinary,
                maxPassenger,
                rowCount: rowCount ? parseInt(rowCount) : 0,
                colCount: colCount ? parseInt(colCount) : 5
            },
            { returning: true }
        );

        if (created) {
            return res.json({ message: "Added", busModel });
        } else {
            return res.json({ message: "Updated", busModel });
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postDeleteBusPlan = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid plan information." });
        }

        const activePlanCount = await req.models.BusModel.count({ where: { isDeleted: false } });
        if (activePlanCount <= 1) {
            return res.status(400).json({ message: "You cannot delete the only existing bus plan. Please add a new plan before deleting this one." });
        }

        const busModel = await req.models.BusModel.findOne({ where: { id, isDeleted: false } });
        if (!busModel) {
            return res.status(404).json({ message: "Bus plan not found." });
        }

        const replacementBusModel = await req.models.BusModel.findOne({
            where: {
                id: { [Op.ne]: id },
                isDeleted: false
            },
            order: [["id", "ASC"]]
        });

        if (!replacementBusModel) {
            return res.status(400).json({ message: "You cannot delete the only existing bus plan. Please add a new plan before deleting this one." });
        }

        await Promise.all([
            req.models.Trip.update({ busModelId: replacementBusModel.id }, { where: { busModelId: id } }),
            req.models.Bus.update({ busModelId: replacementBusModel.id }, { where: { busModelId: id } })
        ]);

        await busModel.update({ isDeleted: true });

        res.json({ message: "Deleted", replacementBusModelId: replacementBusModel.id });
    } catch (err) {
        console.error("Bus plan delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getBusesList = async (req, res, next) => {
    const [buses, busModels, transactions] = await Promise.all([
        req.models.Bus.findAll({ where: { isDeleted: false } }),
        req.models.BusModel.findAll({ where: { isDeleted: false } }),
        req.models.BusTransaction.findAll({ attributes: ["busId", "type", "amount"], raw: true })
    ]);

    const totalsByBusId = new Map();
    for (const tx of transactions) {
        const key = String(tx.busId);
        const amount = Number(tx.amount) || 0;
        if (!totalsByBusId.has(key)) {
            totalsByBusId.set(key, 0);
        }
        const current = totalsByBusId.get(key);
        totalsByBusId.set(key, current + (tx.type === "expense" ? -amount : amount));
    }

    const modelTitleById = new Map(busModels.map(model => [String(model.id), model.title]));

    const formatTotal = value => {
        const number = Number(value) || 0;
        return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    for (const bus of buses) {
        const busKey = String(bus.id);
        bus.busModelStr = modelTitleById.get(String(bus.busModelId)) || "";
        const total = totalsByBusId.get(busKey) || 0;
        bus.busAccountTotal = total;
        bus.busAccountTotalFormatted = formatTotal(total);
    }

    res.render("mixins/busesList", { buses })
}

exports.getPricesList = async (req, res, next) => {
    const prices = await req.models.Price.findAll({ include: [{ model: req.models.Stop, as: "fromStop", attributes: ["id", "title"] }, { model: req.models.Stop, as: "toStop", attributes: ["id", "title"] }] });
    const stops = await req.models.Stop.findAll({ where: { isDeleted: false } });

    const stopMap = {};
    for (const s of stops) {
        stopMap[s.id] = s.title;
    }

    const toDateInputValue = (value) => {
        if (!value) return "";
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toISOString().split("T")[0];
    };

    const toDisplayDate = (value) => {
        if (!value) return "";
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString("en-US");
    };

    const formatted = prices.map(p => {
        const obj = p.toJSON();
        const validFromInput = toDateInputValue(obj.validFrom);
        const validUntilInput = toDateInputValue(obj.validUntil);

        return {
            ...obj,
            fromTitle: p.fromStop?.title || stopMap[p.fromStopId] || p.fromStopId,
            toTitle: p.toStop?.title || stopMap[p.toStopId] || p.toStopId,
            seatLimit: obj.seatLimit ?? "",
            hourLimit: obj.hourLimit ?? "",
            validFrom: toDisplayDate(obj.validFrom),
            validUntil: toDisplayDate(obj.validUntil),
            validFromRaw: validFromInput,
            validUntilRaw: validUntilInput,
            isBidirectional: Boolean(obj.isBidirectional)
        };
    });

    res.render("mixins/pricesList", { prices: formatted, stops });
}

exports.postSavePrices = async (req, res, next) => {
    try {
        const { prices } = req.body;
        if (!Array.isArray(prices)) {
            return res.status(400).json({ message: "Invalid data." });
        }

        const toNullIfNotPositive = val => {
            const num = Number(val);
            return Number.isFinite(num) && num > 0 ? num : null;
        };

        const toBoolean = val => {
            if (typeof val === "boolean") return val;
            if (typeof val === "number") return val === 1;
            if (typeof val === "string") {
                const normalized = val.trim().toLowerCase();
                return normalized === "true" || normalized === "1" || normalized === "on";
            }
            return false;
        };

        for (const price of prices) {
            const {
                id,
                fromStopId,
                toStopId,
                isBidirectional,
                price1,
                price2,
                price3,
                webPrice,
                singleSeatPrice1,
                singleSeatPrice2,
                singleSeatPrice3,
                singleSeatWebPrice,
                seatLimit,
                hourLimit,
                validFrom,
                validUntil
            } = price;

            await req.models.Price.update(
                {
                    fromStopId,
                    toStopId,
                    isBidirectional: toBoolean(isBidirectional),
                    price1: toNullIfNotPositive(price1),
                    price2: toNullIfNotPositive(price2),
                    price3: toNullIfNotPositive(price3),
                    webPrice: toNullIfNotPositive(webPrice),
                    singleSeatPrice1: toNullIfNotPositive(singleSeatPrice1),
                    singleSeatPrice2: toNullIfNotPositive(singleSeatPrice2),
                    singleSeatPrice3: toNullIfNotPositive(singleSeatPrice3),
                    singleSeatWebPrice: toNullIfNotPositive(singleSeatWebPrice),
                    seatLimit: toNullIfNotPositive(seatLimit),
                    hourLimit: Number.isFinite(Number(hourLimit)) ? Number(hourLimit) : null,
                    validFrom,
                    validUntil
                },
                { where: { id } }
            );
        }

        res.json({ message: "Saved" });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
}

exports.postAddPrice = async (req, res, next) => {
    try {
        const {
            fromStopId,
            toStopId,
            isBidirectional,
            price1,
            price2,
            price3,
            webPrice,
            singleSeatPrice1,
            singleSeatPrice2,
            singleSeatPrice3,
            singleSeatWebPrice,
            seatLimit,
            hourLimit,
            validFrom,
            validUntil
        } = req.body;

        const toNullIfNotPositive = val => {
            const num = Number(val);
            return Number.isFinite(num) && num > 0 ? num : null;
        };

        const toBoolean = val => {
            if (typeof val === "boolean") return val;
            if (typeof val === "number") return val === 1;
            if (typeof val === "string") {
                const normalized = val.trim().toLowerCase();
                return normalized === "true" || normalized === "1" || normalized === "on";
            }
            return false;
        };

        await req.models.Price.create({
            fromStopId,
            toStopId,
            isBidirectional: toBoolean(isBidirectional),
            price1: toNullIfNotPositive(price1),
            price2: toNullIfNotPositive(price2),
            price3: toNullIfNotPositive(price3),
            webPrice: toNullIfNotPositive(webPrice),
            singleSeatPrice1: toNullIfNotPositive(singleSeatPrice1),
            singleSeatPrice2: toNullIfNotPositive(singleSeatPrice2),
            singleSeatPrice3: toNullIfNotPositive(singleSeatPrice3),
            singleSeatWebPrice: toNullIfNotPositive(singleSeatWebPrice),
            seatLimit: toNullIfNotPositive(seatLimit),
            hourLimit: Number.isFinite(Number(hourLimit)) ? Number(hourLimit) : null,
            validFrom: validFrom ? `${validFrom}T00:00` : null,
            validUntil: validUntil ? `${validUntil}T00:00` : null
        });

        res.json({ message: "Saved" });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
}

exports.postDeletePrice = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid price information." });
        }

        const deleted = await req.models.Price.destroy({ where: { id } });
        if (!deleted) {
            return res.status(404).json({ message: "Price not found." });
        }

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Price delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getBus = async (req, res, next) => {
    const id = req.query.id
    const licensePlate = req.query.licensePlate

    const bus = await req.models.Bus.findOne({ where: { id: id, licensePlate: licensePlate, isDeleted: false } })

    res.json(bus)
}

exports.postSaveBus = async (req, res, next) => {
    try {
        console.log("Incoming data:", req.body);

        const data = convertEmptyFieldsToNull(req.body);

        const {
            id,
            licensePlate,
            busModelId,
            captainId,
            phoneNumber,
            owner,
            customCommissionRate,
            hasPowerOutlet,
            hasCatering,
            hasUsbPort,
            hasSeatScreen,
            hasComfortableSeat,
            hasFridge,
            hasWifi,
            hasSeatPillow
        } = data;

        const parseBoolean = value => {
            if (typeof value === "string") {
                const lowered = value.toLowerCase();
                return lowered === "true" || lowered === "1" || lowered === "on";
            }
            return Boolean(value);
        };

        const parseCommissionRate = value => {
            if (value === undefined || value === null || value === "") {
                return null;
            }

            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const [bus, created] = await req.models.Bus.upsert(
            {
                id,
                licensePlate,
                busModelId,
                captainId,
                phoneNumber,
                owner,
                customCommissionRate: parseCommissionRate(customCommissionRate),
                hasPowerOutlet: parseBoolean(hasPowerOutlet),
                hasCatering: parseBoolean(hasCatering),
                hasUsbPort: parseBoolean(hasUsbPort),
                hasSeatScreen: parseBoolean(hasSeatScreen),
                hasComfortableSeat: parseBoolean(hasComfortableSeat),
                hasFridge: parseBoolean(hasFridge),
                hasWifi: parseBoolean(hasWifi),
                hasSeatPillow: parseBoolean(hasSeatPillow)
            },
            { returning: true }
        );

        if (created) {
            return res.json({ message: "Added", bus });
        } else {
            return res.json({ message: "Updated", bus });
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postDeleteBus = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid bus information." });
        }

        const bus = await req.models.Bus.findByPk(id);
        if (!bus || bus.isDeleted) {
            return res.status(404).json({ message: "Bus not found." });
        }

        await req.db.transaction(async transaction => {
            await req.models.Bus.update(
                { isDeleted: true },
                { where: { id }, transaction }
            );

            await req.models.Trip.update(
                { busId: null },
                { where: { busId: id }, transaction }
            );
        });

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Bus delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getBusModelsData = async (req, res, next) => {
    try {
        const busModels = await req.models.BusModel.findAll({ where: { isDeleted: false } });
        res.json(busModels);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getBusesData = async (req, res, next) => {
    try {
        const buses = await req.models.Bus.findAll({ where: { isDeleted: false } });
        const staffs = await req.models.Staff.findAll();

        const staffMap = {};
        for (const s of staffs) {
            staffMap[s.id] = s;
        }

        const result = buses.map(b => ({
            ...b.toJSON(),
            staff: staffMap[b.staffId] || null
        }));

        res.json(result);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postTripBus = async (req, res, next) => {
    try {
        const { tripId, busId } = req.body;

        const bus = await req.models.Bus.findOne({ where: { id: busId } });
        if (!bus) return res.status(404).json({ message: "Bus not found." });

        await req.models.Trip.update(
            { busId: bus.id, busModelId: bus.busModelId, captainId: bus.captainId },
            { where: { id: tripId } }
        );

        const trip = await req.models.Trip.findByPk(tripId);
        const captain = await req.models.Staff.findOne({ where: { id: bus.captainId } });

        if (trip && trip.uetdsRefNo) {
            const result = await seferPlakaDegistir(req, trip.id, bus.licensePlate);
            console.log("📡 [UETDS] Plate change result:", result);
        } else {
            console.log("⚠️ Trip has no UETDS ref number, plate change skipped.");
        }

        res.json({
            message: "Bus updated and notified to UETDS.",
            busModelId: bus.busModelId,
            captain,
        });
    } catch (err) {
        console.error("postTripBus error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postTripBusPlan = async (req, res, next) => {
    try {
        const { tripId, busModelId } = req.body;

        await req.models.Trip.update({
            busModelId: busModelId,
            busId: null,
            captainId: null
        }, { where: { id: tripId } });

        res.json({ message: "Updated" });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postTripStaff = async (req, res, next) => {
    try {
        const { tripId, captainId, driver2Id, driver3Id, assistantId, hostessId } = req.body;

        const trip = await req.models.Trip.findByPk(tripId, { raw: true });
        if (!trip) return res.status(404).json({ message: "Trip not found." });

        const oldIds = [
            trip.captainId,
            trip.driver2Id,
            trip.driver3Id,
            trip.assistantId,
            trip.hostessId,
        ]
            .filter((id) => id !== null && id !== undefined)
            .map((id) => Number(id));

        const newIds = [
            captainId,
            driver2Id,
            driver3Id,
            assistantId,
            hostessId,
        ]
            .filter((id) => id !== null && id !== undefined && id !== "")
            .map((id) => Number(id));

        await req.models.Trip.update(
            {
                captainId: captainId || null,
                driver2Id: driver2Id || null,
                driver3Id: driver3Id || null,
                assistantId: assistantId || null,
                hostessId: hostessId || null,
            },
            { where: { id: tripId } }
        );

        console.log("🟢 Old staff:", oldIds);
        console.log("🔵 New staff:", newIds);

        const tripAfter = await req.models.Trip.findByPk(tripId);
        if (!tripAfter || !tripAfter.uetdsRefNo) {
            return res.json({
                message: "Updated (No UETDS reference, SOAP skipped)",
                diff: { toRemove: [], toAdd: [] },
            });
        }

        const toRemove = oldIds.filter((id) => !newIds.includes(id));
        const toAdd = newIds.filter((id) => !oldIds.includes(id));

        console.log("🟥 To remove:", toRemove);
        console.log("🟩 To add:", toAdd);

        const results = { removed: [], added: [] };

        if (toRemove.length) {
            const removedStaff = await req.models.Staff.findAll({
                where: { id: toRemove },
                raw: true,
            });

            for (const s of removedStaff) {
                try {
                    const r = await personelIptal(req, tripId, s, "Staff removed");
                    results.removed.push({
                        id: s.id,
                        idNumber: s.idNumber,
                        sonuc: r?.sonucKodu,
                        mesaj: r?.sonucMesaji,
                    });
                } catch (err) {
                    results.removed.push({
                        id: s.id,
                        idNumber: s.idNumber,
                        error: err.message,
                    });
                }
            }
        }

        if (toAdd.length) {
            const addedStaff = await req.models.Staff.findAll({
                where: { id: toAdd },
                raw: true,
            });

            for (const s of addedStaff) {
                try {
                    const r = await personelEkle(req, tripId, s);
                    results.added.push({
                        id: s.id,
                        idNumber: s.idNumber,
                        sonuc: r?.sonucKodu,
                    });
                } catch (err) {
                    results.added.push({
                        id: s.id,
                        idNumber: s.idNumber,
                        error: err.message,
                    });
                }
            }
        }

        return res.json({
            message: "Staff updated and synced with UETDS.",
            diff: { toRemove, toAdd },
            results,
        });
    } catch (err) {
        console.error("❌ postTripStaff error:", err);
        res.status(500).json({ message: err.message || "Staff update error." });
    }
};

exports.postTripActive = async (req, res, next) => {
    try {
        const { tripId, isActive } = req.body;
        const active = isActive === true || isActive === "true";

        const trip = await req.models.Trip.findByPk(tripId);
        if (!trip) return res.status(404).json({ message: "Trip not found." });

        await req.models.Trip.update({ isActive: active }, { where: { id: tripId } });

        if (trip.uetdsRefNo) {
            if (!active) {
                const result = await seferIptal(req, trip.id, "Trip disabled (canceled).");
                console.log("📡 [UETDS] Trip cancel result:", result);
            } else {
                const result = await seferAktif(req, trip.id);
                console.log("📡 [UETDS] Trip activate result:", result);
            }
        } else {
            console.log("⚠️ Trip has no UETDS ref number, update skipped.");
        }

        res.json({
            success: true,
            message: active ? "Trip activated." : "Trip canceled.",
        });
    } catch (err) {
        console.error("postTripActive error:", err);
        res.status(500).json({ message: err.message || "Trip status could not be updated." });
    }
};

exports.getStaffsList = async (req, res, next) => {
    const staff = await req.models.Staff.findAll({ where: { isDeleted: false } });
    const dutyMap = { driver: 'Driver', assistant: 'Assistant', hostess: 'Hostess' };
    staff.forEach(s => { s.dutyStr = dutyMap[s.duty] || s.duty; });

    if (req.query.onlyData) {
        res.json(staff);
    }
    else {
        res.render("mixins/staffList", { staff });
    }
};

exports.getStaff = async (req, res, next) => {
    const { id } = req.query;
    const stf = await req.models.Staff.findOne({ where: { id } });
    res.json(stf);
};

exports.postSaveStaff = async (req, res, next) => {
    try {
        const data = convertEmptyFieldsToNull(req.body);
        const { id, idNumber, duty, name, surname, address, phoneNumber, gender, nationality } = data;

        const [staff, created] = await req.models.Staff.upsert(
            { id, idNumber, duty, name, surname, address, phoneNumber, gender, nationality },
            { returning: true }
        );

        if (created) {
            return res.json({ message: "Added", staff });
        } else {
            return res.json({ message: "Updated", staff });
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postDeleteStaff = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid staff information." });
        }

        const staff = await req.models.Staff.findByPk(id);
        if (!staff || staff.isDeleted) {
            return res.status(404).json({ message: "Staff not found." });
        }

        await req.db.transaction(async transaction => {
            await req.models.Staff.update(
                { isDeleted: true },
                { where: { id }, transaction }
            );

            if (staff.duty === 'driver') {
                await Promise.all([
                    req.models.Trip.update({ captainId: null }, { where: { captainId: id }, transaction }),
                    req.models.Trip.update({ driver2Id: null }, { where: { driver2Id: id }, transaction }),
                    req.models.Trip.update({ driver3Id: null }, { where: { driver3Id: id }, transaction }),
                    req.models.Bus.update({ captainId: null }, { where: { captainId: id }, transaction })
                ]);
            } else if (staff.duty === 'assistant') {
                await req.models.Trip.update({ assistantId: null }, { where: { assistantId: id }, transaction });
            } else if (staff.duty === 'hostess') {
                await req.models.Trip.update({ hostessId: null }, { where: { hostessId: id }, transaction });
            }
        });
        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Staff delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getStopsList = async (req, res, next) => {
    const stops = await req.models.Stop.findAll({ where: { isDeleted: false } });
    const places = await req.commonModels.Place.findAll()

    for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        s.placeTitle = await places.find(p => p.id == s.placeId).title;
    }

    if (req.query.onlyData) {
        res.json(stops);
    }
    else {
        res.render("mixins/stopsList", { stops });
    }
};

exports.getStop = async (req, res, next) => {
    const { id } = req.query;
    const stop = await req.models.Stop.findOne({ where: { id } });
    if (!stop) {
        return res.status(404).json({ message: "Stop not found." });
    }

    res.json(stop);
};

exports.getStopsData = async (req, res, next) => {
    try {
        const stops = await req.models.Stop.findAll({ where: { isDeleted: false } });
        res.json(stops);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getPlacesData = async (req, res, next) => {
    try {
        const places = await req.commonModels.Place.findAll();
        res.json(places);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getUetdsPlacesData = async (req, res, next) => {
    try {
        const places = await req.commonModels.UetdsPlace.findAll({
            order: [
                ["provinceName", "ASC"],
                ["districtName", "ASC"],
            ],
        });
        res.json(places);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

function parsePositiveInteger(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

exports.postSaveStop = async (req, res, next) => {
    try {
        const data = convertEmptyFieldsToNull(req.body);
        const {
            id,
            title,
            webTitle,
            placeId,
            uetdsProvinceCode,
            uetdsDistrictCode,
            isServiceArea,
            isActive,
        } = data;

        const provinceCodeNumber = parsePositiveInteger(uetdsProvinceCode);
        const districtCodeNumber = parsePositiveInteger(uetdsDistrictCode);
        const placeIdNumber = parsePositiveInteger(placeId);
        const stopId = parsePositiveInteger(id);

        if (!title) {
            return res.status(400).json({ message: "Stop name is required." });
        }

        if (!placeIdNumber) {
            return res.status(400).json({ message: "Please select a valid place." });
        }

        if (!provinceCodeNumber || !districtCodeNumber) {
            return res.status(400).json({ message: "Please select a valid UETDS code." });
        }

        const uetdsPlace = await req.commonModels.UetdsPlace.findOne({
            where: {
                uetdsProvinceCode: provinceCodeNumber,
                uetdsDistrictCode: districtCodeNumber,
            },
        });

        if (!uetdsPlace) {
            return res.status(400).json({ message: "Selected UETDS code not found." });
        }

        const payload = {
            title,
            webTitle: webTitle ? webTitle : title,
            placeId: placeIdNumber,
            uetdsProvinceId: uetdsPlace.uetdsProvinceCode,
            uetdsDistrictId: uetdsPlace.uetdsDistrictCode,
            isServiceArea: isServiceArea === 'true' || isServiceArea === true,
            isActive: isActive === 'true' || isActive === true,
        };

        if (stopId) {
            const existingStop = await req.models.Stop.findByPk(stopId);

            if (!existingStop) {
                return res.status(404).json({ message: "Stop not found." });
            }

            await existingStop.update(payload);

            return res.json({ message: "Updated", stop: existingStop });
        }

        const newStop = await req.models.Stop.create(payload);

        return res.json({ message: "Added", stop: newStop });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postDeleteStop = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid stop information." });
        }

        const sequelize = req.models.Stop.sequelize;
        await sequelize.transaction(async (transaction) => {
            const stop = await req.models.Stop.findByPk(id, { transaction });
            if (!stop) {
                throw new Error("Stop not found.");
            }

            if (stop.isDeleted) {
                return;
            }

            await stop.update({ isDeleted: true }, { transaction });

            const affectedRoutes = await req.models.Route.findAll({
                where: {
                    [Op.or]: [
                        { fromStopId: id },
                        { toStopId: id },
                    ],
                },
                attributes: ["id"],
                transaction,
            });

            const affectedRouteIds = affectedRoutes.map(route => route.id);

            if (affectedRouteIds.length > 0) {
                await req.models.Route.update(
                    { isDeleted: true },
                    { where: { id: { [Op.in]: affectedRouteIds } }, transaction }
                );

                await req.models.Trip.update(
                    { isDeleted: true },
                    { where: { routeId: { [Op.in]: affectedRouteIds } }, transaction }
                );
            }

            const affectedBranches = await req.models.Branch.findAll({
                where: { stopId: id },
                attributes: ["id"],
                transaction,
            });

            const affectedBranchIds = affectedBranches.map(branch => branch.id);

            if (affectedBranchIds.length > 0) {
                await req.models.Branch.update(
                    { isDeleted: true },
                    { where: { id: { [Op.in]: affectedBranchIds } }, transaction }
                );

                await req.models.FirmUser.update(
                    { isDeleted: true },
                    { where: { branchId: { [Op.in]: affectedBranchIds } }, transaction }
                );
            }
        });

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Stop delete error:", err);
        if (err.message === "Stop not found.") {
            return res.status(404).json({ message: err.message });
        }
        res.status(500).json({ message: err.message });
    }
};

exports.getRoutesData = async (req, res, next) => {
    try {
        const routes = await req.models.Route.findAll();
        res.json(routes);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getRoutesList = async (req, res, next) => {
    const routes = await req.models.Route.findAll()
    const stopIds = routes.flatMap(route => [route.fromStopId, route.toStopId]);
    const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } } });

    for (let i = 0; i < routes.length; i++) {
        const r = routes[i];
        r.fromTitle = stops.find(p => p.id == r.fromStopId).title;
        r.toTitle = stops.find(p => p.id == r.toStopId).title;
    }

    res.render("mixins/routesList", { routes })
}

exports.getRoute = async (req, res, next) => {
    const id = req.query.id
    const title = req.query.title

    const route = await req.models.Route.findOne({ where: { id: id, title: title } })

    res.json(route)
}

exports.getRouteStop = async (req, res, next) => {
    try {
        const { stopId, duration, isFirst } = req.query

        let routeStop = {};

        routeStop.isFirst = isFirst
        routeStop.duration = duration
        routeStop.stopId = stopId
        const stop = await req.models.Stop.findOne({ where: { id: stopId } })
        routeStop.stop = stop.title

        res.render("mixins/routeStop", { routeStop })
    }
    catch (err) {
        console.log(err)
    }
}

exports.getRouteStopsList = async (req, res, next) => {
    const { id } = req.query

    const routeStops = await req.models.RouteStop.findAll({ where: { routeId: id }, order: [["order", "ASC"]], include: [{ model: req.models.Stop, as: "stop", attributes: ["id", "title"] }] });
    for (let i = 0; i < routeStops.length; i++) {
        const routeStop = routeStops[i];
        routeStop.isFirst = routeStop.order == 0
        routeStop.stop = routeStop.stop?.title || ""
    }

    res.render("mixins/routeStopsList", { routeStops })
}

exports.postSaveRoute = async (req, res, next) => {
    try {
        const trimmedRouteCode = typeof req.body.routeCode === "string" ? req.body.routeCode.trim() : "";
        const trimmedRouteTitle = typeof req.body.routeTitle === "string" ? req.body.routeTitle.trim() : "";
        const trimmedRouteDescription = typeof req.body.routeDescription === "string" ? req.body.routeDescription.trim() : "";

        const data = convertEmptyFieldsToNull({
            ...req.body,
            routeCode: trimmedRouteCode,
            routeTitle: trimmedRouteTitle,
            routeDescription: trimmedRouteDescription,
        });

        if (!trimmedRouteCode || !trimmedRouteTitle || !trimmedRouteDescription) {
            return res.status(400).json({ message: "Route code, title, and description are required." });
        }

        const {
            id,
            routeCode,
            routeDescription,
            routeTitle,
            routeStopsSTR,
            reservationOptionTime,
            refundTransferOptionTime,
            maxReservationCount,
            maxSingleSeatCount,
        } = data;

        let parsedRouteStops = [];
        if (routeStopsSTR) {
            try {
                parsedRouteStops = JSON.parse(routeStopsSTR);
            } catch (error) {
                return res.status(400).json({ message: "Could not parse route stops data." });
            }
        }

        if (!Array.isArray(parsedRouteStops) || parsedRouteStops.length === 0) {
            return res.status(400).json({ message: "You must add at least one stop for the route." });
        }

        let sanitizedRouteStops;
        try {
            sanitizedRouteStops = parsedRouteStops.map((rs, index) => {
                const stopId = Number(rs?.stopId);
                if (!stopId || Number.isNaN(stopId)) {
                    throw new Error("Stop information missing or invalid.");
                }

                const rawDuration = typeof rs?.duration === "string" ? rs.duration.trim() : "";
                const normalizedDuration = normalizeTimeInput(rawDuration || "00:00") || "00:00:00";

                return {
                    stopId,
                    order: index,
                    duration: normalizedDuration,
                };
            });
        } catch (error) {
            return res.status(400).json({ message: error.message || "Stop information missing or invalid." });
        }

        const firstStopId = sanitizedRouteStops[0]?.stopId;
        const lastStopId = sanitizedRouteStops[sanitizedRouteStops.length - 1]?.stopId;

        if (!firstStopId || !lastStopId) {
            return res.status(400).json({ message: "Stop information missing." });
        }

        const numericId = id !== undefined && id !== null && id !== "" ? Number(id) : undefined;
        if (numericId !== undefined && Number.isNaN(numericId)) {
            return res.status(400).json({ message: "Invalid route ID." });
        }

        const transaction = await req.models.Route.sequelize.transaction();

        try {
            const [route, created] = await req.models.Route.upsert(
                {
                    id: numericId,
                    routeCode,
                    description: routeDescription,
                    title: routeTitle,
                    fromStopId: firstStopId,
                    toStopId: lastStopId,
                    reservationOptionTime: normalizeTimeInput(reservationOptionTime),
                    refundTransferOptionTime: normalizeTimeInput(refundTransferOptionTime),
                    maxReservationCount: toIntegerOrNull(maxReservationCount),
                    maxSingleSeatCount: toIntegerOrNull(maxSingleSeatCount),
                },
                { returning: true, transaction }
            );

            await req.models.RouteStop.destroy({ where: { routeId: route.id }, transaction });

            const routeStopRecords = sanitizedRouteStops.map(rs => ({
                routeId: route.id,
                stopId: rs.stopId,
                order: rs.order,
                duration: rs.duration,
            }));

            await req.models.RouteStop.bulkCreate(routeStopRecords, { transaction });

            await transaction.commit();

            return res.json({ message: created ? "Added" : "Updated", route });
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
}

exports.postDeleteRoute = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid route information." });
        }

        const route = await req.models.Route.findByPk(id);
        if (!route) {
            return res.status(404).json({ message: "Route not found." });
        }

        await req.models.RouteStop.destroy({ where: { routeId: id } });
        await route.destroy();

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Route delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getTripsList = async (req, res, next) => {
    try {
        const date = req.query.date;
        const trips = await req.models.Trip.findAll({
            where: { date },
            include: [
                { model: req.models.Route, as: "route", attributes: ["id", "routeCode", "title"] },
                { model: req.models.Bus, as: "bus", attributes: ["id", "licensePlate"] }
            ],
            order: [["time", "ASC"]]
        });

        const enriched = trips.map(t => ({
            ...t.get({ plain: true }),
            routeCode: t.route?.routeCode || "",
            routeTitle: t.route?.title || "",
            licensePlate: t.bus?.licensePlate || ""
        }));

        return res.render("mixins/tripsList", { trips: enriched });
    } catch (err) {
        console.error("getTripsList include error:", err);
        return res.status(500).json({ message: "An error occurred while retrieving the trip list." });
    }
}

exports.postSaveTrip = async (req, res, next) => {
    try {
        const { routeId, firstDate, lastDate, departureTime, busModelId, busId } =
            convertEmptyFieldsToNull(req.body);

        const route = await req.models.Route.findOne({ where: { id: routeId } });
        if (!route) return res.status(404).json({ error: "Route not found." });

        const routeStops = await req.models.RouteStop.findAll({
            where: { routeId: route.id },
            order: [["order", "ASC"]],
        });

        const stops = await req.models.Stop.findAll({
            where: { id: { [Op.in]: [...new Set(routeStops.map((rs) => rs.stopId))] } },
        });

        const bus = await req.models.Bus.findOne({ where: { id: busId } });
        const captainId = bus?.captainId ?? null;

        const start = new Date(firstDate);
        const end = new Date(lastDate);
        const diffDays =
            Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        const fromStop = stops.find((s) => s.id == route.fromStopId);
        const toStop = stops.find((s) => s.id == route.toStopId);
        if (!fromStop || !toStop)
            return res.status(400).json({ error: "Location information not found." });

        let trips = [];
        for (let i = 0; i < diffDays; i++) {
            const tripDate = new Date(start);
            tripDate.setDate(start.getDate() + i);

            trips.push({
                routeId,
                busModelId,
                busId,
                captainId,
                date: tripDate.toISOString().split("T")[0],
                time: departureTime,
                fromPlaceString: fromStop.title,
                toPlaceString: toStop.title,
            });
        }

        const createdTrips = await req.models.Trip.bulkCreate(trips, { returning: true });

        res.status(201).json({ message: `${createdTrips.length} trips added.` });

        for (const trip of createdTrips) {
            try {
                const result = await seferEkle(req, trip.id);
                console.log(`✅ UETDS notification successful → Trip #${trip.id}`);

                const fullTrip = await req.models.Trip.findByPk(trip.id, {
                    include: [{ model: req.models.Route, as: "route" }],
                });

                const groupResult = await seferGrupEkle(req, fullTrip);
                console.log(
                    `📦 UETDS group created (Trip #${trip.id}) → Group Ref: ${groupResult?.uetdsGrupRefNo || "Not specified"}`
                );

            } catch (err) {
                console.error(`❌ Trip #${trip.id} UETDS notification error:`, err.message);
            }
        }
    } catch (err) {
        console.error("postSaveTrip error:", err);
        res.status(500).json({ error: "An error occurred.", detail: err.message });
    }
};

exports.getBranchesList = async (req, res, next) => {
    const where = { isDeleted: false, id: { [Op.notIn]: [1, 2] } };
    if (req.query.isJustActives) {
        where.isActive = true;
    }

    const branches = await req.models.Branch.findAll({ where: where })
    const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: [...new Set(branches.map(b => b.stopId))] } } })

    for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        b.placeStr = stops.find(s => s.id == b.stopId)?.title;
    }

    if (req.query.onlyData) {
        res.json(branches)
    }
    else {
        res.render("mixins/branchesList", { branches })
    }
}

exports.getBranch = async (req, res, next) => {
    const id = req.query.id
    const title = req.query.title

    const branch = await req.models.Branch.findOne({ where: { id: id, title: title } })

    res.json(branch)
}

exports.postSaveBranch = async (req, res, next) => {
    try {
        const data = convertEmptyFieldsToNull(req.body);

        const {
            id,
            isActive,
            isMainBranch,
            isPaysInternet,
            title,
            stop,
            mainBranch,
            ownerName,
            phoneNumber,
            address,
            tradeTitle,
            taxOffice,
            taxNumber,
            f1DocumentCode,
            ownStopSalesCommission,
            otherStopSalesCommission,
            internetTicketCommission,
            defaultDeduction1,
            defaultDeduction2,
            defaultDeduction3,
            defaultDeduction4,
            defaultDeduction5,
        } = data;

        const parseNullableNumber = value => {
            if (value === null || value === undefined || value === "") {
                return null;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const [branch, created] = await req.models.Branch.upsert(
            {
                id,
                title,
                stopId: parseNullableNumber(stop),
                isMainBranch,
                mainBranchId: isMainBranch ? null : parseNullableNumber(mainBranch),
                isPaysInternet,
                isActive,
                ownerName,
                phoneNumber,
                address,
                tradeTitle,
                taxOffice,
                taxNumber,
                f1DocumentCode,
                ownStopSalesCommission: parseNullableNumber(ownStopSalesCommission),
                otherStopSalesCommission: parseNullableNumber(otherStopSalesCommission),
                internetTicketCommission: parseNullableNumber(internetTicketCommission),
                defaultDeduction1: parseNullableNumber(defaultDeduction1),
                defaultDeduction2: parseNullableNumber(defaultDeduction2),
                defaultDeduction3: parseNullableNumber(defaultDeduction3),
                defaultDeduction4: parseNullableNumber(defaultDeduction4),
                defaultDeduction5: parseNullableNumber(defaultDeduction5),
            },
            { returning: true }
        );

        if (created) {
            return res.json({ message: "Added", branch });
        } else {
            return res.json({ message: "Updated", branch });
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postDeleteBranch = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid branch information." });
        }

        const branch = await req.models.Branch.findOne({ where: { id, isDeleted: false }, attributes: ["id"] });
        if (!branch) {
            return res.status(404).json({ message: "Branch not found." });
        }

        await req.db.transaction(async transaction => {
            await req.models.Branch.update(
                { isDeleted: true },
                { where: { id }, transaction }
            );

            await req.models.FirmUser.update(
                { isDeleted: true },
                { where: { branchId: id }, transaction }
            );
        });

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Branch delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getUsersList = async (req, res, next) => {
    const users = await req.models.FirmUser.findAll({ where: { isDeleted: false, id: { [Op.notIn]: [1, 2, 3] } } })
    const branches = await req.models.Branch.findAll({ where: { isDeleted: false, id: { [Op.notIn]: [1, 2] } } })

    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        u.branchStr = branches.find(b => b.id == u.branchId)?.title;
    }

    if (req.query.onlyData) {
        res.json(users)
    }
    else {
        res.render("mixins/usersList", { users })
    }
}

exports.getCustomersList = async (req, res, next) => {
    const { idNumber, name, surname, phone, blacklist } = req.query;
    const where = {};

    if (idNumber) where.idNumber = Number(idNumber);
    if (name) where.name = { [Op.like]: `%${name.toLocaleUpperCase("tr-TR")}%` };
    if (surname) where.surname = { [Op.like]: `%${surname.toLocaleUpperCase("tr-TR")}%` };
    if (phone) where.phoneNumber = { [Op.like]: `%${phone}%` };
    if (blacklist == 'true') where.isBlackList = true;
    else if (blacklist == 'false') where.isBlackList = false;

    const customers = await req.models.Customer.findAll({ where });
    res.render("mixins/customersList", { customers, blacklist });
}

exports.getCustomer = async (req, res, next) => {
    const { idNumber } = req.query;
    const where = {}

    if (idNumber) where.idNumber = Number(idNumber);

    const customer = await req.models.Customer.findOne({ where });
    res.json(customer);
}

exports.getMembersList = async (req, res, next) => {
    const { idNumber = "", name = "", surname = "", phone = "" } = req.query;

    const where = { customerCategory: 'member' };

    if (idNumber) {
        where.idNumber = { [Op.like]: `%${idNumber}%` };
    }
    if (name) {
        where.name = { [Op.like]: `%${name.toLocaleUpperCase("tr-TR")}%` };
    }
    if (surname) {
        where.surname = { [Op.like]: `%${surname.toLocaleUpperCase("tr-TR")}%` };
    }
    if (phone) {
        where.phoneNumber = { [Op.like]: `%${phone}%` };
    }

    const members = await req.models.Customer.findAll({ where });
    res.render("mixins/membersList", { members });
}

exports.postAddMember = async (req, res, next) => {
    try {
        const { idNumber, name, surname, phone } = req.body;
        const idNum = Number(idNumber);

        let customer = await req.models.Customer.findOne({ where: { idNumber: idNum } });

        if (customer) {
            customer.name = name.toLocaleUpperCase("tr-TR");
            customer.surname = surname.toLocaleUpperCase("tr-TR");
            customer.phoneNumber = phone;
            customer.customerCategory = 'member';
            await customer.save();
        } else {
            customer = await req.models.Customer.create({
                idNumber: idNum,
                name: name.toLocaleUpperCase("tr-TR"),
                surname: surname.toLocaleUpperCase("tr-TR"),
                phoneNumber: phone,
                gender: 'm',
                nationality: 'TR',
                customerType: 'adult',
                customerCategory: 'member'
            });
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error("Member add error:", err);
        res.status(500).json({ success: false });
    }
}

exports.postUpdateCustomer = async (req, res, next) => {
    try {
        const {
            id,
            idNumber,
            name,
            surname,
            phone,
            gender,
            customerType,
            customerCategory,
            email,
            password,
            pointOrPercent,
            pointAmount,
            percent
        } = req.body;

        const customerId = Number(id);
        if (!customerId) {
            return res.status(400).json({ success: false, message: "Invalid customer information." });
        }

        const customer = await req.models.Customer.findByPk(customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found." });
        }

        if (idNumber !== undefined) {
            const parsedIdNumber = Number(idNumber);
            if (!Number.isNaN(parsedIdNumber) && parsedIdNumber > 0) {
                customer.idNumber = parsedIdNumber;
            }
        }

        const upper = (value) => {
            if (typeof value !== "string") {
                return null;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            try {
                return trimmed.toLocaleUpperCase("tr-TR");
            } catch (err) {
                return trimmed.toUpperCase();
            }
        };

        const trimmed = (value) => (typeof value === "string" ? value.trim() : null);

        const upperName = upper(name);
        if (upperName) {
            customer.name = upperName;
        }

        const upperSurname = upper(surname);
        if (upperSurname) {
            customer.surname = upperSurname;
        }

        const trimmedPhone = trimmed(phone);
        if (trimmedPhone) {
            customer.phoneNumber = trimmedPhone;
        }

        if (typeof gender === "string") {
            const loweredGender = gender.trim().toLowerCase();
            if (["m", "male"].includes(loweredGender)) {
                customer.gender = "m";
            } else if (["f", "female"].includes(loweredGender)) {
                customer.gender = "f";
            }
        }

        if (typeof customerType === "string") {
            const loweredType = customerType.trim().toLowerCase();
            const allowedTypes = ["adult", "child", "student", "disabled", "retired"];
            if (allowedTypes.includes(loweredType)) {
                customer.customerType = loweredType;
            }
        }

        if (typeof customerCategory === "string") {
            const loweredCategory = customerCategory.trim().toLowerCase();
            const allowedCategories = ["normal", "member"];
            if (allowedCategories.includes(loweredCategory)) {
                customer.customerCategory = loweredCategory;
            }
        }

        if (password !== undefined) {
            customer.password = await bcrypt.hash(password, 12)
        }

        if (email !== undefined) {
            customer.email = email
        }

        if (pointOrPercent !== undefined) {
            if (typeof pointOrPercent === "string") {
                const lowered = pointOrPercent.trim().toLowerCase();
                if (!lowered) {
                    customer.pointOrPercent = null;
                } else if (["point", "percent"].includes(lowered)) {
                    customer.pointOrPercent = lowered;
                }
            } else if (pointOrPercent === null) {
                customer.pointOrPercent = null;
            }
        }

        if (pointAmount !== undefined) {
            const parsedPointAmount = Number(pointAmount);
            customer.point_amount = Number.isNaN(parsedPointAmount) ? 0 : parsedPointAmount;
        }

        if (percent !== undefined) {
            const parsedPercent = Number(percent);
            customer.percent = Number.isNaN(parsedPercent) ? 0 : parsedPercent;
        }

        await customer.save();

        res.json({ success: true, customer: customer.toJSON() });
    } catch (err) {
        console.error("Customer update error:", err);
        res.status(500).json({ success: false });
    }
};

exports.getMemberTickets = async (req, res, next) => {
    try {
        const { idNumber } = req.query;
        if (!idNumber) {
            return res.render("mixins/memberTickets", { tickets: [] });
        }
        const customer = await req.models.Customer.findOne({ where: { idNumber } });
        if (!customer) {
            return res.render("mixins/memberTickets", { tickets: [] });
        }

        const tickets = await req.models.Ticket.findAll({
            where: { customerId: customer.id },
            order: [["createdAt", "DESC"]],
            raw: true
        });

        const stopIds = [];
        tickets.forEach(t => {
            if (t.fromRouteStopId) stopIds.push(t.fromRouteStopId);
            if (t.toRouteStopId) stopIds.push(t.toRouteStopId);
        });
        const uniqueStopIds = [...new Set(stopIds)];
        const stops = await req.models.Stop.findAll({ where: { id: { [Op.in]: uniqueStopIds } }, raw: true });
        const stopMap = {};
        stops.forEach(s => stopMap[s.id] = s.title);

        const tripIds = tickets
            .map(t => t.tripId)
            .filter(id => id !== undefined && id !== null);
        const uniqueTripIds = [...new Set(tripIds)];
        let tripMap = {};
        if (uniqueTripIds.length) {
            const trips = await req.models.Trip.findAll({
                where: { id: { [Op.in]: uniqueTripIds } },
                raw: true
            });
            tripMap = trips.reduce((acc, trip) => {
                acc[trip.id] = trip;
                return acc;
            }, {});
        }

        const formatCurrency = value => {
            if (value === null || value === undefined || value === "") {
                return "";
            }
            const number = Number(value);
            if (Number.isNaN(number)) {
                return "";
            }
            try {
                return new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "TRY",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(number);
            } catch (error) {
                return number.toFixed(2) + " ₺";
            }
        };

        const formatDate = value => {
            if (!value) {
                return "";
            }
            if (value instanceof Date && !Number.isNaN(value.getTime())) {
                return value.toLocaleDateString("en-US");
            }
            if (typeof value === "string") {
                const parsed = new Date(value);
                if (!Number.isNaN(parsed.getTime())) {
                    return parsed.toLocaleDateString("en-US");
                }
                const parts = value.split("-");
                if (parts.length === 3) {
                    return `${parts[1]}/${parts[2]}/${parts[0]}`;
                }
            }
            return "";
        };

        const formatTime = value => {
            if (!value) {
                return "";
            }
            if (value instanceof Date && !Number.isNaN(value.getTime())) {
                return value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            }
            if (typeof value === "string") {
                const parts = value.split(":");
                if (parts.length >= 2) {
                    const [hour, minute] = parts;
                    return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
                }
            }
            return "";
        };

        const formatDateTime = value => {
            if (!value) {
                return "";
            }
            const date = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(date.getTime())) {
                return "";
            }
            return date.toLocaleString("en-US", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            });
        };

        const ticketData = tickets.map(t => {
            const trip = t.tripId ? tripMap[t.tripId] : null;
            const tripDate = trip?.date || "";
            const tripTime = trip?.time || "";

            return {
                pnr: t.pnr,
                from: stopMap[t.fromRouteStopId] || trip?.fromPlaceString || "",
                to: stopMap[t.toRouteStopId] || trip?.toPlaceString || "",
                price: t.price,
                priceDisplay: formatCurrency(t.price),
                seatNo: t.seatNo,
                tripId: trip?.id || null,
                tripDate,
                tripTime,
                tripDateDisplay: formatDate(tripDate),
                tripTimeDisplay: formatTime(tripTime),
                purchaseDateDisplay: formatDateTime(t.createdAt)
            };
        });

        res.render("mixins/memberTickets", { tickets: ticketData });
    } catch (err) {
        console.error("getMemberTickets error:", err);
        res.render("mixins/memberTickets", { tickets: [] });
    }
}

exports.postCustomerBlacklist = async (req, res, next) => {
    try {
        const { id, description, isRemove } = req.body;
        const customer = await req.models.Customer.findByPk(id);
        if (!customer) return res.status(404).json({ success: false });
        if (!isRemove) {
            customer.isBlackList = true;
            customer.blackListDescription = description;
        }
        else {
            customer.isBlackList = false;
            customer.blackListDescription = "";
        }
        await customer.save();
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("Customer blacklist error:", err);
        res.status(500).json({ success: false });
    }
};

exports.getUser = async (req, res, next) => {
    const id = req.query.id;
    const username = req.query.username;

    let user = null;
    if (id) {
        user = await req.models.FirmUser.findByPk(id);
    } else if (username) {
        user = await req.models.FirmUser.findOne({ where: { username } });
    }

    const permissions = await req.models.Permission.findAll({ attributes: ['id', 'description', 'module'] });
    const userPerms = id ? await req.models.FirmUserPermission.findAll({ where: { firmUserId: id } }) : [];

    const grouped = { register: [], trip: [], sales: [], account_cut: [], other: [] };
    permissions.forEach(p => {
        const allow = userPerms.some(up => up.permissionId === p.id && up.allow);
        const item = { id: p.id, description: p.description, allow };
        switch ((p.module || '').toLowerCase()) {
            case 'register':
                grouped.register.push(item);
                break;
            case 'trip':
                grouped.trip.push(item);
                break;
            case 'sales':
                grouped.sales.push(item);
                break;
            case 'account_cut':
                grouped.account_cut.push(item);
                break;
            case 'other':
                grouped.other.push(item);
                break;
        }
    });

    res.json({ ...(user ? user.dataValues : {}), permissions: grouped });
};

exports.getUsersByBranch = async (req, res, next) => {
    const branchId = req.query.id

    const users = await req.models.FirmUser.findAll({ where: { branchId: branchId } })

    res.json(users)
}

exports.postSaveUser = async (req, res, next) => {
    try {
        const data = convertEmptyFieldsToNull(req.body);
        const { id, isActive, name, username, password, phone, branchId } = data;
        const permissions = JSON.parse(data.permissions)

        let hashedPassword;

        if (password) {
            hashedPassword = await bcrypt.hash(password, 12);
        } else if (id) {
            const existingUser = await req.models.FirmUser.findByPk(id);
            hashedPassword = existingUser ? existingUser.password : null;
        } else {
            return res.status(400).json({ message: "Password is required for new users." });
        }

        const [user, created] = await req.models.FirmUser.upsert(
            {
                id,
                firmId: req.session.firmUser.firmId,
                isActive,
                branchId,
                username,
                phoneNumber: phone,
                name,
                password: hashedPassword
            },
            { returning: true }
        );

        const permIds = permissions ? (Array.isArray(permissions) ? permissions : [permissions]).map(Number) : [];

        const existingPerms = await req.models.FirmUserPermission.findAll({ where: { firmUserId: user.id } });
        const existingIds = existingPerms.map(p => p.permissionId);

        const permsToAdd = permIds.filter(id => !existingIds.includes(id));
        const permsToRemove = existingIds.filter(id => !permIds.includes(id));

        if (permsToRemove.length) {
            await req.models.FirmUserPermission.destroy({ where: { firmUserId: user.id, permissionId: permsToRemove } });
        }

        if (permsToAdd.length) {
            const rows = permsToAdd.map(p => ({ firmUserId: user.id, permissionId: p, allow: true }));
            await req.models.FirmUserPermission.bulkCreate(rows);
        }

        if (created) {
            const cashRegister = req.models.CashRegister.build({
                userId: user.id,
                cash_balance: 0.00,
                card_balance: 0.00,
                reset_date_time: new Date()
            })

            await cashRegister.save()

            await req.models.Transaction.create({
                userId: cashRegister.userId,
                type: "expense",
                category: "register_reset",
                amount: 0,
                description: `User created.`
            });
        }

        res.json({
            message: created ? "Added" : "Updated",
            user
        });

    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postDeleteUser = async (req, res, next) => {
    try {
        const id = Number(req.body.id);
        if (!id) {
            return res.status(400).json({ message: "Invalid user information." });
        }

        const user = await req.models.FirmUser.findByPk(id);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        await req.models.FirmUserPermission.destroy({ where: { firmUserId: id } });
        await req.models.CashRegister.destroy({ where: { userId: id } });
        await user.update({ isDeleted: true });

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("User delete error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getTransactions = async (req, res, next) => {
    try {
        const userId = req.query.userId || req.session.firmUser.id;
        const register = await req.models.CashRegister.findOne({ where: { userId } });
        if (!register) throw new Error("Register record not found.");

        const transactions = await req.models.Transaction.findAll({
            where: {
                userId,
                createdAt: { [Op.gte]: register.reset_date_time }
            },
            order: [["createdAt", "DESC"]]
        });

        if (transactions.length) {
            transactions[transactions.length - 1].amount = ""
        }

        await Promise.all(transactions.map(async (t) => {
            if (t.ticketId) {
                const ticket = await req.models.Ticket.findOne({ where: { id: t.ticketId } });
                if (ticket) {
                    t.pnr = ticket.pnr;
                    t.seatNumber = ticket.seatNo;
                }
            }
        }));

        res.render("mixins/transactionsList", { transactions });
    } catch (err) {
        console.error("Get transactions error:", err);
        res.status(500).send("An error occurred.");
    }
};

exports.getBusTransactions = async (req, res, next) => {
    try {
        const busId = req.query.busId;
        if (!busId) {
            return res.render("mixins/busTransactionsList", { transactions: [] });
        }

        const transactions = await req.models.BusTransaction.findAll({
            where: { busId },
            order: [["createdAt", "DESC"]],
            limit: 50
        });

        res.render("mixins/busTransactionsList", { transactions });
    } catch (err) {
        console.error("Get bus transactions error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getTransactionData = async (req, res, next) => {
    try {
        const userId = req.query.userId || req.session.firmUser.id;
        const register = await req.models.CashRegister.findOne({ where: { userId } });
        if (!register) throw new Error("Register record not found.");

        const transactions = await req.models.Transaction.findAll({
            where: {
                userId,
                createdAt: { [Op.gt]: new Date(register.reset_date_time) }
            }
        });

        let cashSales = 0;
        let cardSales = 0;
        let cashRefund = 0;
        let cardRefund = 0;
        let transferIn = 0;
        let transferOut = 0;
        let payedToBus = 0;
        let otherIn = 0;
        let otherOut = 0;

        for (const t of transactions) {
            const amount = Number(t.amount) || 0;
            switch (t.category) {
                case "cash_sale":
                    cashSales += amount;
                    break;
                case "card_sale":
                    cardSales += amount;
                    break;
                case "cash_refund":
                    cashRefund += amount;
                    break;
                case "card_refund":
                    cardRefund += amount;
                    break;
                case "payed_to_bus":
                    payedToBus += amount;
                    break;
                case "income":
                    otherIn += amount;
                    break;
                case "expense":
                    otherOut += amount;
                    break;
                case "transfer_in":
                    transferIn += amount;
                    break;
                case "transfer_out":
                    transferOut += amount;
                    break;
            }
        }

        res.json({
            cashSales,
            cardSales,
            cashRefund,
            cardRefund,
            transferIn,
            transferOut,
            payedToBus,
            otherIn,
            otherOut,
            card_balance: register.card_balance,
            cash_balance: register.cash_balance
        });

    } catch (err) {
        console.error("Transaction data error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getUserRegisterBalance = async (req, res, next) => {
    try {
        const userId = req.query.userId;
        if (!userId) return res.status(400).json({ message: "User information missing." });
        const register = await req.models.CashRegister.findOne({ where: { userId } });
        if (!register) return res.status(404).json({ message: "Register record not found." });
        const balance = (Number(register.cash_balance) || 0) + (Number(register.card_balance) || 0);
        res.json({ balance });
    } catch (err) {
        console.error("User register balance error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postAddTransaction = async (req, res, next) => {
    try {
        const type = req.body.transactionType;
        const amount = req.body.amount;
        const description = req.body.description;

        const transaction = req.models.Transaction.build({
            userId: req.session.firmUser.id,
            type: type,
            category: type,
            amount: amount,
            description: description,
        });

        await transaction.save();
        res.locals.newRecordId = transaction.id;

        const register = await req.models.CashRegister.findOne({ where: { userId: req.session.firmUser.id } });
        if (!register) {
            throw new Error("Register record not found.");
        }

        if (type === "income") {
            register.cash_balance = Number(register.cash_balance) + Number(amount);
        } else if (type === "expense") {
            register.cash_balance = Number(register.cash_balance) - Number(amount);
        }
        await register.save();

        res.status(200).json({ success: true, transactionId: transaction.id });
    } catch (err) {
        console.error("Cash transaction error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
}

exports.postAddBusTransaction = async (req, res, next) => {
    try {
        const { transactionType, busId, amount, description } = req.body;
        const allowedTypes = ["income", "expense"];

        if (!req.session?.firmUser?.id) {
            return res.status(401).json({ message: "Session not found." });
        }

        if (!allowedTypes.includes(transactionType)) {
            return res.status(400).json({ message: "Invalid transaction type." });
        }

        if (!busId) {
            return res.status(400).json({ message: "Bus information missing." });
        }

        const normalizedAmount = Number(amount);
        if (!amount || isNaN(normalizedAmount) || normalizedAmount <= 0) {
            return res.status(400).json({ message: "Please enter a valid amount." });
        }

        const bus = await req.models.Bus.findOne({ where: { id: busId } });
        if (!bus) {
            return res.status(404).json({ message: "Bus not found." });
        }

        const record = await req.models.BusTransaction.create({
            busId: bus.id,
            userId: req.session.firmUser.id,
            type: transactionType,
            amount: normalizedAmount,
            description: description ? description.trim() : null
        });

        res.status(200).json({ success: true, transactionId: record.id });
    } catch (err) {
        console.error("Bus transaction error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postResetRegister = async (req, res, next) => {
    try {
        const register = await req.models.CashRegister.findOne({ where: { userId: req.session.firmUser.id } });
        if (!register) return res.status(404).json({ message: "Register record not found." });

        const total = Number(register.cash_balance) + Number(register.card_balance);

        await req.models.Transaction.create({
            userId: req.session.firmUser.id,
            type: "expense",
            category: "register_reset",
            amount: total,
            description: "Register reset. Previous balance: " + total + "₺"
        });

        register.cash_balance = 0;
        register.card_balance = 0;
        register.reset_date_time = new Date();
        await register.save();

        res.json({ success: true });
    } catch (err) {
        console.error("Reset register error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.postTransferRegister = async (req, res, next) => {
    try {
        const targetUserId = Number(req.body.user);
        if (!targetUserId) return res.status(400).json({ message: "User information missing." });

        const senderId = req.session.firmUser.id;
        const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [senderId, targetUserId] } } });

        const sender = users.find(u => u.id == senderId);
        const receiver = users.find(u => u.id == targetUserId);

        const senderRegister = await req.models.CashRegister.findOne({ where: { userId: senderId } });

        const cashBalance = Number(senderRegister.cash_balance) || 0;
        const cardBalance = Number(senderRegister.card_balance) || 0;
        const total = cashBalance + cardBalance;

        await req.models.Payment.create({
            initiatorId: receiver.id,
            payerId: sender.id,
            receiverId: receiver.id,
            amount: total,
            card_amount: cardBalance,
            cash_amount: cashBalance,
            isWholeTransfer: true
        });
        console.log(senderRegister.cash_balance)

        res.json({ success: true });
    } catch (err) {
        console.error("Transfer register error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.postRequestPayment = async (req, res, next) => {
    try {
        const { userId, amount } = req.body;
        await req.models.Payment.create({
            initiatorId: userId,
            payerId: userId,
            receiverId: req.session.firmUser.id,
            amount,
            cash_amount: amount,
            isWholeTransfer: false
        });
        res.json({ success: true });
    } catch (err) {
        console.error("Request payment error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.postSendPayment = async (req, res, next) => {
    try {
        const { userId, amount } = req.body;
        await req.models.Payment.create({
            initiatorId: userId,
            payerId: req.session.firmUser.id,
            receiverId: userId,
            amount,
            cash_amount: amount,
            isWholeTransfer: false
        });
        res.json({ success: true });
    } catch (err) {
        console.error("Send payment error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getPendingPayments = async (req, res, next) => {
    try {
        const payments = await req.models.Payment.findAll({ where: { payerId: req.session.firmUser.id, status: "pending" } });
        const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [...new Set(payments.map(p => p.receiverId))] } } });
        if (!payments.length) {
            res.status(404);
        }
        const result = payments.map(p => ({
            id: p.id,
            amount: p.amount,
            userName: users.find(u => u.id == p.receiverId)?.name || "",
            canConfirm: p.initiatorId == req.session.firmUser.id,
            type: p.isWholeTransfer ? "Register Transfer" : "Manual Transaction"
        }));
        res.render("mixins/paymentsList", { payments: result });
    } catch (err) {
        console.error("Pending payments error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getPendingCollections = async (req, res, next) => {
    try {
        console.log(req.session.firmUser.id)
        const payments = await req.models.Payment.findAll({ where: { receiverId: req.session.firmUser.id, initiatorId: req.session.firmUser.id, status: "pending" } });
        if (!payments.length) {
            res.status(404);
        }
        const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [...new Set(payments.map(p => p.payerId))] } } });
        const result = payments.map(p => ({
            id: p.id,
            amount: p.amount,
            userName: users.find(u => u.id == p.payerId)?.name || "",
            canConfirm: p.initiatorId == req.session.firmUser.id,
            type: p.isWholeTransfer ? "Register Transfer" : "Manual Transaction"
        }));
        res.render("mixins/paymentsList", { payments: result });
    } catch (err) {
        console.error("Pending collections error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postConfirmPayment = async (req, res, next) => {
    try {
        const { id, action } = req.body;
        const payment = await req.models.Payment.findOne({ where: { id } });
        const users = await req.models.FirmUser.findAll({ where: { id: { [Op.in]: [payment.payerId, payment.receiverId] } } })

        if (!payment) return res.status(404).json({ message: "Payment record not found." });
        if (payment.status !== "pending") return res.status(400).json({ message: "Payment already processed." });
        if (payment.initiatorId !== req.session.firmUser.id) return res.status(403).json({ message: "You are not authorized to confirm." });

        if (Number(payment.amount) === 0) {
            payment.status = action == "approve" ? "approved" : "rejected";
            await payment.save();
            return res.json({ success: true });
        }

        payment.status = action == "approve" ? "approved" : "rejected";
        await payment.save();

        if (action == "approve") {
            await req.models.Transaction.create({
                userId: users.find(u => u.id == payment.receiverId).id,
                type: "income",
                category: "transfer_in",
                amount: Number(payment.amount),
                description: payment.isWholeTransfer ?
                    `Register transferred from user ${users.find(u => u.id == payment.payerId).name}.` : `Payment received from user ${users.find(u => u.id == payment.payerId).name}.`,
            })

            await req.models.Transaction.create({
                userId: users.find(u => u.id == payment.payerId).id,
                type: "expense",
                category: "transfer_out",
                amount: Number(payment.amount),
                description: payment.isWholeTransfer ?
                    `Register transferred to user ${users.find(u => u.id == payment.receiverId).name}. Transfer: ${payment.amount}₺` :
                    `Payment made to user ${users.find(u => u.id == payment.receiverId).name}.`
            })

            await req.models.CashRegister.findOne({ where: { userId: payment.receiverId } }).then(async cr => {
                if (cr) {
                    cr.cash_balance = Number(cr.cash_balance) + Number(payment.cash_amount);
                    cr.card_balance = Number(cr.card_balance) + Number(payment.card_amount);
                    await cr.save();
                }
            })

            await req.models.CashRegister.findOne({ where: { userId: payment.payerId } }).then(async cr => {
                if (cr) {
                    cr.cash_balance = Number(cr.cash_balance) - Number(payment.cash_amount);
                    cr.card_balance = Number(cr.card_balance) - Number(payment.card_amount);
                    if (payment.isWholeTransfer)
                        cr.reset_date_time = new Date()
                    await cr.save();
                }
            })
        }
        res.json({ success: true });
    } catch (err) {
        console.error("Confirm payment error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.postSaveAnnouncement = async (req, res, next) => {
    try {
        const { message, branchId, showTicker, showPopup } = req.body;
        const announcement = await req.models.Announcement.create({
            message,
            branchId: branchId || null,
            showTicker: showTicker === true || showTicker === 'true',
            showPopup: showPopup === false ? false : true,
        });
        res.json({ message: "Added", announcement });
    } catch (err) {
        console.error("Save announcement error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getAnnouncements = async (req, res, next) => {
    try {
        const userId = req.session.firmUser.id;
        const branchId = req.session.firmUser.branchId;

        const announcements = await req.models.Announcement.findAll({
            where: {
                isActive: true,
                [Op.or]: [
                    { branchId: null },
                    { branchId: branchId }
                ]
            },
            order: [["createdAt", "DESC"]]
        });

        const seenRows = await req.models.AnnouncementUser.findAll({
            where: { userId },
            attributes: ["announcementId"]
        });
        const seenIds = seenRows.map(r => r.announcementId);

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const ticker = announcements.filter(a => {
            if (!a.showTicker) {
                return false;
            }

            const createdAt = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
            if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
                return false;
            }

            return createdAt >= twentyFourHoursAgo;
        });
        const popup = announcements.filter(a => a.showPopup && !seenIds.includes(a.id));

        res.json({ ticker, popup });
    } catch (err) {
        console.error("Get announcements error:", err);
        res.status(500).json({ message: err.message });
    }
};

exports.getDailyUserAccountReport = async (req, res, next) => {
    try {
        const { startDate, endDate, userId } = req.query;
        const targetUserId = userId || req.session.firmUser?.id;

        if (!targetUserId) {
            return res.status(400).json({ message: 'User information is missing.' });
        }

        const user = await req.models.FirmUser.findOne({ where: { id: targetUserId }, attributes: ['name', 'branchId'], raw: true });
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const branch = user.branchId
            ? await req.models.Branch.findOne({ where: { id: user.branchId }, attributes: ['title'], raw: true })
            : null;

        const register = await req.models.CashRegister.findOne({ where: { userId: targetUserId }, raw: true });

        const parseDate = (value) => {
            if (!value) return null;
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        const now = new Date();
        let start = parseDate(startDate) || parseDate("1970-01-01 00:00:00");
        let end = parseDate(endDate) || now;

        if (start > end) {
            const tmp = start;
            start = end;
            end = tmp;
        }

        const transactions = await req.models.Transaction.findAll({
            where: {
                userId: targetUserId,
                createdAt: { [Op.between]: [start, end] }
            },
            order: [["createdAt", "DESC"]],
            raw: true,
        });

        const ticketIds = transactions.map(t => t.ticketId).filter(Boolean);
        const tickets = ticketIds.length
            ? await req.models.Ticket.findAll({
                where: { id: { [Op.in]: ticketIds } },
                attributes: ['id', 'pnr', 'seatNo'],
                raw: true,
            })
            : [];
        const ticketMap = new Map(tickets.map(t => [t.id, t]));

        const categoryLabels = {
            cash_sale: 'Cash Sale',
            card_sale: 'Credit Card Sale',
            cash_refund: 'Cash Refund',
            card_refund: 'Credit Card Refund',
            payed_to_bus: 'Paid to Bus',
            income: 'Income',
            expense: 'Expense',
            transfer_in: 'Transfer In',
            transfer_out: 'Transfer Out',
            register_reset: 'Register Reset',
        };

        const summaryTotals = {
            ticketSalesCount: 0,
            ticketRefundCount: 0,
            cashSalesTotal: 0,
            cashRefundTotal: 0,
            cardSalesTotal: 0,
            cardRefundTotal: 0,
            payedToBusTotal: 0,
            otherIncomeTotal: 0,
            otherExpenseTotal: 0,
            transferInTotal: 0,
            transferOutTotal: 0,
            registerResetTotal: 0,
        };

        const formatDateTime = (value) => {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return new Intl.DateTimeFormat('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'Europe/Istanbul', // Keeping timezone relevant to location context
            }).format(date);
        };

        const rows = transactions.map(t => {
            const amount = Number(t.amount) || 0;
            switch (t.category) {
                case 'cash_sale':
                    summaryTotals.ticketSalesCount += 1;
                    summaryTotals.cashSalesTotal += amount;
                    break;
                case 'card_sale':
                    summaryTotals.ticketSalesCount += 1;
                    summaryTotals.cardSalesTotal += amount;
                    break;
                case 'cash_refund':
                    summaryTotals.ticketRefundCount += 1;
                    summaryTotals.cashRefundTotal += amount;
                    break;
                case 'card_refund':
                    summaryTotals.ticketRefundCount += 1;
                    summaryTotals.cardRefundTotal += amount;
                    break;
                case 'payed_to_bus':
                    summaryTotals.payedToBusTotal += amount;
                    break;
                case 'income':
                    summaryTotals.otherIncomeTotal += amount;
                    break;
                case 'expense':
                    summaryTotals.otherExpenseTotal += amount;
                    break;
                case 'transfer_in':
                    summaryTotals.transferInTotal += amount;
                    break;
                case 'transfer_out':
                    summaryTotals.transferOutTotal += amount;
                    break;
                case 'register_reset':
                    summaryTotals.registerResetTotal += amount;
                    break;
                default:
                    break;
            }

            const ticket = t.ticketId ? ticketMap.get(t.ticketId) : null;
            const documentParts = [];
            if (ticket?.seatNo) documentParts.push(`Seat: ${ticket.seatNo}`);
            if (ticket?.pnr) documentParts.push(`PNR: ${ticket.pnr}`);

            return {
                date: formatDateTime(t.createdAt),
                type: categoryLabels[t.category] || t.category,
                description: t.description || '',
                document: documentParts.join(' '),
                amount: t.type === 'income' ? formatDailyCurrency(amount) : "-" + formatDailyCurrency(amount),
                incomeOrExpense: t.type === 'income' ? "Income" : 'Expense',
            };
        });

        const totalSales = summaryTotals.cashSalesTotal + summaryTotals.cardSalesTotal;
        const totalRefunds = summaryTotals.cashRefundTotal + summaryTotals.cardRefundTotal;
        const netTransfer = summaryTotals.transferInTotal - summaryTotals.transferOutTotal;
        const netCash = (summaryTotals.cashSalesTotal - summaryTotals.cashRefundTotal)
            + summaryTotals.otherIncomeTotal
            + summaryTotals.transferInTotal
            - summaryTotals.transferOutTotal
            - summaryTotals.payedToBusTotal
            - summaryTotals.otherExpenseTotal
            - summaryTotals.registerResetTotal;
        const netCard = summaryTotals.cardSalesTotal - summaryTotals.cardRefundTotal;
        const netTotal = netCash + netCard;

        const summaryItems = [
            { label: 'Total Sales Count', value: String(summaryTotals.ticketSalesCount) },
            { label: 'Total Refund Count', value: String(summaryTotals.ticketRefundCount) },
            { label: 'Cash Sales Total', value: formatDailyCurrency(summaryTotals.cashSalesTotal) },
            { label: 'Cash Refund Total', value: formatDailyCurrency(summaryTotals.cashRefundTotal) },
            { label: 'Credit Card Sales Total', value: formatDailyCurrency(summaryTotals.cardSalesTotal) },
            { label: 'Credit Card Refund Total', value: formatDailyCurrency(summaryTotals.cardRefundTotal) },
            { label: 'Total Sales Amount', value: formatDailyCurrency(totalSales) },
            { label: 'Total Refund Amount', value: formatDailyCurrency(totalRefunds) },
            { label: 'Other Income', value: formatDailyCurrency(summaryTotals.otherIncomeTotal) },
            { label: 'Other Expenses', value: formatDailyCurrency(summaryTotals.otherExpenseTotal) },
            { label: 'Paid to Bus', value: formatDailyCurrency(summaryTotals.payedToBusTotal) },
            { label: 'Transfer In', value: formatDailyCurrency(summaryTotals.transferInTotal) },
            { label: 'Transfer Out', value: formatDailyCurrency(summaryTotals.transferOutTotal) },
            { label: 'Net Transfer', value: formatDailyCurrency(netTransfer) },
        ];

        if (summaryTotals.registerResetTotal) {
            summaryItems.push({ label: 'Register Reset', value: formatDailyCurrency(summaryTotals.registerResetTotal) });
        }

        const netSummary = [
            { label: 'Cash', value: formatDailyCurrency(netCash) },
            { label: 'Credit Card', value: formatDailyCurrency(netCard) },
            { label: 'Total', value: formatDailyCurrency(netTotal) },
        ];

        const formatRange = (date) => formatDateTime(date)?.replace(',', '');

        const queryInfo = {
            user: user.name,
            branch: branch?.title || '',
            startDate: formatRange(start),
            endDate: formatRange(end),
            generatedAt: formatRange(now),
        };

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="daily_user_account_report.pdf"');
        await generateDailyUserAccountReport({ rows, summaryItems, netSummary, query: queryInfo }, res);
    } catch (err) {
        console.error('getDailyUserAccountReport error:', err);
        res.status(500).json({ message: 'Daily user account report could not be generated.' });
    }
};

exports.getSalesRefundsReport = async (req, res, next) => {
    try {
        const { startDate, endDate, type, branchId, userId, fromStopId, toStopId } = req.query;
        const start = startDate ? new Date(startDate) : new Date('1970-01-01');
        const end = endDate ? new Date(endDate) : new Date();

        const branchRecord = branchId
            ? await req.models.Branch.findOne({ where: { id: branchId }, attributes: ['title'], raw: true })
            : null;
        const userRecord = userId
            ? await req.models.FirmUser.findOne({ where: { id: userId }, attributes: ['name'], raw: true })
            : null;
        const fromStopRecord = fromStopId
            ? await req.models.Stop.findOne({ where: { id: fromStopId }, attributes: ['title'], raw: true })
            : null;
        const toStopRecord = toStopId
            ? await req.models.Stop.findOne({ where: { id: toStopId }, attributes: ['title'], raw: true })
            : null;

        const query = {
            type,
            startDate,
            endDate,
            branch: branchRecord?.title || "All",
            user: userRecord?.name || "All",
            from: fromStopRecord?.title || "All",
            to: toStopRecord?.title || "All",
        };

        console.log(start)
        console.log(end)
        const where = {
            createdAt: { [Op.between]: [start, end] },
            status: { [Op.in]: ['completed', 'web', 'gotur', 'refund'] }
        };

        if (userId) where.userId = userId;
        if (fromStopId) where.fromRouteStopId = fromStopId;
        if (toStopId) where.toRouteStopId = toStopId;

        let tickets = await req.models.Ticket.findAll({
            where,
            order: [['createdAt', 'ASC']]
        });

        if (branchId) {
            const branchUsers = await req.models.FirmUser.findAll({ where: { branchId }, attributes: ['id'], raw: true });
            const branchUserIds = branchUsers.map(u => u.id);
            tickets = tickets.filter(t => branchUserIds.includes(t.userId));
        }

        const userIds = [...new Set(tickets.map(t => t.userId).filter(Boolean))];
        const stopIds = [...new Set(tickets.flatMap(t => [t.fromRouteStopId, t.toRouteStopId]).filter(Boolean))];

        const users = await req.models.FirmUser.findAll({
            where: { id: { [Op.in]: userIds } },
            attributes: ['id', 'name', 'branchId']
        });

        const branchIds = [...new Set(users.map(u => u.branchId).filter(Boolean))];

        const [stops, branches] = await Promise.all([
            req.models.Stop.findAll({ where: { id: { [Op.in]: stopIds } }, attributes: ['id', 'title'] }),
            req.models.Branch.findAll({ where: { id: { [Op.in]: branchIds } }, attributes: ['id', 'title'] })
        ]);

        const rows = tickets.map(t => {
            const user = users.find(u => u.id === t.userId);
            return {
                user: user?.name || '',
                branch: branches.find(b => b.id === user?.branchId)?.title || '',
                time: t.createdAt,
                from: stops.find(s => s.id === t.fromRouteStopId)?.title || '',
                to: stops.find(s => s.id === t.toRouteStopId)?.title || '',
                payment: t.payment,
                status: t.status,
                seat: t.seatNo,
                gender: t.gender === 'f' ? 'F' : 'M',
                pnr: t.pnr,
                price: t.price
            };
        });

        if ((type || '').toLowerCase() === 'detailed') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="sales_refunds_detailed.pdf"');
            await generateSalesRefundReportDetailed(rows, query, res);
        } else {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="sales_refunds_summary.pdf"');
            await generateSalesRefundReportSummary(rows, query, res);
        }
    } catch (err) {
        console.error('getSalesRefundsReport error:', err);
        res.status(500).json({ message: 'Could not generate sales and refunds report.' });
    }
};

exports.getWebTicketsReport = async (req, res, next) => {
    try {
        const { startDate, endDate, type, branchId, userId, fromStopId, toStopId, groupBy } = req.query;

        const start = startDate ? new Date(startDate) : new Date('1970-01-01');
        const end = endDate ? new Date(endDate) : new Date();

        let branchTitle = 'All';
        if (branchId) {
            const branch = await req.models.Branch.findOne({ where: { id: branchId }, attributes: ['title'], raw: true });
            if (branch?.title) branchTitle = branch.title;
        }

        let userName = 'All';
        if (userId) {
            const user = await req.models.FirmUser.findOne({ where: { id: userId }, attributes: ['name'], raw: true });
            if (user?.name) userName = user.name;
        }

        let fromStopTitle = 'All';
        if (fromStopId) {
            const fromStop = await req.models.Stop.findOne({ where: { id: fromStopId }, attributes: ['title'], raw: true });
            if (fromStop?.title) fromStopTitle = fromStop.title;
        }

        let toStopTitle = 'All';
        if (toStopId) {
            const toStop = await req.models.Stop.findOne({ where: { id: toStopId }, attributes: ['title'], raw: true });
            if (toStop?.title) toStopTitle = toStop.title;
        }

        const queryInfo = {
            type,
            startDate,
            endDate,
            branch: branchTitle,
            user: userName,
            from: fromStopTitle,
            to: toStopTitle,
        };
        const normalizedGroup = (groupBy || '').toString().toLowerCase();
        const isStopRequested = normalizedGroup === 'stop';
        const effectiveGroup = isStopRequested ? 'stop' : 'bus';
        queryInfo.group = effectiveGroup === 'stop' ? 'Stop' : 'Bus';

        const where = {
            status: 'web',
            createdAt: { [Op.between]: [start, end] },
        };

        if (userId) where.userId = userId;
        if (fromStopId) where.fromRouteStopId = fromStopId;
        if (toStopId) where.toRouteStopId = toStopId;

        let tickets = await req.models.Ticket.findAll({
            where,
            raw: true,
        });

        if (branchId) {
            const branchUsers = await req.models.FirmUser.findAll({ where: { branchId }, attributes: ['id'], raw: true });
            const branchUserIds = branchUsers.map(u => u.id);
            tickets = tickets.filter(t => branchUserIds.includes(t.userId));
        }

        const normalizedType = (type || '').toLowerCase();
        const isDetailed = normalizedType === 'detailed';
        const summaryFileName = effectiveGroup === 'stop'
            ? 'web_tickets_by_stop_summary.pdf'
            : 'web_tickets_by_bus_summary.pdf';
        const detailedFileName = effectiveGroup === 'stop'
            ? 'web_tickets_by_stop_detailed.pdf'
            : 'web_tickets_by_bus_detailed.pdf';

        if (!tickets.length) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${isDetailed ? detailedFileName : summaryFileName}"`);
            if (isDetailed) {
                if (effectiveGroup === 'stop') {
                    await generateWebTicketsReportByStopDetailed([], queryInfo, res);
                } else {
                    await generateWebTicketsReportByBusDetailed([], queryInfo, res);
                }
            } else if (effectiveGroup === 'stop') {
                await generateWebTicketsReportByStopSummary([], queryInfo, res);
            } else {
                await generateWebTicketsReportByBusSummary([], queryInfo, res);
            }
            return;
        }

        const tripIds = [...new Set(tickets.map(t => t.tripId).filter(Boolean))];
        const trips = tripIds.length ? await req.models.Trip.findAll({
            where: { id: { [Op.in]: tripIds } },
            attributes: ['id', 'busId', 'routeId', 'date', 'time'],
            raw: true,
        }) : [];

        const busIds = [...new Set(trips.map(t => t.busId).filter(Boolean))];
        const routeIds = [...new Set(trips.map(t => t.routeId).filter(Boolean))];

        const [buses, routes] = await Promise.all([
            busIds.length ? req.models.Bus.findAll({ where: { id: { [Op.in]: busIds } }, attributes: ['id', 'licensePlate'], raw: true }) : [],
            routeIds.length ? req.models.Route.findAll({ where: { id: { [Op.in]: routeIds } }, attributes: ['id', 'title'], raw: true }) : [],
        ]);

        const routeStops = routeIds.length ? await req.models.RouteStop.findAll({
            where: { routeId: { [Op.in]: routeIds } },
            attributes: ['id', 'routeId', 'stopId', 'duration', 'order'],
            raw: true,
        }) : [];

        const stopIdsForRouteStops = routeStops.map(rs => rs.stopId).filter(Boolean);
        const directStopIds = tickets.map(t => t.fromRouteStopId).filter(Boolean);
        const combinedStopIds = [...new Set([...stopIdsForRouteStops, ...directStopIds])];
        const stopsForRouteStops = combinedStopIds.length ? await req.models.Stop.findAll({
            where: { id: { [Op.in]: combinedStopIds } },
            attributes: ['id', 'title'],
            raw: true,
        }) : [];

        const toKey = value => (value === undefined || value === null ? '' : String(value));

        const busMap = new Map(buses.map(b => [b.id, b.licensePlate]));
        const tripMap = new Map(trips.map(t => [t.id, t]));
        const routeMap = new Map(routes.map(r => [r.id, r.title]));
        const routeStopMap = new Map(routeStops.map(rs => [toKey(rs.id), rs]));
        const stopMap = new Map(stopsForRouteStops.map(s => [toKey(s.id), s.title]));

        const routeStopsByRoute = new Map();
        routeStops.forEach(rs => {
            const routeKey = toKey(rs.routeId);
            if (!routeStopsByRoute.has(routeKey)) {
                routeStopsByRoute.set(routeKey, []);
            }
            routeStopsByRoute.get(routeKey).push(rs);
        });

        routeStopsByRoute.forEach(list => {
            list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        });

        const parseDurationToMs = duration => {
            if (!duration) return 0;
            const [rawH = 0, rawM = 0, rawS = 0] = duration.split(':').map(Number);
            const hours = Number.isFinite(rawH) ? rawH : 0;
            const minutes = Number.isFinite(rawM) ? rawM : 0;
            const seconds = Number.isFinite(rawS) ? rawS : 0;
            return ((hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0)) * 1000;
        };

        const cumulativeDurationByRouteStopId = new Map();
        routeStopsByRoute.forEach(list => {
            let acc = 0;
            list.forEach(rs => {
                acc += parseDurationToMs(rs.duration);
                cumulativeDurationByRouteStopId.set(toKey(rs.id), acc);
            });
        });

        const routeStopByRouteAndStop = new Map();
        routeStops.forEach(rs => {
            const key = `${toKey(rs.routeId)}|${toKey(rs.stopId)}`;
            if (!routeStopByRouteAndStop.has(key)) {
                routeStopByRouteAndStop.set(key, rs);
            }
        });

        const combineDateAndTime = (dateStr, timeStr) => {
            if (!dateStr) return null;
            const [year, month, day] = dateStr.split('-').map(Number);
            if (!year || !month || !day) return null;
            const [hour = 0, minute = 0, second = 0] = (timeStr || '00:00:00').split(':').map(Number);
            return new Date(year, month - 1, day, hour || 0, minute || 0, second || 0);
        };
        const busSummaryRows = [];
        const stopSummaryRows = [];
        const detailedGroups = new Map();

        tickets.forEach(ticket => {
            const trip = ticket.tripId ? tripMap.get(ticket.tripId) : undefined;
            const busId = trip?.busId;
            const busKey = busId ?? 'unknown';
            const licensePlate = busMap.get(busId) || '-';
            const priceValue = Number(ticket.price) || 0;

            busSummaryRows.push({
                price: priceValue,
                busId: busKey,
                licensePlate,
            });

            const routeStopKey = toKey(ticket.fromRouteStopId);
            const routeStop = routeStopMap.get(routeStopKey)
                || (trip ? routeStopByRouteAndStop.get(`${toKey(trip.routeId)}|${routeStopKey}`) : undefined);
            const resolvedStopId = routeStop?.stopId ?? ticket.fromStopId ?? ticket.fromRouteStopId ?? null;
            const stopTitleFromRoute = routeStop ? (stopMap.get(toKey(routeStop.stopId)) || '') : '';
            const stopTitleFromDirect = resolvedStopId ? (stopMap.get(toKey(resolvedStopId)) || '') : '';
            const stopTitle = stopTitleFromRoute || stopTitleFromDirect || routeStopKey || '';
            const stopUniqueKey = resolvedStopId != null
                ? toKey(resolvedStopId)
                : (routeStopKey || (stopTitle || 'unknown'));

            stopSummaryRows.push({
                price: priceValue,
                salesTotal: priceValue,
                ticketCount: 1,
                stopId: resolvedStopId,
                routeStopId: routeStop?.id ?? ticket.fromRouteStopId ?? null,
                fromRouteStopId: ticket.fromRouteStopId,
                stopKey: resolvedStopId ?? ticket.fromRouteStopId ?? null,
                stopTitle,
            });
            const baseDate = combineDateAndTime(trip?.date, trip?.time);
            let departureDate = baseDate;
            if (routeStop && baseDate) {
                const cumulativeMs = cumulativeDurationByRouteStopId.get(toKey(routeStop.id));
                if (typeof cumulativeMs === 'number') {
                    departureDate = new Date(baseDate.getTime() + cumulativeMs);
                }
            }
            const routeTitle = trip?.routeId ? (routeMap.get(trip.routeId) || '') : '';

            const groupKey = `${busKey}|${trip?.id || 'unknown'}|${routeStopKey || 'unknown'}`;

            if (!detailedGroups.has(groupKey)) {
                detailedGroups.set(groupKey, {
                    busId: busKey,
                    licensePlate,
                    stopTitle,
                    routeTitle,
                    departure: departureDate,
                    salesTotal: 0,
                    ticketCount: 0,
                    stopKey: stopUniqueKey,
                });
            }

            const group = detailedGroups.get(groupKey);
            group.salesTotal += priceValue;
            group.ticketCount += 1;
            if (!group.stopTitle && stopTitle) group.stopTitle = stopTitle;
            if (!group.routeTitle && routeTitle) group.routeTitle = routeTitle;
            if (!group.licensePlate && licensePlate) group.licensePlate = licensePlate;
            if (!group.departure && departureDate) group.departure = departureDate;
            if ((!group.stopKey || group.stopKey === 'unknown') && stopUniqueKey) {
                group.stopKey = stopUniqueKey;
            }
        });

        const detailedRows = Array.from(detailedGroups.values());

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${isDetailed ? detailedFileName : summaryFileName}"`);

        if (isDetailed) {
            if (effectiveGroup === 'stop') {
                await generateWebTicketsReportByStopDetailed(detailedRows, queryInfo, res);
            } else {
                await generateWebTicketsReportByBusDetailed(detailedRows, queryInfo, res);
            }
        } else if (effectiveGroup === 'stop') {
            await generateWebTicketsReportByStopSummary(stopSummaryRows, queryInfo, res);
        } else {
            await generateWebTicketsReportByBusSummary(busSummaryRows, queryInfo, res);
        }
    } catch (err) {
        console.error('getWebTicketsReport error:', err);
        res.status(500).json({ message: 'Web ticket report could not be generated.' });
    }
};

exports.getExternalReturnTicketsReport = async (req, res, next) => {
    try {
        const { startDate, endDate, branchId, userId } = req.query || {};

        const parseDate = (value) => {
            if (!value) {
                return null;
            }

            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        let start = parseDate(startDate) || new Date("1970-01-01T00:00:00Z");
        let end = parseDate(endDate) || new Date();

        if (start > end) {
            const temp = start;
            start = end;
            end = temp;
        }

        const [branchRecord, userRecord] = await Promise.all([
            branchId
                ? req.models.Branch.findOne({
                    where: { id: branchId },
                    attributes: ["id", "title", "stopId"],
                    raw: true
                })
                : null,
            userId
                ? req.models.FirmUser.findOne({
                    where: { id: userId },
                    attributes: ["id", "name", "branchId"],
                    raw: true
                })
                : null
        ]);

        const where = {
            status: { [Op.in]: ["completed", "web", "gotur"] },
            fromRouteStopId: { [Op.ne]: null },
            createdAt: { [Op.between]: [start, end] }
        };

        if (userId) {
            where.userId = userId;
        } else {
            where.userId = { [Op.ne]: null };
        }

        let tickets = await req.models.Ticket.findAll({
            where,
            raw: true,
            order: [["createdAt", "ASC"]]
        });

        if (branchId) {
            const branchUserRecords = await req.models.FirmUser.findAll({
                where: { branchId },
                attributes: ["id"],
                raw: true
            });

            const allowedUserIds = new Set(branchUserRecords.map(u => String(u.id)));
            tickets = tickets.filter(t => allowedUserIds.has(String(t.userId)));
        }

        const userIds = [...new Set(tickets.map(t => t.userId).filter(id => id !== null && id !== undefined))];
        const users = userIds.length
            ? await req.models.FirmUser.findAll({
                where: { id: { [Op.in]: userIds } },
                attributes: ["id", "name", "branchId"],
                raw: true
            })
            : [];

        const branchIds = [...new Set(users.map(u => u.branchId).filter(Boolean))];
        const branches = branchIds.length
            ? await req.models.Branch.findAll({
                where: { id: { [Op.in]: branchIds } },
                attributes: ["id", "title", "stopId"],
                raw: true
            })
            : [];

        const tripIds = [...new Set(tickets.map(t => t.tripId).filter(Boolean))];
        const trips = tripIds.length
            ? await req.models.Trip.findAll({
                where: { id: { [Op.in]: tripIds } },
                attributes: ["id", "routeId", "date", "time"],
                raw: true
            })
            : [];

        const routeIds = [
            ...new Set([
                ...trips.map(trip => trip.routeId).filter(Boolean)
            ])
        ];

        const routeStops = routeIds.length
            ? await req.models.RouteStop.findAll({
                where: { routeId: { [Op.in]: routeIds } },
                order: [["routeId", "ASC"], ["order", "ASC"]],
                raw: true
            })
            : [];

        const tripStopTimes = tripIds.length
            ? await req.models.TripStopTime.findAll({
                where: { tripId: { [Op.in]: tripIds } },
                raw: true
            })
            : [];

        const toKey = value => (value === undefined || value === null) ? "" : String(value);

        const userMap = new Map(users.map(u => [toKey(u.id), u]));
        const branchMap = new Map(branches.map(b => [toKey(b.id), b]));
        const tripMap = new Map(trips.map(trip => [toKey(trip.id), trip]));

        const routeStopsByRoute = new Map();
        routeStops.forEach(rs => {
            const routeKey = toKey(rs.routeId);
            if (!routeStopsByRoute.has(routeKey)) {
                routeStopsByRoute.set(routeKey, []);
            }
            routeStopsByRoute.get(routeKey).push(rs);
        });

        routeStopsByRoute.forEach(list => {
            list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        });

        const routeStopByRouteAndStop = new Map();
        routeStops.forEach(rs => {
            const routeKey = toKey(rs.routeId);
            const stopKey = toKey(rs.stopId);
            if (!routeKey || !stopKey) {
                return;
            }

            const compositeKey = `${routeKey}|${stopKey}`;
            if (!routeStopByRouteAndStop.has(compositeKey)) {
                routeStopByRouteAndStop.set(compositeKey, rs);
            }
        });

        const tripStopTimesByTrip = new Map();
        tripStopTimes.forEach(row => {
            const key = toKey(row.tripId);
            if (!tripStopTimesByTrip.has(key)) {
                tripStopTimesByTrip.set(key, []);
            }
            tripStopTimesByTrip.get(key).push(row);
        });

        const stopIdsSet = new Set();
        routeStops.forEach(rs => {
            if (rs.stopId !== null && rs.stopId !== undefined) {
                stopIdsSet.add(rs.stopId);
            }
        });
        tickets.forEach(ticket => {
            if (ticket.fromRouteStopId !== null && ticket.fromRouteStopId !== undefined) {
                stopIdsSet.add(ticket.fromRouteStopId);
            }
            if (ticket.toRouteStopId !== null && ticket.toRouteStopId !== undefined) {
                stopIdsSet.add(ticket.toRouteStopId);
            }
        });
        branches.forEach(branch => {
            if (branch.stopId !== null && branch.stopId !== undefined) {
                stopIdsSet.add(branch.stopId);
            }
        });

        const stops = stopIdsSet.size
            ? await req.models.Stop.findAll({
                where: { id: { [Op.in]: Array.from(stopIdsSet) } },
                attributes: ["id", "title"],
                raw: true
            })
            : [];

        const stopMap = new Map(stops.map(stop => [toKey(stop.id), stop.title]));

        const parseDurationToSeconds = (duration) => {
            if (!duration) {
                return 0;
            }

            const [hours = 0, minutes = 0, seconds = 0] = String(duration).split(":").map(Number);
            const safeHours = Number.isFinite(hours) ? hours : 0;
            const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
            const safeSeconds = Number.isFinite(seconds) ? seconds : 0;

            return safeHours * 3600 + safeMinutes * 60 + safeSeconds;
        };

        const combineDateAndTime = (dateStr, timeStr) => {
            if (!dateStr) {
                return null;
            }

            const [year, month, day] = String(dateStr).split("-").map(Number);
            if (!year || !month || !day) {
                return null;
            }

            const [hour = 0, minute = 0, second = 0] = String(timeStr || "00:00:00").split(":").map(Number);
            return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, second || 0);
        };

        const stopTimesCache = new Map();

        const getRouteStopForTripStop = (trip, stopId) => {
            if (!trip) {
                return null;
            }

            const routeKey = toKey(trip.routeId);
            const stopKey = toKey(stopId);
            if (!routeKey || !stopKey) {
                return null;
            }

            const compositeKey = `${routeKey}|${stopKey}`;
            return routeStopByRouteAndStop.get(compositeKey) || null;
        };

        const getRouteStopDeparture = (trip, routeStop) => {
            if (!trip || !routeStop) {
                return null;
            }

            const tripKey = toKey(trip.id);
            const routeKey = toKey(routeStop.routeId || trip.routeId);
            const cacheKey = `${tripKey}|${routeKey}`;

            if (!stopTimesCache.has(cacheKey)) {
                const routeList = routeStopsByRoute.get(routeKey) || [];
                const offsetRows = tripStopTimesByTrip.get(tripKey) || [];
                const offsetMap = buildOffsetMap(offsetRows);
                const computed = computeRouteStopTimes(trip, routeList, offsetMap);
                const timeMap = new Map(computed.map(item => [toKey(item.routeStopId), item.time]));
                stopTimesCache.set(cacheKey, timeMap);
            }

            const timeMap = stopTimesCache.get(cacheKey);
            const timeString = timeMap?.get(toKey(routeStop.id));

            if (timeString) {
                return combineDateAndTime(trip.date, timeString);
            }

            const routeList = routeStopsByRoute.get(routeKey) || [];
            let cumulativeSeconds = 0;
            for (const rs of routeList) {
                cumulativeSeconds += parseDurationToSeconds(rs.duration);
                if (toKey(rs.id) === toKey(routeStop.id)) {
                    break;
                }
            }

            const baseDate = combineDateAndTime(trip.date, trip.time);
            return baseDate ? new Date(baseDate.getTime() + cumulativeSeconds * 1000) : null;
        };

        const normalizePayment = (value) => {
            const lowered = (value || "").toString().toLowerCase();
            if (lowered === "cash") return "cash";
            if (lowered === "card") return "card";
            if (lowered === "point") return "point";
            return "other";
        };

        const paymentLabel = (type, original) => {
            if (type === "cash") return "Cash";
            if (type === "card") return "Credit Card";
            if (type === "point") return "Point";
            return original ? original.toString().toUpperCase() : "-";
        };

        const branchBuckets = new Map();
        const totals = { count: 0, amount: 0 };

        tickets.forEach(ticket => {
            const userKey = toKey(ticket.userId);
            const user = userMap.get(userKey);
            if (!user) {
                return;
            }

            const branchIdValue = user.branchId !== undefined && user.branchId !== null ? user.branchId : null;
            const branchKey = branchIdValue !== null ? toKey(branchIdValue) : `none-${userKey}`;
            const branch = branchIdValue !== null ? branchMap.get(toKey(branchIdValue)) : null;

            const branchTitle = branch?.title || "Unspecified Branch";
            const branchStopId = branch?.stopId ?? null;

            const fromStopId = ticket.fromRouteStopId;
            if (fromStopId === null || fromStopId === undefined) {
                return;
            }

            const trip = tripMap.get(toKey(ticket.tripId));
            const fromRouteStop = getRouteStopForTripStop(trip, fromStopId);

            const routeStopStopId = fromRouteStop?.stopId ?? fromStopId ?? null;
            if (
                branchStopId !== null && branchStopId !== undefined &&
                routeStopStopId !== null && routeStopStopId !== undefined &&
                Number(branchStopId) === Number(routeStopStopId)
            ) {
                return;
            }

            if (!branchBuckets.has(branchKey)) {
                branchBuckets.set(branchKey, {
                    id: branch?.id ?? branchIdValue,
                    title: branchTitle,
                    users: new Map(),
                    totals: { count: 0, amount: 0 }
                });
            }

            const branchBucket = branchBuckets.get(branchKey);

            if (!branchBucket.users.has(userKey)) {
                branchBucket.users.set(userKey, {
                    id: user.id,
                    name: user.name || "Unspecified User",
                    tickets: [],
                    totals: { count: 0, amount: 0 }
                });
            }

            const userBucket = branchBucket.users.get(userKey);

            const departureDate = getRouteStopDeparture(trip, fromRouteStop);
            const fromStopTitle = stopMap.get(toKey(fromStopId)) || "-";

            let toStopTitle = "-";
            const toStopId = ticket.toRouteStopId;
            if (toStopId !== null && toStopId !== undefined) {
                const mappedStopTitle = stopMap.get(toKey(toStopId));
                if (mappedStopTitle) {
                    toStopTitle = mappedStopTitle;
                } else {
                    const toRouteStop = getRouteStopForTripStop(trip, toStopId);
                    if (toRouteStop?.stopId !== undefined && toRouteStop?.stopId !== null) {
                        const stopTitle = stopMap.get(toKey(toRouteStop.stopId));
                        if (stopTitle) {
                            toStopTitle = stopTitle;
                        }
                    }

                    if (toStopTitle === "-" && toRouteStop) {
                        const fallbackTitle = toRouteStop.title || toRouteStop.name || toRouteStop.description;
                        if (fallbackTitle) {
                            toStopTitle = String(fallbackTitle);
                        }
                    }
                }
            }

            const paymentType = normalizePayment(ticket.payment);
            const ticketPrice = Number(ticket.price) || 0;

            const ticketRecord = {
                branch: branchTitle,
                user: user.name || "Unspecified User",
                transactionDate: ticket.createdAt ? new Date(ticket.createdAt) : null,
                tripInfo: {
                    departureStop: fromStopTitle,
                    arrivalStop: toStopTitle,
                    departureTime: departureDate
                },
                payment: paymentLabel(paymentType, ticket.payment),
                gender: ticket.gender === "f" ? "F" : ticket.gender === "m" ? "M" : "",
                pnr: ticket.pnr || "-",
                price: ticketPrice
            };


            userBucket.tickets.push(ticketRecord);
            userBucket.totals.count += 1;
            userBucket.totals.amount += ticketPrice;

            branchBucket.totals.count += 1;
            branchBucket.totals.amount += ticketPrice;

            totals.count += 1;
            totals.amount += ticketPrice;
        });

        const preparedBranches = Array.from(branchBuckets.values()).map(branch => {
            const usersArray = Array.from(branch.users.values()).map(user => {
                user.tickets.sort((a, b) => {
                    const timeA = a.transactionDate ? new Date(a.transactionDate).getTime() : 0;
                    const timeB = b.transactionDate ? new Date(b.transactionDate).getTime() : 0;
                    return timeA - timeB;
                });
                return {
                    id: user.id,
                    name: user.name,
                    tickets: user.tickets,
                    totals: user.totals
                };
            }).sort((a, b) => a.name.localeCompare(b.name, "en-US"));

            return {
                id: branch.id,
                title: branch.title,
                users: usersArray,
                totals: branch.totals
            };
        }).sort((a, b) => a.title.localeCompare(b.title, "en-US"));

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline; filename=\"external_return_tickets.pdf\"");

        await generateExternalReturnTicketsReport({
            generatedAt: new Date(),
            query: {
                startDate: startDate || "",
                endDate: endDate || "",
                branch: branchRecord?.title || "All",
                user: userRecord?.name || "All"
            },
            totals,
            branches: preparedBranches
        }, res);
    } catch (err) {
        console.error("getExternalReturnTicketsReport error:", err);
        res.status(500).json({ message: "Could not generate external return tickets report." });
    }
};

exports.getUpcomingTicketsReport = async (req, res, next) => {
    try {
        const now = new Date();
        const activeStatuses = ["completed", "web", "gotur"];

        const tickets = await req.models.Ticket.findAll({
            where: {
                status: { [Op.in]: activeStatuses },
                tripId: { [Op.ne]: null },
                fromRouteStopId: { [Op.ne]: null }
            },
            raw: true
        });

        const tripIds = [...new Set(tickets.map(t => t.tripId).filter(Boolean))];
        const trips = tripIds.length ? await req.models.Trip.findAll({
            where: { id: { [Op.in]: tripIds } },
            raw: true
        }) : [];

        const routeIds = [...new Set(trips.map(t => t.routeId).filter(Boolean))];
        const routeStops = routeIds.length ? await req.models.RouteStop.findAll({
            where: { routeId: { [Op.in]: routeIds } },
            order: [["routeId", "ASC"], ["order", "ASC"]],
            raw: true
        }) : [];

        console.log([...new Set(routeStops.map(rs => rs.id).filter(Boolean))])

        const stopIds = [...new Set(routeStops.map(rs => rs.stopId).filter(Boolean))];
        const stops = stopIds.length ? await req.models.Stop.findAll({
            where: { id: { [Op.in]: stopIds } },
            raw: true
        }) : [];

        const userIds = [...new Set(tickets.map(t => t.userId).filter(Boolean))];
        const users = userIds.length ? await req.models.FirmUser.findAll({
            where: { id: { [Op.in]: userIds } },
            raw: true
        }) : [];

        const branchIds = [...new Set(users.map(u => u.branchId).filter(Boolean))];
        const branches = branchIds.length ? await req.models.Branch.findAll({
            where: { id: { [Op.in]: branchIds } },
            raw: true
        }) : [];

        const toKey = value => (value === undefined || value === null) ? "" : String(value);

        const tripMap = new Map(trips.map(trip => [toKey(trip.id), trip]));
        const routeStopsByRoute = new Map();
        routeStops.forEach(rs => {
            const routeKey = toKey(rs.routeId);
            if (!routeStopsByRoute.has(routeKey)) {
                routeStopsByRoute.set(routeKey, []);
            }
            routeStopsByRoute.get(routeKey).push(rs);
        });

        const stopMap = new Map(stops.map(stop => [toKey(stop.id), stop.title]));
        const userMap = new Map(users.map(user => [toKey(user.id), user]));
        const branchMap = new Map(branches.map(branch => [toKey(branch.id), branch]));

        const parseDurationToSeconds = duration => {
            if (!duration) return 0;
            const [rawH = 0, rawM = 0, rawS = 0] = duration.split(":").map(Number);
            const hours = Number.isFinite(rawH) ? rawH : 0;
            const minutes = Number.isFinite(rawM) ? rawM : 0;
            const seconds = Number.isFinite(rawS) ? rawS : 0;
            return hours * 3600 + minutes * 60 + seconds;
        };

        const combineDateAndTime = (dateStr, timeStr) => {
            if (!dateStr) return null;
            const [year, month, day] = dateStr.split("-").map(Number);
            if (!year || !month || !day) return null;
            const [hour = 0, minute = 0, second = 0] = (timeStr || "00:00:00").split(":").map(Number);
            return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, second || 0);
        };

        const formatRouteTitle = (fromTitle, toTitle) => {
            const safeFrom = fromTitle || "-";
            const safeTo = toTitle || "";
            return safeTo ? `${safeFrom} - ${safeTo}` : safeFrom;
        };

        const normalizePayment = payment => {
            const lowered = (payment || "").toLowerCase();
            if (lowered === "cash") return "cash";
            if (lowered === "card") return "card";
            if (lowered === "point") return "point";
            return "other";
        };

        const paymentLabel = type => {
            if (type === "cash") return "Cash";
            if (type === "card") return "Credit Card";
            if (type === "point") return "Point";
            return "-";
        };

        const branchBuckets = new Map();
        const totals = {
            count: 0,
            amount: 0,
            payments: { cash: 0, card: 0, point: 0, other: 0 }
        };

        tickets.forEach(ticket => {
            const trip = tripMap.get(toKey(ticket.tripId));
            if (!trip) return;

            const baseDate = combineDateAndTime(trip.date, trip.time);
            if (!baseDate) return;

            const routeList = routeStopsByRoute.get(toKey(trip.routeId));
            if (!routeList || !routeList.length) return;

            let cumulativeSeconds = 0;
            let fromRouteStop = null;
            for (const rs of routeList) {
                cumulativeSeconds += parseDurationToSeconds(rs.duration);
                if (toKey(rs.stopId) === toKey(ticket.fromRouteStopId)) {
                    fromRouteStop = rs;
                    break;
                }
            }
            if (!fromRouteStop) return;

            const departure = new Date(baseDate.getTime() + cumulativeSeconds * 1000);
            if (departure < now) {
                return;
            }

            const fromStopTitle = stopMap.get(toKey(ticket.fromRouteStopId)) || "-";
            const toStopTitle = ticket.toRouteStopId ? (stopMap.get(toKey(ticket.toRouteStopId)) || "") : "";

            const user = ticket.userId ? userMap.get(toKey(ticket.userId)) : null;
            const branch = user?.branchId ? branchMap.get(toKey(user.branchId)) : null;

            const branchKey = branch ? toKey(branch.id) : "none";
            if (!branchBuckets.has(branchKey)) {
                branchBuckets.set(branchKey, {
                    id: branch?.id ?? null,
                    title: branch?.title || "Unspecified Branch",
                    users: new Map(),
                    totals: { count: 0, amount: 0, payments: { cash: 0, card: 0, point: 0, other: 0 } }
                });
            }
            const branchBucket = branchBuckets.get(branchKey);

            const userKey = user ? toKey(user.id) : `none-${branchKey}`;
            if (!branchBucket.users.has(userKey)) {
                branchBucket.users.set(userKey, {
                    id: user?.id ?? null,
                    name: user?.name || "Unspecified User",
                    tickets: [],
                    totals: { count: 0, amount: 0, payments: { cash: 0, card: 0, point: 0, other: 0 } }
                });
            }
            const userBucket = branchBucket.users.get(userKey);

            const price = Number(ticket.price) || 0;
            const paymentType = normalizePayment(ticket.payment);
            const label = paymentType === "other"
                ? (ticket.payment ? ticket.payment.toUpperCase() : "-")
                : paymentLabel(paymentType);

            userBucket.tickets.push({
                pnr: ticket.pnr || "-",
                departure,
                route: formatRouteTitle(fromStopTitle, toStopTitle),
                seat: ticket.seatNo !== undefined && ticket.seatNo !== null ? String(ticket.seatNo) : "-",
                payment: label,
                price
            });

            userBucket.totals.count += 1;
            userBucket.totals.amount += price;
            userBucket.totals.payments[paymentType] += price;

            branchBucket.totals.count += 1;
            branchBucket.totals.amount += price;
            branchBucket.totals.payments[paymentType] += price;

            totals.count += 1;
            totals.amount += price;
            totals.payments[paymentType] += price;
        });

        const preparedBranches = Array.from(branchBuckets.values()).map(branch => {
            const usersArray = Array.from(branch.users.values()).map(user => {
                user.tickets.sort((a, b) => a.departure - b.departure);
                return {
                    id: user.id,
                    name: user.name,
                    tickets: user.tickets,
                    totals: user.totals
                };
            }).sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));

            return {
                id: branch.id,
                title: branch.title,
                users: usersArray,
                totals: branch.totals
            };
        }).sort((a, b) => a.title.localeCompare(b.title, "tr-TR"));

        const totalUsers = preparedBranches.reduce((acc, branch) => acc + branch.users.length, 0);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline; filename=\"upcoming_tickets.pdf\"");

        await generateUpcomingTicketsReport({
            generatedAt: now,
            branches: preparedBranches,
            totals,
            summary: {
                branchCount: preparedBranches.length,
                userCount: totalUsers
            }
        }, res);
    } catch (err) {
        console.error("getUpcomingTicketsReport error:", err);
        res.status(500).json({ message: "Could not generate upcoming tickets report." });
    }
};

exports.getBusTransactionsReport = async (req, res, next) => {
    try {
        const { startDate, endDate, busId } = req.query || {};

        const now = new Date();
        const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

        const start = parseDateTimeInput(startDate) || defaultStart;
        const end = parseDateTimeInput(endDate) || now;

        if (start > end) {
            return res.status(400).json({ message: "Start date cannot be after end date." });
        }

        let busIdNum = null;
        const where = {
            createdAt: { [Op.between]: [start, end] }
        };

        if (busId) {
            busIdNum = Number(busId);
            if (!Number.isFinite(busIdNum)) {
                return res.status(400).json({ message: "Invalid bus information." });
            }
            where.busId = busIdNum;
        }

        const transactions = await req.models.BusTransaction.findAll({
            where,
            order: [["busId", "ASC"], ["createdAt", "ASC"]],
            raw: true
        });

        const collectedBusIds = new Set(
            transactions
                .map(t => Number(t.busId))
                .filter(id => Number.isFinite(id))
        );

        if (Number.isFinite(busIdNum) && !collectedBusIds.has(busIdNum)) {
            collectedBusIds.add(busIdNum);
        }

        const busRecords = collectedBusIds.size
            ? await req.models.Bus.findAll({
                where: { id: { [Op.in]: Array.from(collectedBusIds) } },
                attributes: ["id", "licensePlate"],
                raw: true
            })
            : [];

        const busMap = new Map(busRecords.map(b => [Number(b.id), b.licensePlate || `Bus #${b.id}`]));
        const fallbackBusTitle = id => {
            const numeric = Number(id);
            return Number.isFinite(numeric) ? `Bus #${numeric}` : "Bus";
        };

        const toAmount = value => {
            const num = Number(value);
            return Number.isFinite(num) ? num : 0;
        };

        const overallTotals = {
            income: 0,
            expense: 0,
            net: 0,
            count: transactions.length
        };

        transactions.forEach(tx => {
            const amount = toAmount(tx.amount);
            if (tx.type === "income") {
                overallTotals.income += amount;
                overallTotals.net += amount;
            } else {
                overallTotals.expense += amount;
                overallTotals.net -= amount;
            }
        });

        const groups = [];
        if (transactions.length) {
            const grouped = new Map();
            transactions.forEach(tx => {
                const busKey = Number(tx.busId);
                if (!grouped.has(busKey)) {
                    grouped.set(busKey, []);
                }
                grouped.get(busKey).push(tx);
            });

            grouped.forEach((rows, busKey) => {
                const totals = rows.reduce((acc, row) => {
                    const amount = toAmount(row.amount);
                    if (row.type === "income") {
                        acc.income += amount;
                        acc.net += amount;
                    } else {
                        acc.expense += amount;
                        acc.net -= amount;
                    }
                    acc.count += 1;
                    return acc;
                }, { income: 0, expense: 0, net: 0, count: 0 });

                groups.push({
                    busId: busKey,
                    busTitle: busMap.get(busKey) || fallbackBusTitle(busKey),
                    totals,
                    rows: rows.map(row => ({
                        date: row.createdAt,
                        description: row.description || "",
                        type: row.type,
                        amount: toAmount(row.amount)
                    }))
                });
            });
        } else if (Number.isFinite(busIdNum)) {
            groups.push({
                busId: busIdNum,
                busTitle: busMap.get(busIdNum) || fallbackBusTitle(busIdNum),
                totals: { income: 0, expense: 0, net: 0, count: 0 },
                rows: []
            });
        }

        groups.sort((a, b) => a.busTitle.localeCompare(b.busTitle, "tr-TR", { sensitivity: "base", numeric: true }));

        const queryInfo = {
            startDate: start,
            endDate: end,
            bus: Number.isFinite(busIdNum) ? (busMap.get(busIdNum) || fallbackBusTitle(busIdNum)) : "All"
        };

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline; filename=\"bus_transactions_report.pdf\"");

        await generateBusTransactionsReport({
            generatedAt: now,
            query: queryInfo,
            totals: overallTotals,
            groups
        }, res);
    } catch (err) {
        console.error("getBusTransactionsReport error:", err);
        res.status(500).json({ message: "Could not generate bus transactions report." });
    }
};

exports.postAnnouncementSeen = async (req, res, next) => {
    try {
        const { announcementId } = req.body;
        const userId = req.session.firmUser.id;
        await req.models.AnnouncementUser.findOrCreate({
            where: { announcementId, userId },
            defaults: { seenAt: new Date() }
        });
        res.json({ success: true });
    } catch (err) {
        console.error("Announcement seen error:", err);
        res.status(500).json({ message: err.message });
    }
};

function destroySessionAndRespond(req, res) {
    const successPayload = { success: true, redirect: "/login" };

    if (!req.session) {
        res.json(successPayload);
        return;
    }

    req.session.destroy(err => {
        if (err) {
            console.error("Session destroy error:", err);
            res.status(500).json({ message: "An error occurred while destroying the session." });
            return;
        }
        res.clearCookie("connect.sid");
        res.json(successPayload);
    });
}

exports.postUpdateProfile = async (req, res, next) => {
    try {
        if (!req.session?.firmUser?.id) {
            return res.status(401).json({ message: "Session not found." });
        }

        const userId = req.session.firmUser.id;
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
        const rawPhone = typeof req.body.phoneNumber === "string" ? req.body.phoneNumber : "";

        if (!name) {
            return res.status(400).json({ message: "Name cannot be empty." });
        }

        if (!username) {
            return res.status(400).json({ message: "Username cannot be empty." });
        }

        const existingUser = await req.models.FirmUser.findOne({
            where: {
                username,
                id: { [Op.ne]: userId }
            }
        });

        if (existingUser) {
            return res.status(400).json({ message: "This username is already taken." });
        }

        const digits = rawPhone.replace(/\D/g, "");
        let formattedPhone = null;

        if (digits) {
            if (digits.length !== 10) {
                return res.status(400).json({ message: "Phone number must be 10 digits." });
            }
            formattedPhone = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
        }

        const user = await req.models.FirmUser.findByPk(userId);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        await user.update({
            name,
            username,
            phoneNumber: formattedPhone,
        });

        return destroySessionAndRespond(req, res);
    } catch (err) {
        console.error("Profile update error:", err);
        res.status(500).json({ message: "Profile could not be updated." });
    }
};

exports.postChangePassword = async (req, res, next) => {
    try {
        if (!req.session?.firmUser?.id) {
            return res.status(401).json({ message: "Session not found." });
        }

        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword) {
            return res.status(400).json({ message: "Current password is required." });
        }

        if (!newPassword) {
            return res.status(400).json({ message: "New password is required." });
        }

        if (typeof newPassword !== "string" || newPassword.length < 6) {
            return res.status(400).json({ message: "New password must be at least 6 characters." });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: "New passwords do not match." });
        }

        const user = await req.models.FirmUser.findByPk(req.session.firmUser.id);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const isCurrentValid = await bcrypt.compare(currentPassword, user.password);

        if (!isCurrentValid) {
            return res.status(400).json({ message: "Current password is incorrect." });
        }

        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({ message: "New password cannot be the same as the old password." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await user.update({ password: hashedPassword });

        return destroySessionAndRespond(req, res);
    } catch (err) {
        console.error("Password update error:", err);
        res.status(500).json({ message: "Password could not be updated." });
    }
};
