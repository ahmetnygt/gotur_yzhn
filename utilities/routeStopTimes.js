function timeToSeconds(raw) {
    if (raw == null || raw === "") return 0;

    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return raw.getUTCHours() * 3600 + raw.getUTCMinutes() * 60 + raw.getUTCSeconds();
    }

    const s = String(raw).split(".")[0].trim();
    if (!s) return 0;

    const timePart = s.includes("T")
        ? s.split("T")[1]
        : (s.includes(" ") ? s.split(" ").pop() : s);
    const parts = timePart.replace(/Z$/i, "").split(":").map(Number);
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;

    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

function dateParts(raw) {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return {
            year: raw.getFullYear(),
            month: raw.getMonth() + 1,
            day: raw.getDate(),
        };
    }

    const s = String(raw || "").trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
        return {
            year: Number(iso[1]),
            month: Number(iso[2]),
            day: Number(iso[3]),
        };
    }

    return null;
}

function parseTripBaseDateTime(trip) {
    if (!trip) return null;

    const parts = dateParts(trip.date);
    if (!parts || ![parts.year, parts.month, parts.day].every((n) => Number.isFinite(n))) {
        return null;
    }

    const totalSeconds = timeToSeconds(trip.time);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const date = new Date(parts.year, parts.month - 1, parts.day, hours, minutes, seconds, 0);
    if (Number.isNaN(date.getTime())) return null;
    if (
        date.getFullYear() !== parts.year
        || date.getMonth() !== parts.month - 1
        || date.getDate() !== parts.day
    ) {
        return null;
    }

    return date;
}

function buildOffsetMap(offsetRows = []) {
    const map = new Map();
    offsetRows.forEach((row) => {
        const routeStopId = row.routeStopId ?? row.get?.("routeStopId");
        const rawOffset = row.offsetMinutes ?? row.get?.("offsetMinutes");
        if (routeStopId === undefined || routeStopId === null) return;
        map.set(Number(routeStopId), Number(rawOffset) || 0);
    });
    return map;
}

function boardingDateTime(trip, routeStops = [], offsetMap = new Map(), fromStopId) {
    if (fromStopId == null || fromStopId === "") return null;

    const base = parseTripBaseDateTime(trip);
    if (!base) return null;

    const ordered = [...routeStops].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    let cumulativeDurationSeconds = 0;
    let cumulativeOffsetSeconds = 0;

    for (const rs of ordered) {
        cumulativeDurationSeconds += timeToSeconds(rs.duration);
        const routeStopId = Number(rs.id);
        const offsetMinutes = offsetMap.get(routeStopId) || 0;
        cumulativeOffsetSeconds += Number(offsetMinutes) * 60;
        const computed = new Date(
            base.getTime() + (cumulativeDurationSeconds + cumulativeOffsetSeconds) * 1000
        );
        if (String(rs.stopId) === String(fromStopId)) {
            return computed;
        }
    }

    return null;
}

async function loadRouteStopSchedule(models, trip) {
    if (!models?.RouteStop || !trip?.routeId) return null;

    const routeStops = await models.RouteStop.findAll({
        where: { routeId: trip.routeId },
        order: [["order", "ASC"]],
        raw: true,
    });
    if (!routeStops.length) return null;

    const offsets = trip.id && models.TripStopTime
        ? await models.TripStopTime.findAll({ where: { tripId: trip.id }, raw: true })
        : [];

    return { routeStops, offsetMap: buildOffsetMap(offsets) };
}

async function loadBoardingDateTime(models, trip, fromStopId) {
    if (fromStopId == null || fromStopId === "") return null;
    const schedule = await loadRouteStopSchedule(models, trip);
    if (!schedule) return null;
    return boardingDateTime(trip, schedule.routeStops, schedule.offsetMap, fromStopId);
}

module.exports = {
    timeToSeconds,
    parseTripBaseDateTime,
    buildOffsetMap,
    boardingDateTime,
    loadRouteStopSchedule,
    loadBoardingDateTime,
};
