(function () {
    const UI_COOKIE = "gtr_ui";
    const TCKN_MAX_LENGTH = 11;

    let selectedSeats = [];
    let selectedTakenSeats = [];
    let currentTripDate = null;
    let currentTripTime = null;
    let currentTripPlaceTime = null;
    let currentTripId = null;
    let currentGroupId = null;
    let currentStop = $("#currentStop").val();
    let currentStopStr = $("#currentStop").find("option:selected").text().trim();
    let fromId = null;
    let toId = null;
    let pendingFormOpen = false;
    let pendingAbortPayload = null;
    let sheetOnClose = null;
    let isMoving = false;
    let movingSeatPNR = null;
    let movingSelectedSeats = [];
    let movingTargetCount = 0;
    let movingToId = null;
    let cancelingSeatPNR = null;
    let loadToken = 0;
    let tripStopsCache = { tripId: null, stops: [] };
    window.permissions = [];

    function getCookieValue(name) {
        const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
        const match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function setUiCookie(value) {
        document.cookie = `${UI_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    }

    $.ajaxSetup({
        beforeSend: function (xhr) {
            const token = getCookieValue("XSRF-TOKEN");
            if (token) xhr.setRequestHeader("X-CSRF-Token", token);
        },
        statusCode: {
            401: function (xhr) {
                let redirectUrl = "/login";
                try {
                    if (xhr.responseJSON && xhr.responseJSON.redirect) {
                        redirectUrl = xhr.responseJSON.redirect;
                    }
                } catch (err) { /* ignore */ }
                window.location.href = redirectUrl;
            }
        }
    });

    $(document).ajaxStart(() => $(".m-loading").addClass("is-on"));
    $(document).ajaxStop(() => $(".m-loading").removeClass("is-on"));

    function escapeHtml(value) {
        if (value === null || value === undefined) return "";
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function toast(message, type) {
        const el = $("<div>").addClass("m-toast").addClass(type || "").text(message || "");
        $(".m-toast-host").append(el);
        setTimeout(() => el.remove(), 3500);
    }

    function ajaxError(xhr, fallback) {
        return (xhr && xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.error))
            || (xhr && xhr.responseText)
            || fallback
            || "İşlem başarısız.";
    }

    function hasPermission(code) {
        return window.permissions.includes(code);
    }

    function pad(num) {
        return String(num).padStart(2, "0");
    }

    function formatDateForRequest(dateInput) {
        if (dateInput instanceof Date) {
            return `${dateInput.getFullYear()}-${pad(dateInput.getMonth() + 1)}-${pad(dateInput.getDate())}`;
        }
        const str = String(dateInput || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const parsed = new Date(str);
        if (Number.isNaN(parsed.getTime())) return str;
        return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    }

    function getTrimmedValue(value) {
        return (value || "").toString().trim();
    }

    function toOnlyDigits(value) {
        return (value || "").replace(/\D/g, "");
    }

    function isValidTckn(value) {
        const digits = toOnlyDigits(value);
        if (digits.length !== TCKN_MAX_LENGTH || digits[0] === "0") return false;
        const nums = digits.split("").map(Number);
        const oddSum = nums[0] + nums[2] + nums[4] + nums[6] + nums[8];
        const evenSum = nums[1] + nums[3] + nums[5] + nums[7];
        const d10 = ((oddSum * 7) - evenSum) % 10;
        const d11 = nums.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
        return nums[9] === d10 && nums[10] === d11;
    }

    function showPanel(id) {
        $(".m-panel").removeClass("is-active");
        $(id).addClass("is-active");
    }

    function openSheet(title, bodyHtml, footHtml, onClose) {
        sheetOnClose = onClose || null;
        $("#mSheetTitle").text(title || "");
        $("#mSheetBody").html(bodyHtml || "");
        $("#mSheetFoot").html(footHtml || "");
        $("#mSheet, .m-sheet-backdrop").removeAttr("hidden");
    }

    async function closeSheet(skipCallback) {
        const cb = sheetOnClose;
        sheetOnClose = null;
        $("#mSheet, .m-sheet-backdrop").attr("hidden", true);
        $("#mSheetBody, #mSheetFoot").empty();
        if (!skipCallback && typeof cb === "function") await cb();
    }

    function parsePendingIdsValue(value) {
        if (value == null || value === "") return [];
        if (Array.isArray(value)) return value.map(String).filter(Boolean);
        const str = String(value).trim();
        if (!str) return [];
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
            if (parsed != null && parsed !== "") return [String(parsed)];
        } catch (err) { /* comma-separated from Pug */ }
        return str.split(",").map(part => part.trim()).filter(Boolean);
    }

    function capturePendingAbort(seats) {
        pendingAbortPayload = {
            pendingIds: parsePendingIdsValue($("#mSheetBody #pendingIds").val()),
            seats: (seats || []).map(String),
            date: currentTripDate,
            time: currentTripTime,
            tripId: currentTripId
        };
    }

    async function dismissOpenSheet() {
        if (pendingFormOpen) {
            await abortPending();
            pendingFormOpen = false;
        }
        await closeSheet(true);
    }

    async function closeOpenTrip() {
        loadToken += 1;
        await dismissOpenSheet();
        if (isMoving) stopMoving();
        currentTripId = null;
        currentTripDate = null;
        currentTripTime = null;
        currentTripPlaceTime = null;
        currentGroupId = null;
        fromId = currentStop;
        selectedSeats = [];
        selectedTakenSeats = [];
        $(".m-busPlan").empty();
        $(".m-ticketops").empty();
        $(".m-tripRows .tripRow").removeClass("selected");
        $("#mTripTitle").text("Sefer");
        $("#mTripMeta").text("");
        syncSelectionBar();
        showPanel("#mTripsPanel");
    }

    function syncSelectionBar() {
        const bar = $(".m-selection-bar");
        if (isMoving) {
            bar.removeAttr("hidden");
            $("#mSelectionLabel").text(`${selectedSeats.length}/${movingTargetCount} hedef koltuk`);
            $("#mSellBtn, #mReserveBtn").hide();
            if (!$("#mMoveConfirmBtn").length) {
                $(".m-selection-actions").append(
                    '<button id="mMoveConfirmBtn" class="btn btn-sm btn-primary" type="button">Transfer et</button>'
                );
            }
            return;
        }
        $("#mMoveConfirmBtn").remove();
        $("#mSellBtn, #mReserveBtn").show();
        if (selectedSeats.length) {
            bar.removeAttr("hidden");
            $("#mSelectionLabel").text(`${selectedSeats.length} koltuk`);
        } else {
            bar.attr("hidden", true);
        }
    }

    function readTripHidden() {
        currentTripDate = $("#tripDate").val() || currentTripDate;
        currentTripTime = $("#tripTime").val() || currentTripTime;
        currentTripPlaceTime = $("#tripPlaceTime").val() || currentTripPlaceTime;
        currentTripId = $("#tripId").val() || currentTripId;
        fromId = $("#fromId").val() || currentStop;
        toId = $("#toId").val() || toId;
    }

    function setTripChrome() {
        const from = getTrimmedValue($("#fromStr").val());
        const to = getTrimmedValue($("#toStr").val());
        $("#mTripTitle").text(from && to ? `${from} → ${to}` : "Sefer");
        const meta = $(".m-busPlan .trip-info-settings p.text-center").first().text().replace(/\s+/g, " ").trim();
        $("#mTripMeta").text(meta);
    }

    async function loadTripsList(dateInput) {
        const date = formatDateForRequest(dateInput);
        try {
            const html = await $.ajax({
                url: "/get-day-trips-list",
                type: "GET",
                data: { date, stopId: currentStop, tripId: currentTripId }
            });
            if (typeof html !== "string") {
                toast((html && html.error) || "Sefer listesi alınamadı.", "error");
                return;
            }
            $(".m-tripRows").html(html);
            bindTripRows();
            if (currentTripId) {
                $(`.m-tripRows .tripRow[data-tripid='${currentTripId}']`).addClass("selected");
            }
        } catch (err) {
            toast(ajaxError(err, "Sefer listesi alınamadı."), "error");
        }
    }

    function bindTripRows() {
        $(".m-tripRows .tripRow").off("click").on("click", function () {
            const $row = $(this);
            loadTrip($row.data("date"), $row.data("time"), $row.data("tripid"));
        });
    }

    async function loadTrip(date, time, tripId) {
        const token = ++loadToken;
        const commonData = { date, time, tripId, stopId: currentStop };
        try {
            const [tripHtml, ticketOpsHtml] = await Promise.all([
                $.ajax({ url: "/get-trip", type: "GET", data: commonData }),
                $.ajax({ url: "/get-ticketops-popup", type: "GET", data: commonData })
            ]);
            if (token !== loadToken) return;
            if (typeof tripHtml !== "string") {
                toast((tripHtml && tripHtml.error) || "Sefer bulunamadı.", "error");
                return;
            }
            $(".m-busPlan").html(tripHtml);
            $(".m-ticketops").html(typeof ticketOpsHtml === "string" ? ticketOpsHtml : "");
            readTripHidden();
            selectedSeats = [];
            selectedTakenSeats = [];
            setTripChrome();
            $(".m-tripRows .tripRow").removeClass("selected");
            $(`.m-tripRows .tripRow[data-tripid='${tripId}']`).addClass("selected");
            showPanel("#mTripPanel");
            syncSelectionBar();
            bindSeats();
        } catch (err) {
            toast(ajaxError(err, "Sefer yüklenemedi."), "error");
        }
    }

    function isTakenSeat($seat) {
        return Boolean($seat.attr("data-created-at"));
    }

    function bindSeats() {
        $(".m-busPlan").off("click.seat").on("click.seat", ".seat:not(.hidden)", function () {
            const $seat = $(this);
            const seatNumber = String($seat.data("seat-number"));
            const taken = isTakenSeat($seat);

            if (isMoving) {
                if (taken) {
                    toast("Transfer için boş koltuk seçin.", "error");
                    return;
                }
                if (selectedSeats.includes(seatNumber)) {
                    selectedSeats = selectedSeats.filter(s => s !== seatNumber);
                    $seat.removeClass("selected");
                } else {
                    if (selectedSeats.length >= movingTargetCount) {
                        toast("Transfer edilecek yolcu sayısından fazla koltuk seçtiniz.", "error");
                        return;
                    }
                    selectedSeats.push(seatNumber);
                    $seat.addClass("selected");
                }
                syncSelectionBar();
                return;
            }

            if (!taken && selectedTakenSeats.length) {
                selectedTakenSeats = [];
                $(".seat").removeClass("selected");
            }
            if (taken && selectedSeats.length) {
                selectedSeats = [];
                $(".seat").removeClass("selected");
            }

            if (taken) {
                const groupId = String($seat.data("group-id") || "");
                selectedSeats = [];
                selectedTakenSeats = [];
                $(".seat").removeClass("selected");
                const seats = [];
                $(".m-busPlan .seat").each(function () {
                    if (String($(this).data("group-id")) === groupId && groupId) {
                        seats.push(String($(this).data("seat-number")));
                        $(this).addClass("selected");
                    }
                });
                if (!seats.length) {
                    seats.push(seatNumber);
                    $seat.addClass("selected");
                }
                selectedTakenSeats = seats;
                currentGroupId = $seat.data("group-id");
                openTakenSheet($seat);
                return;
            }

            if (selectedSeats.includes(seatNumber)) {
                selectedSeats = selectedSeats.filter(s => s !== seatNumber);
                $seat.removeClass("selected");
            } else {
                selectedSeats.push(seatNumber);
                $seat.addClass("selected");
            }
            syncSelectionBar();
        });
    }

    function onlyGenderForSelection() {
        const genders = selectedSeats.map(num => $(`.seat[data-seat-number='${num}']`).data("only-gender")).filter(Boolean);
        if (genders.includes("m") && !genders.includes("f")) return "m";
        if (genders.includes("f") && !genders.includes("m")) return "f";
        return null;
    }

    function destButtons(action, gender) {
        return $(`.m-ticketops .ticket-op-button[data-action='${action}'][data-gender='${gender}']`)
            .filter(function () { return !$(this).hasClass("restricted") && !$(this).prop("disabled"); });
    }

    function openDestSheet(action) {
        const lockedGender = onlyGenderForSelection();
        let gender = lockedGender || "m";
        const render = () => {
            const buttons = destButtons(action, gender);
            if (!buttons.length) {
                toast("Bu işlem için uygun durak yok veya yetkiniz bulunmuyor.", "error");
                return;
            }
            const genderHtml = lockedGender ? "" : `
                <div class="m-gender-row">
                    <button type="button" class="btn btn-sm ${gender === "m" ? "btn-primary" : "btn-outline-primary"} m-gender" data-gender="m">Erkek</button>
                    <button type="button" class="btn btn-sm ${gender === "f" ? "btn-primary" : "btn-outline-primary"} m-gender" data-gender="f">Kadın</button>
                </div>`;
            const list = buttons.map((_, btn) => {
                const $btn = $(btn);
                const stopId = $btn.data("stopId") || $btn.attr("data-stop-id");
                const routeStop = $btn.data("routeStop") || $btn.attr("data-route-stop") || "";
                return `<button type="button" class="m-dest-btn" data-stop-id="${escapeHtml(stopId)}" data-route-stop="${escapeHtml(routeStop)}">${escapeHtml($btn.text())}</button>`;
            }).get().join("");
            openSheet(action === "sell" ? "Satış — varış" : "Rezervasyon — varış", genderHtml + `<div class="m-dest-list">${list}</div>`);
            $("#mSheetBody .m-gender").off("click").on("click", function () {
                gender = $(this).data("gender");
                render();
            });
            $("#mSheetBody .m-dest-btn").off("click").on("click", function () {
                startTicketForm(action, gender, $(this).attr("data-stop-id"), $(this).attr("data-route-stop"));
            });
        };
        render();
    }

    function collectTicketsFromForm(action) {
        const tickets = [];
        const $rows = $("#mSheetBody .ticket-row");
        const takeOnValue = getTrimmedValue($("#mSheetBody .take-on select").val());
        const takeOffValue = getTrimmedValue($("#mSheetBody .take-off select").val());
        const phone = getTrimmedValue($("#mSheetBody .phone input").val());
        const description = getTrimmedValue($("#mSheetBody .description input").val());
        $rows.each(function () {
            const $row = $(this);
            tickets.push({
                seatNumber: $row.find(".seat-number input").val(),
                idNumber: $row.find(".identity input").val(),
                name: $row.find(".name input").val(),
                surname: $row.find(".surname input").val(),
                phoneNumber: phone,
                gender: $row.find(".gender input:checked").val(),
                nationality: $row.find(".nationality select").val(),
                type: $row.find(".type select").val(),
                category: $row.find(".category select").val(),
                optionTime: $("#mSheetBody .reservation-expire input.time").val(),
                optionDate: $("#mSheetBody .reservation-expire input.date").val(),
                price: $row.find(".price input").val(),
                payment: $("#mSheetBody .payment select").val(),
                pnr: $("#mSheetBody .pnr input").val(),
                takeOn: takeOnValue,
                takeOff: takeOffValue,
                description
            });
        });
        return tickets;
    }

    function validateTicketForm(action) {
        const $rows = $("#mSheetBody .ticket-row");
        const phoneValue = getTrimmedValue($("#mSheetBody .phone input").val());
        const requiresPassengerInfo = action === "reservation" || action === "sell" || action === "complete";
        if (requiresPassengerInfo && !phoneValue) {
            toast("Lütfen bir telefon numarası giriniz.", "error");
            return false;
        }
        for (let i = 0; i < $rows.length; i++) {
            const $row = $rows.eq(i);
            if (!getTrimmedValue($row.find(".name input").val())) {
                toast("Lütfen bir isim giriniz.", "error");
                return false;
            }
            if (!getTrimmedValue($row.find(".surname input").val())) {
                toast("Lütfen bir soyisim giriniz.", "error");
                return false;
            }
            if (action === "sell" || action === "complete") {
                const $identity = $row.find(".identity input");
                const idNumberValue = getTrimmedValue($identity.val());
                if (!idNumberValue) {
                    toast("Lütfen kimlik numarası giriniz.", "error");
                    return false;
                }
                const nationalityValue = getTrimmedValue($row.find(".nationality select").val()).toLowerCase() || "tr";
                if (nationalityValue === "tr") {
                    const digits = toOnlyDigits(idNumberValue);
                    if (!isValidTckn(digits)) {
                        toast("Lütfen geçerli bir T.C. Kimlik numarası giriniz.", "error");
                        return false;
                    }
                    $identity.val(digits);
                }
            }
        }
        return true;
    }

    async function abortPending() {
        const payload = pendingAbortPayload;
        pendingAbortPayload = null;
        if (!payload || !payload.pendingIds.length || !payload.seats.length) return;
        try {
            await $.ajax({
                url: "/post-delete-pending-tickets",
                type: "POST",
                data: {
                    seats: JSON.stringify(payload.seats),
                    pendingIds: JSON.stringify(payload.pendingIds),
                    date: payload.date,
                    time: payload.time,
                    tripId: payload.tripId
                }
            });
        } catch (err) { /* still reload */ }
    }

    async function startTicketForm(action, gender, destStopId, destTitle, isTaken) {
        const seatsForForm = isTaken ? selectedTakenSeats : selectedSeats;
        const seatTypes = seatsForForm.map(num => $(`.seat[data-seat-number='${num}']`).data("seat-type"));
        if (!isTaken) {
            fromId = currentStop;
            toId = destStopId;
        }
        try {
            const data = isTaken
                ? {
                    action: "complete",
                    isTaken: true,
                    seatNumbers: seatsForForm,
                    seatTypes,
                    date: currentTripDate,
                    time: currentTripTime,
                    tripId: currentTripId,
                    stopId: currentStop
                }
                : {
                    action,
                    gender,
                    seats: seatsForForm,
                    seatTypes,
                    fromId: currentStop,
                    toId: destStopId,
                    date: currentTripDate,
                    time: currentTripTime,
                    tripId: currentTripId,
                    stopId: currentStop
                };
            const html = await $.ajax({
                url: "/get-ticket-row",
                type: "GET",
                traditional: true,
                data
            });
            if (typeof html !== "string") {
                toast((html && html.message) || "Form alınamadı.", "error");
                return;
            }
            pendingFormOpen = action === "sell" || action === "reservation";
            const label = action === "sell" ? "SATIŞ" : (action === "complete" ? "SATIŞA ÇEVİR" : "REZERVASYON");
            openSheet(
                `${label} — ${currentStopStr} → ${destTitle || ""}`,
                html,
                `<button type="button" class="btn btn-outline-secondary flex-fill m-form-cancel">İptal</button>
                 <button type="button" class="btn btn-primary flex-fill m-form-submit" data-action="${action}">${label}</button>`,
                async () => {
                    if (pendingFormOpen) {
                        await abortPending();
                        pendingFormOpen = false;
                        await reloadCurrent();
                    }
                }
            );
            if (pendingFormOpen) capturePendingAbort(seatsForForm);
            else pendingAbortPayload = null;
            $("#mSheetBody select[data-searchable-select]").removeAttr("data-searchable-select");
        } catch (err) {
            toast(ajaxError(err, "Bilet formu alınamadı."), "error");
        }
    }

    async function submitTicketForm(action) {
        if ((action === "reservation" || action === "sell" || action === "complete") && !validateTicketForm(action)) {
            return;
        }
        const tickets = collectTicketsFromForm(action);
        const selectedFromId = $("#mSheetBody #ticketFormFromId").val() || currentStop;
        const selectedToId = $("#mSheetBody #ticketFormToId").val() || toId;
        try {
            if (action === "complete") {
                await $.ajax({
                    url: "/post-complete-tickets",
                    type: "POST",
                    data: {
                        tickets: JSON.stringify(tickets),
                        tripDate: currentTripDate,
                        tripTime: currentTripTime,
                        fromId: selectedFromId,
                        groupId: currentGroupId,
                        toId: selectedToId,
                        tripId: currentTripId,
                        status: "completed"
                    }
                });
            } else {
                await $.ajax({
                    url: "/post-tickets",
                    type: "POST",
                    data: {
                        pendingIds: $("#mSheetBody #pendingIds").val(),
                        tickets: JSON.stringify(tickets),
                        tripDate: currentTripDate,
                        tripTime: currentTripTime,
                        fromId: selectedFromId,
                        toId: selectedToId,
                        tripId: currentTripId,
                        status: action === "sell" ? "completed" : "reservation"
                    }
                });
            }
            pendingFormOpen = false;
            pendingAbortPayload = null;
            closeSheet(true);
            toast("İşlem tamamlandı.", "success");
            await reloadCurrent();
        } catch (err) {
            toast(ajaxError(err, "Bilet kaydedilemedi."), "error");
        }
    }

    function statusLabel(status) {
        const map = {
            completed: "Satış",
            reservation: "Rezervasyon",
            web: "Web",
            gotur: "Götür",
            pending: "Beklemede"
        };
        return map[status] || status || "";
    }

    function isFlagTrue(value) {
        return value === true || String(value).toLowerCase() === "true";
    }

    function takenActionAllowed($seat, action) {
        const status = $seat.data("status");
        const ownTicket = isFlagTrue($seat.data("is-own-branch-ticket"));
        const ownStop = isFlagTrue($seat.data("is-own-branch-stop"));
        const refundOption = $seat.data("refund-option");
        const optionExpired = refundOption ? new Date(String(refundOption).replace("Z", "")) < new Date() : false;

        if (action === "complete") {
            if (status !== "reservation") return false;
            if (!ownTicket && ownStop && !hasPermission("CONVERT_OTHER_BRANCH_RESERVATION_TO_SALE_IN_OWN_BRANCH")) return false;
            if (!ownTicket && !ownStop && !hasPermission("CONVERT_OTHER_BRANCH_RESERVATION_TO_SALE_IN_OTHER_BRANCH")) return false;
            return true;
        }
        if (action === "delete_pending") {
            return status === "pending";
        }
        if (action === "cancel") {
            if (status !== "reservation") return false;
            if (!ownTicket && ownStop && !hasPermission("CANCEL_OTHER_BRANCH_RESERVATION_OWN_BRANCH")) return false;
            if (!ownTicket && !ownStop && !hasPermission("CANCEL_OTHER_BRANCH_RESERVATION_OTHER_BRANCH")) return false;
            return true;
        }
        if (action === "refund") {
            if (status !== "completed" && status !== "web" && status !== "gotur") return false;
            if (status === "web" && !hasPermission("WEB_TICKET_REFUND")) return false;
            if (status === "gotur" && !hasPermission("GOTUR_TICKET_REFUND")) return false;
            if (optionExpired && !hasPermission("REFUND_EXPIRED_OPTION_TICKET")) return false;
            if (ownTicket && ownStop && !hasPermission("REFUND_OWN_BRANCH_SALES_OWN_BRANCH")) return false;
            if (!ownTicket && !ownStop && !hasPermission("REFUND_OTHER_BRANCH_SALES_OTHER_BRANCH")) return false;
            return true;
        }
        if (action === "move") {
            if (ownStop && !hasPermission("TRANSFER_IN_OWN_BRANCH")) return false;
            if (!ownStop && !hasPermission("TRANSFER_IN_OTHER_BRANCH")) return false;
            if (optionExpired && !hasPermission("TRANSFER_EXPIRED_OPTION_TICKET")) return false;
            return status === "completed" || status === "reservation" || status === "web";
        }
        return false;
    }

    function openTakenSheet($seat) {
        const name = $seat.data("name") || "";
        const phone = $seat.data("phone") || "";
        const from = $seat.data("from") || "";
        const to = $seat.data("to") || "";
        const price = $seat.data("price") || "";
        const pnr = $seat.data("pnr") || "";
        const branch = $seat.data("branch") || "";
        const status = $seat.data("status") || "";
        const seats = selectedTakenSeats.join(", ");
        const actions = [];
        if (takenActionAllowed($seat, "complete")) {
            actions.push('<button type="button" class="btn btn-primary m-taken-act" data-action="complete">Satışa çevir</button>');
        }
        if (takenActionAllowed($seat, "delete_pending")) {
            actions.push('<button type="button" class="btn btn-outline-danger m-taken-act" data-action="delete_pending">İptal</button>');
        }
        if (takenActionAllowed($seat, "cancel")) {
            actions.push('<button type="button" class="btn btn-outline-danger m-taken-act" data-action="cancel">İptal</button>');
        }
        if (takenActionAllowed($seat, "refund")) {
            actions.push('<button type="button" class="btn btn-outline-danger m-taken-act" data-action="refund">İade</button>');
        }
        if (takenActionAllowed($seat, "move")) {
            actions.push('<button type="button" class="btn btn-outline-primary m-taken-act" data-action="move">Transfer</button>');
        }
        openSheet("Yolcu", `
            <dl class="m-pax-grid">
                <dt>Koltuk</dt><dd>${escapeHtml(seats)}</dd>
                <dt>Yolcu</dt><dd>${escapeHtml(name)}</dd>
                <dt>Telefon</dt><dd>${escapeHtml(phone)}</dd>
                <dt>Güzergah</dt><dd>${escapeHtml(from)} → ${escapeHtml(to)}</dd>
                <dt>Fiyat</dt><dd>${price ? escapeHtml(price) + "₺" : "-"}</dd>
                <dt>PNR</dt><dd>${escapeHtml(pnr) || "-"}</dd>
                <dt>Şube</dt><dd>${escapeHtml(branch) || "-"}</dd>
                <dt>Durum</dt><dd>${escapeHtml(statusLabel(status))}</dd>
            </dl>
            <div class="m-action-stack">${actions.join("") || "<p class='text-muted mb-0'>Bu bilet için işlem yetkiniz yok.</p>"}</div>
        `);
        $("#mSheetBody .m-taken-act").on("click", function () {
            handleTakenAction($(this).data("action"), $seat);
        });
    }

    async function handleTakenAction(action, $seat) {
        const pnr = $seat.data("pnr");
        if (action === "complete") {
            await startTicketForm("complete", $seat.data("gender"), null, $seat.data("to") || "", true);
            return;
        }
        if (action === "delete_pending") {
            await deletePendingSeats();
            return;
        }
        if (action === "cancel" || action === "refund") {
            try {
                const html = await $.ajax({
                    url: "/get-cancel-open-ticket",
                    type: "GET",
                    traditional: true,
                    data: {
                        pnr,
                        seats: selectedTakenSeats,
                        date: currentTripDate,
                        time: currentTripTime
                    }
                });
                cancelingSeatPNR = pnr;
                const label = action === "refund" ? "İade" : "İptal";
                openSheet(label, html, `<button type="button" class="btn btn-danger w-100 m-cancel-confirm" data-action="${action}">${label} et</button>`);
                bindCancelBoxes();
            } catch (err) {
                toast(ajaxError(err, "İşlem formu alınamadı."), "error");
            }
            return;
        }
        if (action === "move") {
            await closeSheet(true);
            openMoveTargetSheet(pnr);
        }
    }

    async function deletePendingSeats() {
        const seats = selectedTakenSeats.slice();
        const pendingIds = seats.map(num => {
            const id = $(`.m-busPlan .seat[data-seat-number='${num}']`).data("pending-ticket-id");
            return id == null || id === "" ? null : String(id);
        }).filter(Boolean);
        if (!seats.length || !pendingIds.length) {
            toast("Silinecek bekleyen koltuk bulunamadı.", "error");
            return;
        }
        try {
            await $.ajax({
                url: "/post-delete-pending-tickets",
                type: "POST",
                data: {
                    seats: JSON.stringify(seats),
                    pendingIds: JSON.stringify(pendingIds),
                    date: currentTripDate,
                    time: currentTripTime,
                    tripId: currentTripId
                }
            });
            await closeSheet(true);
            toast("Koltuk kilidi kaldırıldı.", "success");
            await reloadCurrent();
        } catch (err) {
            toast(ajaxError(err, "Koltuk kilidi kaldırılamadı."), "error");
        }
    }

    function openMoveTargetSheet(pnr) {
        openSheet(
            "Bilet transfer",
            `<p class="mb-3">Transfer bu seferde mi, başka seferde mi yapılsın?</p>
             <div class="m-action-stack">
                <button type="button" class="btn btn-primary m-move-choice" data-stay="1">Bu seferde</button>
                <button type="button" class="btn btn-outline-primary m-move-choice" data-stay="0">Başka seferde</button>
             </div>`,
            `<button type="button" class="btn btn-outline-secondary w-100 m-form-cancel">Vazgeç</button>`
        );
        $("#mSheetBody .m-move-choice").on("click", async function () {
            const stayOnTrip = String($(this).data("stay")) === "1";
            await closeSheet(true);
            await startMove(pnr, { stayOnTrip });
        });
    }

    function bindCancelBoxes() {
        selectedTakenSeats = [];
        $("#mSheetBody .ticket-cancel-box").off("click").on("click", function () {
            const $box = $(this);
            const seat = String($box.data("seat-number"));
            $box.toggleClass("selected");
            if ($box.hasClass("selected")) selectedTakenSeats.push(seat);
            else selectedTakenSeats = selectedTakenSeats.filter(s => s !== seat);
        });
        $("#mSheetFoot .m-cancel-confirm").off("click").on("click", async function () {
            if (!selectedTakenSeats.length) {
                toast("Lütfen bilet seçiniz.", "error");
                return;
            }
            try {
                await $.ajax({
                    url: "/post-cancel-ticket",
                    type: "POST",
                    data: {
                        seats: JSON.stringify(selectedTakenSeats),
                        pnr: cancelingSeatPNR,
                        date: currentTripDate,
                        time: currentTripTime
                    }
                });
                closeSheet(true);
                toast("İşlem tamamlandı.", "success");
                await reloadCurrent();
            } catch (err) {
                toast(ajaxError(err, "İşlem başarısız."), "error");
            }
        });
    }

    async function startMove(pnr, options = {}) {
        const stayOnTrip = Boolean(options.stayOnTrip);
        movingSeatPNR = pnr;
        try {
            const html = await $.ajax({
                url: "/get-move-ticket",
                type: "GET",
                data: { pnr, tripId: currentTripId, stopId: currentStop }
            });
            const stops = await $.ajax({
                url: "/get-route-stops-list-moving",
                type: "GET",
                data: { date: currentTripDate, time: currentTripTime, tripId: currentTripId, stopId: currentStop }
            });
            const allowedStops = (stops.arr || []).filter(rs => !rs.isRestricted);
            const optionsHtml = (stops.arr || []).map(rs => {
                if (rs.isRestricted) return `<option value="" disabled>${rs.stopStr}</option>`;
                const selected = String(rs.stopId) === String(toId) ? " selected" : "";
                return `<option value="${rs.stopId}"${selected}>${rs.stopStr}</option>`;
            }).join("");
            movingSelectedSeats = $("<div>").html(typeof html === "string" ? html : "").find(".moving-ticket-button").map((_, el) => String(el.dataset.seatNumber)).get();
            if (!movingSelectedSeats.length) {
                movingSelectedSeats = selectedTakenSeats.slice();
            }
            movingTargetCount = movingSelectedSeats.length || 1;
            movingToId = toId || (allowedStops[0] && allowedStops[0].stopId) || "";
            isMoving = true;
            selectedSeats = [];
            $(".seat").removeClass("selected");
            $(".m-move-banner").remove();
            const bannerText = stayOnTrip
                ? "Transfer: bu seferde boş koltuk seçin"
                : "Transfer: hedef sefer ve boş koltuk seçin";
            $(".m-toolbar").after(`
                <div class="m-move-banner">
                    <div>
                        <div>${bannerText}</div>
                        <select class="form-select form-select-sm mt-1 m-move-to">${optionsHtml}</select>
                    </div>
                    <button type="button" class="btn btn-sm btn-light m-move-cancel">Vazgeç</button>
                </div>`);
            $(".m-move-to").val(movingToId);
            $(document).off("change.mMoveTo").on("change.mMoveTo", ".m-move-to", function () {
                movingToId = $(this).val();
            });
            if (!stayOnTrip) showPanel("#mTripsPanel");
            syncSelectionBar();
            toast(stayOnTrip
                ? "Bu seferde boş koltuk seçip Transfer et’e basın."
                : "Hedef seferi açın, boş koltuk seçip Transfer et’e basın.", "success");
        } catch (err) {
            isMoving = false;
            toast(ajaxError(err, "Transfer başlatılamadı."), "error");
        }
    }

    function stopMoving() {
        isMoving = false;
        movingSeatPNR = null;
        movingSelectedSeats = [];
        movingTargetCount = 0;
        movingToId = null;
        selectedSeats = [];
        $(".m-move-banner").remove();
        $(".seat").removeClass("selected");
        syncSelectionBar();
    }

    async function confirmMove() {
        if (!isMoving) return;
        if (selectedSeats.length !== movingSelectedSeats.length) {
            toast("Seçilen koltuk sayısı, transfer edilecek bilet sayısıyla eşleşmeli.", "error");
            return;
        }
        const destTo = movingToId || $(".m-move-to").val() || toId;
        const $btn = $("#mMoveConfirmBtn");
        if ($btn.prop("disabled")) return;
        $btn.prop("disabled", true).text("Transfer ediliyor…");
        try {
            await $.ajax({
                url: "/post-move-tickets",
                type: "POST",
                data: {
                    pnr: movingSeatPNR,
                    oldSeats: JSON.stringify(movingSelectedSeats),
                    newSeats: JSON.stringify(selectedSeats),
                    newTrip: currentTripId,
                    fromId: currentStop,
                    toId: destTo
                }
            });
            stopMoving();
            toast("Transfer tamamlandı.", "success");
            await reloadCurrent();
        } catch (err) {
            $btn.prop("disabled", false).text("Transfer et");
            toast(ajaxError(err, "Transfer başarısız."), "error");
        }
    }

    async function tripStopsOrdered() {
        if (tripStopsCache.tripId === currentTripId) {
            return tripStopsCache.stops;
        }
        let stops = [];
        try {
            const response = await $.get("/get-trip-stops", { tripId: currentTripId });
            if (Array.isArray(response)) stops = response;
        } catch (err) { /* sıralama olmadan da listelenebilir */ }
        tripStopsCache = { tripId: currentTripId, stops };
        return stops;
    }

    // Koltuk planı bu durak, önceki ve sonraki durakların biletlerini birlikte
    // taşıyor; listede yalnızca bu duraktan ve sonrasından binenler gösterilir.
    function collectPassengers() {
        const skipStatus = ["pending", "canceled", "refund"];
        const passengers = [];
        $(".m-busPlan .seat").each(function () {
            const $seat = $(this);
            const name = getTrimmedValue($seat.data("name"));
            const status = getTrimmedValue($seat.data("status"));
            if (!name || $seat.hasClass("before") || skipStatus.includes(status)) return;
            passengers.push({
                seat: getTrimmedValue($seat.data("seat-number")),
                name,
                phone: getTrimmedValue($seat.data("phone")),
                from: getTrimmedValue($seat.data("from")),
                to: getTrimmedValue($seat.data("to")),
                price: getTrimmedValue($seat.data("price")),
                pnr: getTrimmedValue($seat.data("pnr")),
                branch: getTrimmedValue($seat.data("branch")),
                gender: getTrimmedValue($seat.data("gender")),
                status,
                isAhead: $seat.hasClass("ahead")
            });
        });
        passengers.sort((a, b) => Number(a.seat) - Number(b.seat));
        return passengers;
    }

    function groupPassengersByStop(passengers, orderedStops) {
        const orderOf = new Map();
        orderedStops.forEach((stop, index) => {
            const title = getTrimmedValue(stop && stop.title);
            if (title && !orderOf.has(title)) orderOf.set(title, index);
        });

        const groups = [];
        const byTitle = new Map();
        passengers.forEach(passenger => {
            const title = passenger.from || "-";
            if (!byTitle.has(title)) {
                const group = { title, passengers: [], isCurrent: !passenger.isAhead };
                byTitle.set(title, group);
                groups.push(group);
            }
            const group = byTitle.get(title);
            if (!passenger.isAhead) group.isCurrent = true;
            group.passengers.push(passenger);
        });

        return groups.sort((a, b) => {
            if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
            const orderA = orderOf.has(a.title) ? orderOf.get(a.title) : Number.MAX_SAFE_INTEGER;
            const orderB = orderOf.has(b.title) ? orderOf.get(b.title) : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
            return a.title.localeCompare(b.title, "tr");
        });
    }

    function passengerCardHtml(passenger) {
        const phoneDigits = toOnlyDigits(passenger.phone);
        const phoneHtml = phoneDigits
            ? `<a class="m-pax-phone" href="tel:${escapeHtml(phoneDigits)}">${escapeHtml(passenger.phone)}</a>`
            : "<span class=\"m-pax-muted\">Telefon yok</span>";
        const seatLabel = passenger.seat.length < 2 ? `0${passenger.seat}` : passenger.seat;
        return `
            <article class="m-pax-card ${escapeHtml(passenger.gender)}${passenger.isAhead ? " ahead" : ""}">
                <div class="m-pax-card-top">
                    <span class="m-pax-seat">${escapeHtml(seatLabel)}</span>
                    <span class="m-pax-name">${escapeHtml(passenger.name)}</span>
                    <span class="m-pax-status">${escapeHtml(statusLabel(passenger.status))}</span>
                </div>
                <div class="m-pax-card-row">
                    <span>${escapeHtml(passenger.from)} → ${escapeHtml(passenger.to)}</span>
                    <span class="m-pax-price">${passenger.price ? escapeHtml(passenger.price) + "₺" : "-"}</span>
                </div>
                <div class="m-pax-card-row">
                    ${phoneHtml}
                    <span class="m-pax-muted">${escapeHtml(passenger.pnr || passenger.branch || "")}</span>
                </div>
            </article>`;
    }

    async function openPassengers() {
        if (!currentTripId) return;
        const passengers = collectPassengers();
        if (!passengers.length) {
            openSheet("Yolcu listesi", "<p class=\"text-muted mb-0\">Bu durak ve sonrası için yolcu bulunmuyor.</p>");
            return;
        }
        const groups = groupPassengersByStop(passengers, await tripStopsOrdered());
        const currentCount = passengers.filter(p => !p.isAhead).length;
        const aheadCount = passengers.length - currentCount;
        const summary = `
            <p class="m-pax-summary">
                <strong>${escapeHtml(currentStopStr)}</strong>: ${currentCount} yolcu
                · Sonraki duraklar: ${aheadCount} yolcu
            </p>`;
        const body = groups.map(group => `
            <section class="m-pax-group">
                <h3 class="m-pax-group-head${group.isCurrent ? " is-current" : ""}">
                    <span>${escapeHtml(group.title)}</span>
                    <span class="m-pax-group-count">${group.passengers.length}</span>
                </h3>
                ${group.passengers.map(passengerCardHtml).join("")}
            </section>`).join("");
        openSheet("Yolcu listesi", summary + body);
    }

    async function openRevenues() {
        if (!hasPermission("TRIP_FINANCIAL_DETAILS_VIEW")) return;
        try {
            const revenues = await $.get("/get-trip-revenues", { tripId: currentTripId, stopId: fromId || currentStop });
            const summary = [];
            $(".m-busPlan .trip-incomes-popup .input-group").each(function () {
                const label = $(this).find(".input-group-text").text().trim();
                const vals = $(this).find("input").map((_, el) => $(el).val()).get();
                if (label) summary.push(`<div class="m-revenue-card"><h3>${escapeHtml(label)}</h3><div>${escapeHtml(vals.join(" / "))}</div></div>`);
            });
            const branches = (revenues.branches || []).map(b => `
                <div class="m-revenue-card">
                    <h3>${escapeHtml(b.title || "")}</h3>
                    <div>Durak: ${b.currentCount} / ${b.currentAmount}₺</div>
                    <div>Toplam: ${b.totalCount} / ${b.totalAmount}₺</div>
                </div>`).join("");
            const totals = revenues.totals || {};
            openSheet("Sefer hasılatı", `
                ${summary.join("")}
                <h3 class="h6 mt-3">Şubeler</h3>
                ${branches || "<p class='text-muted'>Kayıt yok.</p>"}
                <div class="m-revenue-card">
                    <h3>Toplam</h3>
                    <div>Durak: ${totals.currentCount || 0} / ${totals.currentAmount || 0}₺</div>
                    <div>Tümü: ${totals.totalCount || 0} / ${totals.totalAmount || 0}₺</div>
                </div>
            `);
        } catch (err) {
            toast(ajaxError(err, "Hasılat alınamadı."), "error");
        }
    }

    async function reloadCurrent() {
        selectedSeats = [];
        selectedTakenSeats = [];
        syncSelectionBar();
        if (currentTripId) {
            await loadTrip(currentTripDate, currentTripTime, currentTripId);
        }
        await loadTripsList(currentTripDate || new Date());
    }

    function updateOnlineBanner() {
        $(".m-offline").prop("hidden", navigator.onLine);
    }

    $(function () {
        try { setUiCookie("m"); } catch (err) { /* ignore */ }
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw-m.js").catch(() => {});
        }

        $.get("/permissions").done(perms => {
            window.permissions = Array.isArray(perms) ? perms : [];
        });

        currentStop = $("#currentStop").val();
        currentStopStr = $("#currentStop").find("option:selected").text().trim();

        // Takvim eklentisi yüklenemezse sefer listesi yine de açılabilsin.
        const onCalendarDateChange = async (dateInput) => {
            await closeOpenTrip();
            await loadTripsList(dateInput);
        };
        try {
            flatpickr("#calendar", {
                locale: "tr",
                defaultDate: new Date(),
                altInput: true,
                altFormat: "d F Y",
                dateFormat: "Y-m-d",
                onChange: function (selectedDates, dateStr) {
                    onCalendarDateChange(dateStr || selectedDates[0]);
                }
            });
        } catch (err) {
            $("#calendar").attr("type", "date").val(formatDateForRequest(new Date())).on("change", function () {
                onCalendarDateChange($(this).val());
            });
        }

        loadTripsList(new Date());

        $("#currentStop").on("change", async function () {
            currentStop = $(this).val();
            currentStopStr = $(this).find("option:selected").text().trim();
            const dateVal = $("#calendar").val() || new Date();
            const openTripId = currentTripId;
            const openTripDate = currentTripDate;
            const openTripTime = currentTripTime;
            const tripWasOpen = $("#mTripPanel").hasClass("is-active");

            if (tripWasOpen) await dismissOpenSheet();
            await loadTripsList(dateVal);

            if (!openTripId) return;

            const $match = $(`.m-tripRows .tripRow[data-tripid='${openTripId}']`);
            if ($match.length && tripWasOpen) {
                await loadTrip(
                    openTripDate || $match.data("date") || dateVal,
                    openTripTime || $match.data("time"),
                    openTripId
                );
            } else if (!$match.length) {
                await closeOpenTrip();
                await loadTripsList(dateVal);
            }
        });

        $("#mBackToTrips").on("click", function () {
            showPanel("#mTripsPanel");
        });

        $("#mSellBtn").on("click", () => openDestSheet("sell"));
        $("#mReserveBtn").on("click", () => openDestSheet("reservation"));
        $(document).on("click", "#mMoveConfirmBtn", confirmMove);
        $(document).on("click", ".m-move-cancel", stopMoving);

        $("#mPaxBtn").on("click", openPassengers);
        $("#mRevenueBtn").on("click", openRevenues);
        $("#mSheetClose, .m-sheet-backdrop").on("click", () => closeSheet());
        $(document).on("click", ".m-form-cancel", () => closeSheet());
        $(document).on("click", ".m-form-submit", function () {
            submitTicketForm($(this).data("action"));
        });

        $(".m-desktop-link").on("click", function (e) {
            e.preventDefault();
            setUiCookie("d");
            const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
            if (standalone) {
                window.open("/", "_blank");
            } else {
                window.location.href = "/";
            }
        });

        $("#mChangePasswordForm").on("submit", async function (e) {
            e.preventDefault();
            const $form = $(this);
            try {
                await $.ajax({
                    url: "/post-change-password",
                    type: "POST",
                    data: {
                        currentPassword: $form.find("[name=currentPassword]").val(),
                        newPassword: $form.find("[name=newPassword]").val(),
                        confirmPassword: $form.find("[name=confirmPassword]").val()
                    }
                });
                toast("Şifre güncellendi. Tekrar giriş yapın.", "success");
                window.location.href = "/login";
            } catch (err) {
                $("#mChangePasswordError").text(ajaxError(err, "Şifre güncellenemedi.")).prop("hidden", false);
            }
        });

        updateOnlineBanner();
        window.addEventListener("online", updateOnlineBanner);
        window.addEventListener("offline", updateOnlineBanner);
    });
})();
