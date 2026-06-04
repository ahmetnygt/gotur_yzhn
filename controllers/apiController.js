const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const branchModel = require("../models/branchModel");

function addMinutes(time, minutesToAdd) {
    if (!time) return null;
    const [h, m] = String(time).split(":").map(Number);
    let total = h * 60 + m + minutesToAdd;
    total = (total + 1440) % 1440;

    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
}

function durationToMinutes(duration) {
    if (!duration) return 0;
    const parts = String(duration).split(":").map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    return h * 60 + m;
}

function calcDuration(start, end) {
    if (!start || !end) return "";

    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);

    let startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;

    if (endMin < startMin) endMin += 1440;

    const diff = endMin - startMin;
    const h = Math.floor(diff / 60);
    const m = diff % 60;

    return `${h} hours ${m} minutes`;
}

function generateSeatPlan(binary = "") {
    const plan = [];
    let seatNumber = 1;

    for (let i = 0; i < binary.length; i++) {
        if (binary[i] === "1") {
            plan[i] = String(seatNumber++);
        } else {
            plan[i] = "";
        }
    }

    return plan;
}

function buildBusFeatures(bus) {
    if (!bus) return [];

    const features = [];

    if (bus.hasWifi) {
        features.push({
            key: "wifi",
            label: "Wi-Fi",
            icon: "/svg/feature-wifi.svg",
        });
    }
    if (bus.hasSeatScreen) {
        features.push({
            key: "seatScreen",
            label: "Seat Screen",
            icon: "/svg/feature-screen.svg",
        });
    }
    if (bus.hasPowerOutlet || bus.hasUsbPort) {
        features.push({
            key: "power",
            label: "Power / USB",
            icon: "/svg/feature-power.svg",
        });
    }
    if (bus.hasCatering) {
        features.push({
            key: "catering",
            label: "Snacks",
            icon: "/svg/feature-snack.svg",
        });
    }
    if (bus.hasComfortableSeat) {
        features.push({
            key: "comfortSeat",
            label: "Comfort Seat",
            icon: "/svg/feature-seat.svg",
        });
    }

    return features;
}

exports.getStops = async (req, res) => {
    try {
        const { Stop } = req.models;
        const tenantKey = req.tenantKey;

        const stops = await Stop.findAll({
            where: { isActive: true },
            attributes: ["id", "placeId", "title", "isActive"],
            order: [["title", "ASC"]]
        });

        return res.json({
            tenant: tenantKey,
            count: stops.length,
            stops
        });

    } catch (err) {
        console.error("STOP_LIST_ERROR:", err);
        return res.status(500).json({
            error: "An unexpected error occurred",
            detail: err.message
        });
    }
};

exports.search = async (req, res) => {
    try {
        const {
            Trip,
            Route,
            RouteStop,
            Stop,
            Bus,
            BusModel,
            Price,
            TripStopTime,
            Ticket,
        } = req.models;

        const { from, to, date } = req.query;
        const tenantKey = req.tenantKey;

        if (!from || !to || !date) {
            return res
                .status(400)
                .json({ error: "from, to, and date are required." });
        }

        const fromStop = await Stop.findOne({ where: { placeId: from } });
        const toStop = await Stop.findOne({ where: { placeId: to } });

        if (!fromStop || !toStop) {
            return res.status(404).json({
                error: "From/To stop not found.",
            });
        }

        const fromRouteStops = await RouteStop.findAll({
            where: { stopId: fromStop.id },
            attributes: ["routeId", "order"],
        });

        const toRouteStops = await RouteStop.findAll({
            where: { stopId: toStop.id },
            attributes: ["routeId", "order"],
        });

        const fromMap = {};
        fromRouteStops.forEach((rs) => (fromMap[rs.routeId] = rs.order));

        const toMap = {};
        toRouteStops.forEach((rs) => (toMap[rs.routeId] = rs.order));

        const validRouteIds = [];
        for (const routeId of Object.keys(fromMap)) {
            if (toMap[routeId] && fromMap[routeId] < toMap[routeId]) {
                validRouteIds.push(Number(routeId));
            }
        }

        if (!validRouteIds.length) {
            return res.json({ tenant: tenantKey, count: 0, trips: [] });
        }

        const trips = await Trip.findAll({
            where: {
                routeId: validRouteIds,
                date,
                isActive: true,
                isDeleted: false,
            },
            include: [
                { model: Bus, as: "bus", required: false },
                { model: BusModel, as: "busModel", required: false },
                {
                    model: TripStopTime,
                    as: "stopTimes",
                    required: false,
                    include: [{ model: RouteStop, as: "routeStop", required: true }],
                },
                { model: Route, as: "route", required: false },
            ],
            order: [["time", "ASC"]],
        });

        if (!trips.length) {
            return res.json({ tenant: tenantKey, count: 0, trips: [] });
        }

        const routeStopsMap = {};
        const allRouteStops = await RouteStop.findAll({
            where: { routeId: validRouteIds },
            order: [["order", "ASC"]],
        });

        for (const rs of allRouteStops) {
            if (!routeStopsMap[rs.routeId]) routeStopsMap[rs.routeId] = [];
            routeStopsMap[rs.routeId].push(rs);
        }

        const stopIds = [
            ...new Set(allRouteStops.map((rs) => rs.stopId)),
        ];
        const allStopsForRoutes = await Stop.findAll({
            where: { id: stopIds },
            attributes: ["id", "title"],
        });
        const stopTitleById = {};
        allStopsForRoutes.forEach((s) => {
            stopTitleById[s.id] = s.title;
        });

        const tripIds = trips.map((t) => t.id);
        const occupiedStatuses = [
            "web",
            "gotur",
            "completed",
            "reservation",
            "pending",
        ];

        const allTickets = await Ticket.findAll({
            where: {
                tripId: tripIds,
                status: occupiedStatuses,
                seatNo: { [Op.ne]: null },
            },
            attributes: ["tripId", "seatNo", "gender"],
        });

        const ticketsByTrip = {};
        allTickets.forEach((tic) => {
            if (!ticketsByTrip[tic.tripId]) ticketsByTrip[tic.tripId] = [];
            ticketsByTrip[tic.tripId].push(tic);
        });

        const formattedTrips = [];

        for (const trip of trips) {
            const routeStops = routeStopsMap[trip.routeId];
            if (!routeStops || !routeStops.length) continue;

            const fromRS = routeStops.find(
                (rs) => rs.stopId === fromStop.id
            );
            const toRS = routeStops.find((rs) => rs.stopId === toStop.id);

            if (!fromRS || !toRS) continue;

            function getBaseTime(targetRS) {
                let totalMinutes = 0;

                for (const rs of routeStops) {
                    if (rs.order === targetRS.order) break;
                    totalMinutes += durationToMinutes(rs.duration);
                }

                return addMinutes(trip.time, totalMinutes);
            }

            function getFinalTime(routeStopId, baseTime) {
                const ts = trip.stopTimes?.find(
                    (st) => st.routeStopId === routeStopId
                );
                if (!ts) return baseTime;
                return addMinutes(baseTime, ts.offsetMinutes);
            }

            const fromBase = getBaseTime(fromRS);
            const fromFinal = getFinalTime(fromRS.id, fromBase);

            const toBase = getBaseTime(toRS);
            const toFinal = getFinalTime(toRS.id, toBase);

            const durationText = calcDuration(fromFinal, toFinal);

            let priceAmount = 0;

            let priceRow = await Price.findOne({
                where: { fromStopId: fromStop.id, toStopId: toStop.id }
            });

            if (!priceRow) {
                priceRow = await Price.findOne({
                    where: { fromStopId: toStop.id, toStopId: fromStop.id, isBidirectional: true }
                });
            }

            if (priceRow) {
                priceAmount =
                    priceRow.webPrice ??
                    priceRow.price1 ??
                    priceRow.price2 ??
                    priceRow.price3 ??
                    0;
            }


            const planBinary =
                (trip.busModel && trip.busModel.planBinary) ||
                (trip.busModel && trip.busModel.plan) ||
                "";

            const busPlan = planBinary ? generateSeatPlan(planBinary) : [];

            const totalSeats = planBinary
                ? planBinary.split("").filter((c) => c === "1").length
                : 0;

            const tripTickets = ticketsByTrip[trip.id] || [];

            const ticketsMap = {};
            tripTickets.forEach((tic) => {
                const key = String(tic.seatNo);
                ticketsMap[key] = {
                    gender: tic.gender,
                };
            });

            const occupiedSeatCount = tripTickets.length;
            const fullness =
                totalSeats > 0
                    ? Math.round((occupiedSeatCount / totalSeats) * 100)
                    : 0;

            const busFeatures = buildBusFeatures(trip.bus);

            const timelineStops = routeStops.filter(
                (rs) =>
                    rs.order >= fromRS.order && rs.order <= toRS.order
            );

            const routeTimeline = timelineStops.map((rs) => {
                const base = getBaseTime(rs);
                const finalTime = getFinalTime(rs.id, base);
                return {
                    time: finalTime,
                    title: stopTitleById[rs.stopId] || "",
                };
            });

            const routeDescription =
                (trip.route && trip.route.description) ||
                `${fromStop.title} - ${toStop.title}`;

            formattedTrips.push({
                tripId: trip.id,
                routeId: trip.routeId,
                firm: tenantKey,

                fromStopId: fromStop.id,
                fromStr: fromStop.title,

                toStopId: toStop.id,
                toStr: toStop.title,

                time: fromFinal,
                duration: durationText,

                date: trip.date,
                price: priceAmount,
                currency: "TRY",

                fullness,

                busFeatures,
                busPlanBinary: planBinary,
                busPlan,
                tickets: ticketsMap,

                routeDescription,
                routeTimeline,
            });
        }

        return res.json({
            tenant: tenantKey,
            count: formattedTrips.length,
            trips: formattedTrips,
        });
    } catch (err) {
        console.error("TRIP_SEARCH_ERROR:", err);
        res.status(500).json({
            error: "Unexpected error",
            detail: err.message,
        });
    }
};

exports.createPayment = async (req, res) => {
    try {
        const {
            tripId,
            fromStopId,
            toStopId,
            seatNumbers,
            genders
        } = req.body;

        const { TicketPayment } = req.commonModels;

        if (!tripId || !fromStopId || !toStopId) {
            return res.status(400).json({
                error: "tripId, fromStopId, and toStopId are required."
            });
        }

        if (!Array.isArray(seatNumbers) || seatNumbers.length === 0) {
            return res.status(400).json({
                error: "At least one seatNumber must be provided."
            });
        }

        if (!Array.isArray(genders) || genders.length !== seatNumbers.length) {
            return res.status(400).json({
                error: "genders array must have the same length as seatNumbers."
            });
        }

        const payment = await TicketPayment.create({
            tripId,
            fromStopId,
            toStopId,
            seatNumbers,
            genders,
            isSuccess: false
        });

        return res.json({
            success: true,
            paymentId: payment.id
        });

    } catch (err) {
        console.error("PAYMENT_CREATE_ERROR:", err);
        return res.status(500).json({
            error: "Unexpected error",
            detail: err.message
        });
    }
};

exports.getPaymentDetail = async (req, res) => {
    try {
        const { Trip, Route, RouteStop, Stop, Price } = req.models;
        const { TicketPayment } = req.commonModels;

        const paymentId = req.params.id;

        const payment = await TicketPayment.findByPk(paymentId);
        if (!payment) {
            return res.status(404).json({ error: "Payment not found." });
        }

        const trip = await Trip.findOne({
            where: { id: payment.tripId },
            include: [
                {
                    model: Route, as: "route", include: [
                        {
                            model: RouteStop,
                            as: "stops",
                            include: [
                                { model: Stop, as: "stop" }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!trip) {
            return res.status(404).json({ error: "Trip not found." });
        }

        const fromStop = await Stop.findByPk(payment.fromStopId);
        const toStop = await Stop.findByPk(payment.toStopId);

        let price = await Price.findOne({
            where: {
                fromStopId: payment.fromStopId,
                toStopId: payment.toStopId
            }
        });

        if (!price) {
            price = await Price.findOne({
                where: {
                    fromStopId: payment.toStopId,
                    toStopId: payment.fromStopId,
                    isBidirectional: true
                }
            });
        }

        const perSeat = price?.webPrice || price?.price1 || 0;
        const totalPrice = perSeat * payment.seatNumbers.length;

        return res.json({
            paymentId,
            trip: {
                fromStr: fromStop?.title,
                toStr: toStop?.title,
                date: trip.date,
                time: trip.time,
            },
            seatNumbers: payment.seatNumbers,
            genders: payment.genders,
            perSeat,
            totalPrice
        });

    } catch (err) {
        console.error("PAYMENT_DETAIL_ERROR:", err);
        return res.status(500).json({
            error: "Unexpected error",
            detail: err.message
        });
    }
};

exports.paymentComplete = async (req, res) => {
    try {
        const { Ticket, TicketGroup, FirmUser } = req.models;
        const { TicketPayment } = req.commonModels;

        const { phone, email, names, surnames, idNumbers } = req.body;

        const pay = await TicketPayment.findByPk(req.params.id);
        if (!pay) return res.status(404).json({ error: "Payment record not found." });

        if (pay.isSuccess) return res.json({ success: true, message: "This transaction has already been processed." });

        let webUser = await FirmUser.findOne({ where: { username: "WEB" } });

        const tg = await TicketGroup.create({ tripId: pay.tripId });

        for (const i in pay.seatNumbers) {

            const pName = names && names[i] ? names[i] : "";
            const pSurname = surnames && surnames[i] ? surnames[i] : "";
            const pIdNumber = idNumbers && idNumbers[i] ? idNumbers[i] : "";

            await Ticket.create({
                tripId: pay.tripId,
                ticketGroupId: tg.id,
                seatNo: pay.seatNumbers[i],
                gender: pay.genders[i],
                status: "web",
                nationality: "TR",
                phoneNumber: phone,
                email: email,
                name: pName.toLocaleUpperCase("tr-TR"),
                surname: pSurname.toLocaleUpperCase("tr-TR"),
                idNumber: pIdNumber,
                userId: webUser.id,
            });
        }

        await pay.update({ isSuccess: true });

        res.json({ success: true, paymentId: pay.id, ticketGroupId: tg.id });

    } catch (e) {
        console.error("API_PAYMENT_COMPLETE_ERR:", e);
        res.status(500).json({ error: e.message || "Error creating ticket." });
    }
}

exports.register = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { name, surname, phone, password, email, gender, idNumber } = req.body;

        if (!idNumber || !phone || !password || !name || !surname) {
            return res.status(400).json({ error: "Please fill in all required fields." });
        }

        if (idNumber.length !== 11) {
            return res.status(400).json({ error: "Invalid ID Number." });
        }

        const existing = await Customer.findOne({ where: { idNumber: idNumber } });
        if (existing) {
            return res.status(409).json({ error: "A user with this ID Number already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const customer = await Customer.create({
            name: name.toLocaleUpperCase("tr-TR"),
            surname: surname.toLocaleUpperCase("tr-TR"),
            nationality: "tr",
            customerType: "adult",
            phoneNumber: phone,
            password: hashedPassword,
            email: email || null,
            gender: gender || null,
            idNumber: idNumber,
            customerCategory: "member",
            pointOrPercent: "point"
        });

        const userObj = customer.toJSON();
        delete userObj.password;

        res.json({ success: true, user: userObj });

    } catch (err) {
        console.error("REGISTER_ERR:", err);
        res.status(500).json({ error: "Registration failed.", detail: err.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { idNumber, password } = req.body;

        if (!idNumber || !password) {
            return res.status(400).json({ error: "ID Number and password are required." });
        }

        const customer = await Customer.findOne({ where: { idNumber: idNumber } });
        if (!customer) {
            return res.status(401).json({ error: "User not found." });
        }

        if (!customer.password) {
            return res.status(401).json({ error: "No password set for this user." });
        }

        const match = await bcrypt.compare(password, customer.password);
        if (!match) {
            return res.status(401).json({ error: "Incorrect password." });
        }

        const userObj = customer.toJSON();
        delete userObj.password;

        res.json({ success: true, user: userObj });

    } catch (err) {
        console.error("LOGIN_ERR:", err);
        res.status(500).json({ error: "Login failed.", detail: err.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { id } = req.params;

        if (!id) return res.status(400).json({ error: "ID required." });

        const customer = await Customer.findByPk(id, {
            attributes: { exclude: ['password'] }
        });

        if (!customer) {
            return res.status(404).json({ error: "User not found." });
        }

        res.json({ success: true, user: customer });
    } catch (err) {
        console.error("GET_PROFILE_ERR:", err);
        res.status(500).json({ error: "Could not retrieve profile info." });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { id, name, surname, email, gender, password } = req.body;

        if (!id) return res.status(400).json({ error: "User ID missing." });

        const customer = await Customer.findByPk(id);
        if (!customer) {
            return res.status(404).json({ error: "User not found." });
        }

        const updateData = {
            name: name ? name.toLocaleUpperCase("tr-TR") : customer.name,
            surname: surname ? surname.toLocaleUpperCase("tr-TR") : customer.surname,
            email: email,
            gender: gender
        };

        if (password && password.trim() !== "") {
            updateData.password = await bcrypt.hash(password, 10);
        }

        await customer.update(updateData);

        const userObj = customer.toJSON();
        delete userObj.password;

        res.json({ success: true, user: userObj });

    } catch (err) {
        console.error("UPDATE_PROFILE_ERR:", err);
        res.status(500).json({ error: "Update failed.", detail: err.message });
    }
};

exports.getCustomerTickets = async (req, res) => {
    try {
        const { Ticket, Trip, Stop, Route, RouteStop, TripStopTime } = req.models;
        const { id } = req.params;

        const tickets = await Ticket.findAll({
            include: [
                {
                    model: req.models.Customer,
                    as: "customer",
                    where: { idNumber: id },
                    attributes: []
                },
                {
                    model: Trip,
                    as: "trip",
                    attributes: ["id", "date", "time"],
                    include: [
                        {
                            model: TripStopTime,
                            as: "stopTimes",
                            attributes: ["routeStopId", "offsetMinutes"]
                        },
                        {
                            model: Route,
                            as: "route",
                            attributes: ["title", "routeCode"],
                            include: [
                                {
                                    model: RouteStop,
                                    as: "stops",
                                    attributes: ["id", "order", "duration"],
                                    include: [{ model: Stop, as: "stop", attributes: ["title"] }]
                                }
                            ]
                        }
                    ]
                }
            ],
            order: [
                [{ model: Trip, as: "trip" }, 'date', 'DESC'],
                [{ model: Trip, as: "trip" }, 'time', 'DESC']
            ]
        });

        const processedTickets = tickets.map(t => {
            const ticket = t.toJSON();
            const trip = ticket.trip;
            const routeStops = trip.route?.stops || [];

            routeStops.sort((a, b) => a.order - b.order);

            const fromRS = routeStops.find(rs => rs.id == ticket.fromRouteStopId);
            let depMinutesToAdd = 0;

            if (fromRS) {
                for (const rs of routeStops) {
                    console.log(rs.id, rs.order)
                    console.log(fromRS.id, fromRS.order)
                    if (rs.order > fromRS.order) break;
                    depMinutesToAdd += durationToMinutes(rs.duration);
                }
                const offset = trip.stopTimes?.find(st => st.routeStopId == ticket.fromRouteStopId)?.offsetMinutes || 0;
                depMinutesToAdd += offset;

                ticket.fromStopTitle = fromRS.stop?.title;
            }
            ticket.calculatedDeparture = addMinutes(trip.time, depMinutesToAdd);


            const toRS = routeStops.find(rs => rs.id == ticket.toRouteStopId);
            let arrMinutesToAdd = 0;

            if (toRS) {
                for (const rs of routeStops) {
                    if (rs.order > toRS.order) break;
                    arrMinutesToAdd += durationToMinutes(rs.duration);
                }
                const offset = trip.stopTimes?.find(st => st.routeStopId == ticket.toRouteStopId)?.offsetMinutes || 0;
                arrMinutesToAdd += offset;

                ticket.toStopTitle = toRS.stop?.title;
            }
            ticket.calculatedArrival = addMinutes(trip.time, arrMinutesToAdd);

            return ticket;
        });

        res.json({ success: true, tickets: processedTickets });

    } catch (err) {
        console.error("GET_TICKETS_ERR:", err);
        res.status(500).json({ error: "Could not retrieve tickets.", detail: err.message });
    }
};

exports.cancelTicket = async (req, res) => {
    try {
        const { Ticket } = req.models;
        const { ticketId, action } = req.body;

        const ticket = await Ticket.findByPk(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: "Ticket not found." });
        }

        const tripDate = new Date(ticket.optionDate + " " + ticket.optionTime);

        const newStatus = action === "refund" ? "refund" : "canceled";

        await ticket.update({ status: newStatus });

        res.json({ success: true, message: "Transaction successful." });

    } catch (err) {
        console.error("CANCEL_TICKET_ERR:", err);
        res.status(500).json({ error: "Transaction failed." });
    }
};