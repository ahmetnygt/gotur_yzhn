const { Op } = require("sequelize");

const INACTIVE_TICKET_STATUSES = Object.freeze(["canceled", "cancelled", "refund"]);

function segmentsOverlap(startA, endA, startB, endB) {
    const values = [startA, endA, startB, endB];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        return true;
    }

    if (startA >= endA || startB >= endB) {
        return true;
    }

    // Half-open segments: [start, end) — alighting stop frees the seat for boarding there.
    return startA < endB && startB < endA;
}

function buildRouteStopOrderMap(routeStops = []) {
    return routeStops.reduce((acc, rs) => {
        if (rs?.stopId == null) return acc;
        const order = Number(rs.order);
        if (Number.isFinite(order)) {
            acc[String(rs.stopId)] = order;
        }
        return acc;
    }, {});
}

/**
 * Returns the first seat whose proposed boarding→alighting segment overlaps
 * an existing active ticket on the same trip/seat, or null if all are free.
 *
 * @param {object} models
 * @param {object} options
 * @param {number|string} options.tripId
 * @param {Array<{seatNumber: number|string, fromStopId: number|string, toStopId: number|string, seatLabel?: string}>} options.proposals
 * @param {Array} options.routeStops
 * @param {Array<number|string>} [options.excludeTicketIds]
 * @param {object} [options.transaction]
 * @returns {Promise<null|{seatNumber: number, seatLabel: string}>}
 */
async function findSeatSegmentConflict(models, {
    tripId,
    proposals,
    routeStops,
    excludeTicketIds = [],
    transaction,
}) {
    if (!tripId || !Array.isArray(proposals) || !proposals.length) {
        return null;
    }

    const orderMap = buildRouteStopOrderMap(routeStops);
    const seatNumbers = [
        ...new Set(
            proposals
                .map((p) => Number(p.seatNumber))
                .filter((n) => Number.isFinite(n))
        ),
    ];

    if (!seatNumbers.length) {
        return null;
    }

    const where = {
        tripId,
        seatNo: { [Op.in]: seatNumbers },
        status: { [Op.notIn]: INACTIVE_TICKET_STATUSES },
    };

    const excludeIds = (excludeTicketIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

    if (excludeIds.length) {
        where.id = { [Op.notIn]: excludeIds };
    }

    const existingTickets = await models.Ticket.findAll({
        where,
        attributes: ["id", "seatNo", "fromRouteStopId", "toRouteStopId"],
        raw: true,
        ...(transaction ? { transaction } : {}),
    });

    for (const proposal of proposals) {
        const seatNumber = Number(proposal.seatNumber);
        if (!Number.isFinite(seatNumber)) continue;

        const fromOrder = orderMap[String(proposal.fromStopId)];
        const toOrder = orderMap[String(proposal.toStopId)];

        const seatTickets = existingTickets.filter(
            (ticket) => Number(ticket.seatNo) === seatNumber
        );

        for (const ticket of seatTickets) {
            const ticketFromOrder = orderMap[String(ticket.fromRouteStopId)];
            const ticketToOrder = orderMap[String(ticket.toRouteStopId)];

            if (segmentsOverlap(fromOrder, toOrder, ticketFromOrder, ticketToOrder)) {
                return {
                    seatNumber,
                    seatLabel: String(proposal.seatLabel ?? proposal.seatNumber),
                };
            }
        }
    }

    return null;
}

function seatConflictMessage(conflict) {
    const label = conflict?.seatLabel ?? conflict?.seatNumber ?? "?";
    return `${label} numaralı koltuk seçilen güzergah için uygun değil.`;
}

module.exports = {
    segmentsOverlap,
    buildRouteStopOrderMap,
    findSeatSegmentConflict,
    seatConflictMessage,
    INACTIVE_TICKET_STATUSES,
};
