const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const branchModel = require("../models/branchModel");
const { signCustomerToken } = require("../utilities/customerAuthToken");

// erpController'dan kopyalanan orijinal PNR oluşturucu
async function generatePNR(models, fromId, toId, stops) {
    const from = stops.find(s => s.id == fromId)?.title;
    const to = stops.find(s => s.id == toId)?.title;
    const turkishMap = { "Ç": "C", "Ş": "S", "İ": "I", "Ğ": "G", "Ü": "U", "Ö": "O", "ç": "C", "ş": "S", "ı": "I", "ğ": "G", "ü": "U", "ö": "O" };

    const clean = str => {
        if (!str) return "XX"; // Boş gelirse patlamaması için ufak bir koruma
        return str
            .split('')
            .map(c => turkishMap[c] || c)
            .join('')
            .toUpperCase()
            .substring(0, 2);
    };

    const fromCode = clean(from);
    const toCode = clean(to);

    let pnr;
    let exists = true;

    while (exists) {
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        pnr = `${fromCode}${toCode}${rand}`;
        // PNR veritabanında zaten var mı diye kontrol ediyor
        exists = await models.Ticket.findOne({ where: { pnr } });
    }

    return pnr;
}

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
            where: { isActive: true, isDeleted: false },
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
            error: "Beklenmeyen bir hata oluştu",
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
                .json({ error: "kalkış, varış ve tarih alanları zorunludur." });
        }

        const fromStop = await Stop.findOne({ where: { placeId: from } });
        const toStop = await Stop.findOne({ where: { placeId: to } });

        if (!fromStop || !toStop) {
            return res.status(404).json({
                error: "Kalkış/Varış durağı bulunamadı.",
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

        // N+1 DÜZELTMESİ: Bu fiyat sorgusu fromStop/toStop'a bağlıydı, trip'e
        // bağlı değildi; önceden döngü içinde her sefer için tekrar tekrar
        // (aynı sonuçla) çalıştırılıyordu. Trip'ten bağımsız olduğu için
        // döngüden önce sadece bir kez hesaplanması yeterli.
        let priceRow = await Price.findOne({
            where: { fromStopId: fromStop.id, toStopId: toStop.id }
        });

        if (!priceRow) {
            priceRow = await Price.findOne({
                where: { fromStopId: toStop.id, toStopId: fromStop.id, isBidirectional: true }
            });
        }

        const priceAmount =
            (priceRow
                ? priceRow.webPrice ?? priceRow.price1 ?? priceRow.price2 ?? priceRow.price3
                : 0) ?? 0;

        const formattedTrips = [];

        for (const trip of trips) {
            const routeStops = routeStopsMap[trip.routeId];
            if (!routeStops || !routeStops.length) continue;

            const fromRS = routeStops.find(
                (rs) => rs.stopId === fromStop.id
            );
            const toRS = routeStops.find((rs) => rs.stopId === toStop.id);

            if (!fromRS || !toRS) continue;

            // ERP computeRouteStopTimes ile aynı mantık: her durağın duration'ı
            // o durağa varış süresidir; mevcut durağın duration'ı da dahil edilir.
            function getBaseTime(targetRS) {
                let totalMinutes = 0;

                for (const rs of routeStops) {
                    totalMinutes += durationToMinutes(rs.duration);
                    if (rs.order === targetRS.order) break;
                }

                return addMinutes(trip.time, totalMinutes);
            }

            // ERP cumulative offset: önceki durak gecikmeleri de taşınır.
            function getFinalTime(routeStopId, baseTime) {
                let cumulativeOffset = 0;
                for (const rs of routeStops) {
                    const ts = trip.stopTimes?.find(
                        (st) => st.routeStopId === rs.id
                    );
                    if (ts) cumulativeOffset += Number(ts.offsetMinutes) || 0;
                    if (rs.id === routeStopId) break;
                }
                return addMinutes(baseTime, cumulativeOffset);
            }

            const fromBase = getBaseTime(fromRS);
            const fromFinal = getFinalTime(fromRS.id, fromBase);

            const toBase = getBaseTime(toRS);
            const toFinal = getFinalTime(toRS.id, toBase);

            const durationText = calcDuration(fromFinal, toFinal);

            const planBinary =
                (trip.busModel && trip.busModel.planBinary) ||
                (trip.busModel && trip.busModel.plan) ||
                "";

            // --- YENİ EKLENEN KISIM ---
            // Veritabanından satır, sütun ve ham binary verilerini çekiyoruz
            const rowCount = (trip.busModel && trip.busModel.rowCount) || 0;
            const colCount = (trip.busModel && trip.busModel.colCount) || 0;
            const planBinaryRaw = (trip.busModel && trip.busModel.planBinaryRaw) || "";
            // --------------------------

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

            // BURASI GÜNCELLENDİ: Frontend'e giden JSON paketi
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
                busPlanBinaryRaw: planBinaryRaw, // Ekledik
                busPlan,
                rowCount, // Ekledik
                colCount, // Ekledik
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
            error: "Beklenmeyen hata",
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
        // Trip ve RouteStop modellerini de ekledik yeğenim
        const { Ticket, FirmUser, TicketGroup, Trip, RouteStop } = req.models;

        if (!tripId || !fromStopId || !toStopId) {
            return res.status(400).json({
                error: "tripId, fromStopId ve toStopId alanları zorunludur."
            });
        }

        if (!Array.isArray(seatNumbers) || seatNumbers.length === 0) {
            return res.status(400).json({
                error: "En az bir koltuk numarası belirtilmelidir."
            });
        }

        // KOLTUK KİLİTLEME RACE CONDITION DÜZELTMESİ:
        // Önceden "boş koltuk mu?" kontrolü ile "pending bilet oluştur" işlemi
        // arasında transaction/kilit yoktu; iki eşzamanlı istek aynı koltuğu
        // aynı anda boş görüp ikisi de bilet oluşturabiliyordu (double booking).
        // Artık aynı sefer için TÜM koltuk kilitleme işlemleri, Trip satırını
        // (SELECT ... FOR UPDATE ile) kilitleyen bir transaction içinde
        // serileştiriliyor; böylece kontrol+ekleme atomik hale geliyor.
        const occupiedStatuses = ["web", "gotur", "completed", "reservation", "pending"];

        try {
            await req.db.transaction(async (t) => {
                // 1. ADIM: SEFERİ BULUP ROUTE_ID ÜZERİNDEN DOĞRU DURAK ID'LERİNİ ÇÖZELİM
                // (satır kilidi, aynı sefer için eşzamanlı koltuk seçimlerini serileştirir)
                const trip = await Trip.findByPk(tripId, { transaction: t, lock: t.LOCK.UPDATE });
                if (!trip) {
                    const notFoundErr = new Error("Sefer bulunamadı.");
                    notFoundErr.code = "TRIP_NOT_FOUND";
                    throw notFoundErr;
                }

                const [fromRouteStop, toRouteStop] = await Promise.all([
                    RouteStop.findOne({ where: { routeId: trip.routeId, stopId: fromStopId }, transaction: t }),
                    RouteStop.findOne({ where: { routeId: trip.routeId, stopId: toStopId }, transaction: t })
                ]);

                // tickets.fromRouteStopId / toRouteStopId kolonları adı yanıltıcı:
                // ERP ve FK stops.id bekler (routeStops.id değil).
                if (!fromRouteStop || !toRouteStop) {
                    const stopErr = new Error("Seçilen duraklar bu seferin güzergahında bulunamadı.");
                    stopErr.code = "STOPS_NOT_ON_ROUTE";
                    throw stopErr;
                }

                // 2. ADIM: KOLTUKLAR HALA BOŞ MU KONTROL ET! (Trip kilidi altında)
                const existingTickets = await Ticket.findAll({
                    where: {
                        tripId: tripId,
                        seatNo: seatNumbers,
                        status: occupiedStatuses
                    },
                    transaction: t
                });

                if (existingTickets.length > 0) {
                    const takenErr = new Error("Seçtiğiniz koltuklardan biri veya birkaçı az önce satıldı veya işlemde. Lütfen farklı bir koltuk seçin.");
                    takenErr.code = "SEATS_TAKEN";
                    throw takenErr;
                }

                // 3. ADIM: OPSİYON SÜRESİNİ HESAPLA (Şu an + 5 Dakika)
                const now = new Date();
                now.setMinutes(now.getMinutes() + 5);

                const optionDateStr = now.toISOString().split('T')[0];

                const hh = String(now.getHours()).padStart(2, "0");
                const mm = String(now.getMinutes()).padStart(2, "0");
                const optionTimeStr = `${hh}:${mm}`;

                // 4. ADIM: TICKET GROUP OLUŞTUR
                const tg = await TicketGroup.create({ tripId: tripId }, { transaction: t });

                let webUser = await FirmUser.findOne({ where: { username: "WEB" }, transaction: t });

                // 5. ADIM: KOLTUKLARI DURAK BİLGİLERİYLE BİRLİKTE "PENDING" OLARAK KİLİTLE
                for (let i = 0; i < seatNumbers.length; i++) {
                    await Ticket.create({
                        tripId: tripId,
                        ticketGroupId: tg.id,
                        seatNo: seatNumbers[i],
                        gender: genders[i],
                        status: "pending",
                        nationality: "TR",
                        userId: webUser ? webUser.id : null,
                        optionDate: optionDateStr,
                        optionTime: optionTimeStr,
                        fromRouteStopId: fromStopId,
                        toRouteStopId: toStopId
                    }, { transaction: t });
                }

                return tg.id;
            });
        } catch (err) {
            if (err.code === "TRIP_NOT_FOUND") {
                return res.status(404).json({ error: err.message });
            }
            if (err.code === "STOPS_NOT_ON_ROUTE") {
                return res.status(400).json({ error: err.message });
            }
            if (err.code === "SEATS_TAKEN") {
                return res.status(400).json({ error: err.message });
            }
            throw err;
        }

        // 6. ADIM: ÖDEME KAYDINI OLUŞTUR (ortak DB'de yaşadığı için tenant DB
        // transaction'ının dışında; koltuklar zaten yukarıda güvenle kilitlendi)
        const payment = await TicketPayment.create({
            tenantKey: req.tenantKey,
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
            error: "Beklenmeyen hata",
            detail: err.message
        });
    }
};

exports.getPaymentDetail = async (req, res) => {
    try {
        const { Trip, Route, RouteStop, Stop, Price } = req.models;
        const { TicketPayment } = req.commonModels;

        const paymentId = req.params.id;

        // Tenant izolasyonu: TicketPayment ortak DB'de yaşadığından, id'nin
        // yanında tenantKey de eşleşmelidir; aksi halde başka bir firmanın
        // ödeme kaydı görüntülenebilir (cross-tenant IDOR).
        const payment = await TicketPayment.findOne({
            where: { id: paymentId, tenantKey: req.tenantKey }
        });
        if (!payment) {
            return res.status(404).json({ error: "Ödeme bulunamadı." });
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
            return res.status(404).json({ error: "Sefer bulunamadı." });
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
            error: "Beklenmeyen hata",
            detail: err.message
        });
    }
};

exports.paymentComplete = async (req, res) => {
    try {
        const { Ticket, TicketGroup, FirmUser, Price, Stop } = req.models;
        const { TicketPayment } = req.commonModels;

        const { phone, email } = req.body;
        const asReservation = req.body.asReservation === true
            || req.body.asReservation === "true"
            || req.body.mode === "reservation";

        // DÜZELTME 1: Frontend'den veriler "names", "name" veya "name[]" olarak gelebilir.
        // Hepsini yakalayıp ne olursa olsun kopmaz bir diziye (array) çeviriyoruz.
        const safeNames = [].concat(req.body.names || req.body.name || req.body["name[]"] || []);
        const safeSurnames = [].concat(req.body.surnames || req.body.surname || req.body["surname[]"] || []);
        const safeIdNumbers = [].concat(req.body.idNumbers || req.body.idNumber || req.body["idNumber[]"] || []);

        // Tenant izolasyonu: bkz. getPaymentDetail — aksi halde başka bir
        // firmanın ödemesi tamamlanarak koltuklar/biletler tamamen yanlış
        // tenant'ta oluşturulabilirdi.
        const pay = await TicketPayment.findOne({
            where: { id: req.params.id, tenantKey: req.tenantKey }
        });
        if (!pay) return res.status(404).json({ error: "Ödeme kaydı bulunamadı." });

        if (pay.isSuccess) return res.json({ success: true, message: "Bu işlem zaten gerçekleştirilmiş." });

        // RACE CONDITION DÜZELTMESİ: Önceden isSuccess sadece işlemin SONUNDA
        // set ediliyordu; aynı ödeme id'sine eşzamanlı iki tamamlama isteği
        // gelirse ikisi de "henüz tamamlanmadı" görüp bilet oluşturma bloğuna
        // girebiliyor ve mükerrer bilet/PNR üretilebiliyordu. Artık kayıt,
        // sadece hâlâ isSuccess=false olduğu satır güncellenerek atomik olarak
        // "claim" ediliyor (UPDATE ... WHERE isSuccess=false); 0 satır
        // etkilenirse bu isteğin bir yarışı kaybettiği ve işlemin başka bir
        // istek tarafından tamamlandığı anlaşılır.
        const [claimedCount] = await TicketPayment.update(
            { isSuccess: true },
            { where: { id: pay.id, tenantKey: req.tenantKey, isSuccess: false } }
        );

        if (claimedCount === 0) {
            return res.json({ success: true, message: "Bu işlem zaten gerçekleştirilmiş." });
        }

        let ticketGroupId;
        let pnrCode;

        try {
            const result = await req.db.transaction(async (t) => {
                let webUser = await FirmUser.findOne({ where: { username: "WEB" }, transaction: t });

                const tg = await TicketGroup.create({ tripId: pay.tripId }, { transaction: t });

                // --- PNR ÜRETİMİ ---
                const stopsForPnr = await Stop.findAll({ where: { id: [pay.fromStopId, pay.toStopId] }, transaction: t });
                const generatedPnr = await generatePNR(req.models, pay.fromStopId, pay.toStopId, stopsForPnr);

                // --- FİYAT HESAPLAMA ---
                let priceRow = await Price.findOne({
                    where: { fromStopId: pay.fromStopId, toStopId: pay.toStopId },
                    transaction: t
                });

                if (!priceRow) {
                    priceRow = await Price.findOne({
                        where: { fromStopId: pay.toStopId, toStopId: pay.fromStopId, isBidirectional: true },
                        transaction: t
                    });
                }
                const perSeatPrice = priceRow ? (priceRow.webPrice ?? priceRow.price1 ?? priceRow.price2 ?? 0) : 0;

                // DÜZELTME: Sequelize'dan gelen JSON verisi bazen 'String' olarak döner.
                // Array olup olmadığından emin olmak için parse ediyoruz.
                const seatsArray = typeof pay.seatNumbers === "string" ? JSON.parse(pay.seatNumbers) : (pay.seatNumbers || []);
                const gendersArray = typeof pay.genders === "string" ? JSON.parse(pay.genders) : (pay.genders || []);

                for (let i = 0; i < seatsArray.length; i++) {

                    // Eğer frontend'den 3 koltuk alınıp sadece 1 isim geldiyse bile patlamaması için ilk index'i yedek (fallback) yapıyoruz.
                    const pName = safeNames[i] ? safeNames[i].trim() : (safeNames[0] ? safeNames[0].trim() : "");
                    const pSurname = safeSurnames[i] ? safeSurnames[i].trim() : (safeSurnames[0] ? safeSurnames[0].trim() : "");
                    const pIdNumber = safeIdNumbers[i] ? safeIdNumbers[i].trim() : (safeIdNumbers[0] ? safeIdNumbers[0].trim() : "");

                    const existingTicket = await Ticket.findOne({
                        where: {
                            tripId: pay.tripId,
                            seatNo: seatsArray[i],
                            status: "pending"
                        },
                        transaction: t
                    });

                    // EKSİKSİZ TICKET VERİSİ
                    const ticketData = {
                        ticketGroupId: tg.id,
                        status: asReservation ? "reservation" : "web",
                        phoneNumber: phone || null,
                        email: email || null,
                        name: pName ? pName.toLocaleUpperCase("tr-TR") : null,
                        surname: pSurname ? pSurname.toLocaleUpperCase("tr-TR") : null,
                        idNumber: pIdNumber || null,
                        price: perSeatPrice,
                        pnr: generatedPnr,
                        // Rezervasyonda ödeme alınmaz; satışta kart olarak işaretlenir.
                        payment: asReservation ? null : "card",
                    };

                    if (existingTicket) {
                        // Pending bileti web kullanıcısına göre güncelle
                        await existingTicket.update(ticketData, { transaction: t });
                    } else {
                        // Fallback (Pending silindiyse)
                        await Ticket.create({
                            ...ticketData,
                            tripId: pay.tripId,
                            seatNo: seatsArray[i],
                            gender: gendersArray[i],
                            nationality: "TR",
                            userId: webUser ? webUser.id : null,
                            fromRouteStopId: pay.fromStopId,
                            toRouteStopId: pay.toStopId
                        }, { transaction: t });
                    }
                }

                return { ticketGroupId: tg.id, pnrCode: generatedPnr };
            });

            ticketGroupId = result.ticketGroupId;
            pnrCode = result.pnrCode;
        } catch (ticketErr) {
            // Bilet oluşturma başarısız oldu: ödeme kaydını "tamamlanmadı" durumuna
            // geri alan bir telafi (compensating) işlemi ile yeniden denenebilir
            // hale getiriyoruz (aksi halde ödeme "başarılı" ama bilet yok kalırdı).
            await TicketPayment.update(
                { isSuccess: false },
                { where: { id: pay.id, tenantKey: req.tenantKey } }
            );
            throw ticketErr;
        }

        res.json({
            success: true,
            paymentId: pay.id,
            ticketGroupId,
            pnr: pnrCode,
            reservation: asReservation,
        });

    } catch (e) {
        console.error("API_PAYMENT_COMPLETE_ERR:", e);
        res.status(500).json({ error: e.message || "Bilet oluşturulurken hata meydana geldi." });
    }
};

exports.register = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { name, surname, phone, password, email, gender, idNumber } = req.body;

        if (!idNumber || !phone || !password || !name || !surname) {
            return res.status(400).json({ error: "Lütfen tüm zorunlu alanları doldurun." });
        }

        if (idNumber.length !== 11) {
            return res.status(400).json({ error: "Geçersiz Kimlik Numarası." });
        }

        const existing = await Customer.findOne({ where: { idNumber: idNumber } });
        if (existing) {
            return res.status(409).json({ error: "Bu Kimlik Numarasına sahip bir müşteri/kullanıcı zaten var." });
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

        const token = signCustomerToken(customer.id, req.tenantKey);

        res.json({ success: true, user: userObj, token });

    } catch (err) {
        console.error("REGISTER_ERR:", err);
        res.status(500).json({ error: "Kayıt başarısız oldu.", detail: err.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { idNumber, password } = req.body;

        if (!idNumber || !password) {
            return res.status(400).json({ error: "Kimlik Numarası ve şifre zorunludur." });
        }

        const customer = await Customer.findOne({ where: { idNumber: idNumber } });
        if (!customer) {
            return res.status(401).json({ error: "Kullanıcı bulunamadı." });
        }

        if (!customer.password) {
            return res.status(401).json({ error: "Bu kullanıcı için şifre ayarlanmamış." });
        }

        const match = await bcrypt.compare(password, customer.password);
        if (!match) {
            return res.status(401).json({ error: "Hatalı şifre." });
        }

        const userObj = customer.toJSON();
        delete userObj.password;

        const token = signCustomerToken(customer.id, req.tenantKey);

        res.json({ success: true, user: userObj, token });

    } catch (err) {
        console.error("LOGIN_ERR:", err);
        res.status(500).json({ error: "Giriş başarısız.", detail: err.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const { Customer } = req.models;

        // IDOR koruması: URL'deki :id her ne olursa olsun, sadece token'la
        // doğrulanmış müşterinin kendi profiline erişilebilir.
        const authenticatedId = req.customerAuth?.id;
        if (!authenticatedId) {
            return res.status(401).json({ error: "Oturum doğrulanamadı." });
        }

        const customer = await Customer.findByPk(authenticatedId, {
            attributes: { exclude: ['password'] }
        });

        if (!customer) {
            return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        }

        res.json({ success: true, user: customer });
    } catch (err) {
        console.error("GET_PROFILE_ERR:", err);
        res.status(500).json({ error: "Profil bilgisi alınamadı." });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { Customer } = req.models;
        const { name, surname, email, gender, password } = req.body;

        // IDOR koruması: body'den gelen id artık hiç kullanılmıyor; hedef
        // müşteri her zaman doğrulanmış token'dan çözülüyor.
        const authenticatedId = req.customerAuth?.id;
        if (!authenticatedId) {
            return res.status(401).json({ error: "Oturum doğrulanamadı." });
        }

        const customer = await Customer.findByPk(authenticatedId);
        if (!customer) {
            return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        }

        const updateData = {
            name: name ? name.toLocaleUpperCase("tr-TR") : customer.name,
            surname: surname ? surname.toLocaleUpperCase("tr-TR") : customer.surname,
            email: email,
            gender: gender
        };

        if (typeof password === "string" && password.trim() !== "") {
            updateData.password = await bcrypt.hash(password, 10);
        }

        await customer.update(updateData);

        const userObj = customer.toJSON();
        delete userObj.password;

        res.json({ success: true, user: userObj });

    } catch (err) {
        console.error("UPDATE_PROFILE_ERR:", err);
        res.status(500).json({ error: "Güncelleme başarısız.", detail: err.message });
    }
};

exports.getCustomerTickets = async (req, res) => {
    try {
        const { Ticket, Trip, Stop, Route, RouteStop, TripStopTime } = req.models;

        // IDOR koruması: URL'deki :id (T.C. kimlik no) yerine, sadece
        // token'la doğrulanmış müşterinin kendi PK id'si kullanılıyor.
        const authenticatedId = req.customerAuth?.id;
        if (!authenticatedId) {
            return res.status(401).json({ error: "Oturum doğrulanamadı." });
        }

        const tickets = await Ticket.findAll({
            include: [
                {
                    model: req.models.Customer,
                    as: "customer",
                    where: { id: authenticatedId },
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
                                    attributes: ["id", "stopId", "order", "duration"],
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

            // tickets.fromRouteStopId aslında stops.id tutar
            const fromRS = routeStops.find(rs => rs.stopId == ticket.fromRouteStopId);
            let depMinutesToAdd = 0;

            if (fromRS) {
                for (const rs of routeStops) {
                    if (rs.order > fromRS.order) break;
                    depMinutesToAdd += durationToMinutes(rs.duration);
                }
                const offset = trip.stopTimes?.find(st => st.routeStopId == fromRS.id)?.offsetMinutes || 0;
                depMinutesToAdd += offset;

                ticket.fromStopTitle = fromRS.stop?.title;
            }
            ticket.calculatedDeparture = addMinutes(trip.time, depMinutesToAdd);


            const toRS = routeStops.find(rs => rs.stopId == ticket.toRouteStopId);
            let arrMinutesToAdd = 0;

            if (toRS) {
                for (const rs of routeStops) {
                    if (rs.order > toRS.order) break;
                    arrMinutesToAdd += durationToMinutes(rs.duration);
                }
                const offset = trip.stopTimes?.find(st => st.routeStopId == toRS.id)?.offsetMinutes || 0;
                arrMinutesToAdd += offset;

                ticket.toStopTitle = toRS.stop?.title;
            }
            ticket.calculatedArrival = addMinutes(trip.time, arrMinutesToAdd);

            return ticket;
        });

        res.json({ success: true, tickets: processedTickets });

    } catch (err) {
        console.error("GET_TICKETS_ERR:", err);
        res.status(500).json({ error: "Biletler alınamadı.", detail: err.message });
    }
};

exports.cancelTicket = async (req, res) => {
    try {
        const { Ticket } = req.models;
        const { ticketId, action } = req.body;

        const authenticatedId = req.customerAuth?.id;
        if (!authenticatedId) {
            return res.status(401).json({ error: "Oturum doğrulanamadı." });
        }

        const ticket = await Ticket.findByPk(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: "Bilet bulunamadı." });
        }

        // IDOR koruması: sadece biletin sahibi olan müşteri kendi biletini
        // iptal edebilir; başka bir müşterinin ticketId'sini deneyerek
        // (client'tan gelen id'ye güvenilerek) iptal etme engelleniyor.
        if (ticket.customerId !== authenticatedId) {
            return res.status(403).json({ error: "Bu bileti iptal etme yetkiniz yok." });
        }

        const tripDate = new Date(ticket.optionDate + " " + ticket.optionTime);

        const newStatus = action === "refund" ? "refund" : "canceled";

        await ticket.update({ status: newStatus });

        res.json({ success: true, message: "İşlem başarılı." });

    } catch (err) {
        console.error("CANCEL_TICKET_ERR:", err);
        res.status(500).json({ error: "İşlem başarısız oldu." });
    }
};

exports.getTripSeats = async (req, res) => {
    try {
        const { Trip, BusModel, Ticket } = req.models;
        const tripId = req.params.id;

        // Seferi ve otobüs planını çekiyoruz
        const trip = await Trip.findByPk(tripId, {
            include: [{ model: BusModel, as: "busModel" }]
        });

        if (!trip) {
            return res.status(404).json({ error: "Sefer bulunamadı amk, yanlış ID." });
        }

        // Otobüs şeması (1 ve 0'lardan oluşan o string)
        const planBinary = trip.busModel?.planBinary || trip.busModel?.plan || "";

        // Dolu koltukları bulalım (search metodundaki statüleri baz aldım)
        const occupiedStatuses = ["web", "gotur", "completed", "reservation", "pending"];
        const tickets = await Ticket.findAll({
            where: { tripId: tripId, status: occupiedStatuses },
            attributes: ["seatNo", "gender"]
        });

        // Frontend'in kolay okuması için obje formatına çeviriyoruz
        const ticketsMap = {};
        tickets.forEach(tic => {
            if (tic.seatNo) {
                ticketsMap[tic.seatNo] = { gender: tic.gender };
            }
        });

        return res.json({
            success: true,
            busPlanBinary: planBinary,
            tickets: ticketsMap
        });

    } catch (err) {
        console.error("GET_SEATS_ERR:", err);
        return res.status(500).json({ error: "Koltuklar alınırken backend sıçtı.", detail: err.message });
    }
};