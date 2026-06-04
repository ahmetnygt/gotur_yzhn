const PDFDocument = require('pdfkit');
const fs = require('fs');
const Trip = require('../../models/tripModel');
const Route = require('../../models/routeModel');
const Ticket = require('../../models/ticketModel');
const Cargo = require('../../models/cargoModel');
const Bus = require('../../models/busModel');
const Stop = require('../../models/stopModel');
const RouteStop = require('../../models/routeStopModel');
const path = require('path');
const { Op } = require('sequelize');
const BusAccountCut = require('../../models/busAccountCutModel');
const Staff = require('../../models/staffModel');

function generateAccountReceipt(data, output) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = typeof output === 'string'
    ? fs.createWriteStream(output, { flags: "w" })
    : output;

  doc.pipe(stream);

  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const regularFontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
  const boldFontPath = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');
  try {
    doc.registerFont('Regular', regularFontPath);
    doc.registerFont('Bold', boldFontPath);
    doc.font('Regular');
  } catch (e) {
    console.warn('Font could not be loaded, using default font:', e.message);
  }

  const header = data.header || {};
  const summary = data.summary || {};
  const passengers = data.passengers || [];

  const pageWidth = doc.page.width;

  doc.font('Bold').fontSize(10);
  const dateText = `${header.departure || ''} `;
  const dateWidth = doc.widthOfString(dateText);
  doc.text(dateText, (pageWidth - dateWidth) / 2, 25);

  doc.font('Bold').fontSize(14);
  const seferText = `${header.route || ''}`;
  const seferWidth = doc.widthOfString(seferText);
  doc.text(seferText, (pageWidth - seferWidth) / 2, 40);

  doc.font('Bold').fontSize(12);
  const plakaText = `${header.bus || ''} `;
  const plakaWidth = doc.widthOfString(plakaText);
  doc.text(plakaText, (pageWidth - plakaWidth) / 2, 60);

  doc.fontSize(10);
  let y = 100;
  const leftX = 40;
  const rightX = 330;

  const drawLabelValue = (label, value, x, yy) => {
    doc.font('Bold').text(label, x, yy, { continued: true });
    doc.font('Regular').text(value);
  };

  drawLabelValue('Station : ', header.stop || '', leftX, y);
  drawLabelValue('Driver : ', header.driver || '', rightX, y);
  y += 30;

  const drawSummary = (label, value, x, yy) => {
    doc.font('Bold').text(label, x, yy, { continued: true });
    doc.font('Regular').text(String(value ?? ''));
  };

  drawSummary('Ticket Count : ', summary.ticketCount || 0, leftX, y);
  drawSummary('Deductions : ', summary.cut + "₺" || 0, rightX, y);
  y += 15;
  drawSummary('Total Deducted : ', summary.ticketTotal + "₺" || 0, leftX, y);
  drawSummary('Tip : ', summary.tip + "₺" || 0, rightX, y);
  y += 15;
  drawSummary('Cargo Count : ', summary.cargoCount || 0, leftX, y);
  drawSummary('Cargo Amount : ', summary.cargoTotal + "₺" || 0, rightX, y);
  y += 15;
  drawSummary('Commission : ', summary.commission + "₺" || 0, leftX, y);
  drawSummary('Amount Due : ', summary.needToPay + "₺" || 0, rightX, y);
  y += 15;
  drawSummary('Remaining Amount : ', summary.afterComission + "₺" || 0, leftX, y);
  drawSummary('Paid : ', summary.payed + "₺" || 0, rightX, y);
  y += 15;
  drawSummary('Balance : ', summary.remaining + "₺" || 0, leftX, y);

  y += 40;
  const x0 = doc.page.margins.left;
  const W = availableWidth;
  const unit = W / 10;

  doc.fontSize(9);

  const cols = [
    { key: 'no', label: 'SN', x: x0 + unit * 0, w: unit * 1, align: 'left' },
    { key: 'name', label: 'Full Name', x: x0 + unit * 1, w: unit * 3, align: 'left' },
    { key: 'gender', label: 'F/M', x: x0 + unit * 4, w: unit * 1, align: 'center' },
    { key: 'from', label: 'From', x: x0 + unit * 5, w: unit * 2, align: 'left' },
    { key: 'to', label: 'To', x: x0 + unit * 7, w: unit * 2, align: 'left' },
    { key: 'price', label: 'Price', x: x0 + unit * 9, w: unit * 1, align: 'right' },
  ];

  const pad = 4;
  const headerH = 18;
  const minRowH = 16;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  const useBold = () => { try { doc.font('Bold'); } catch { doc.font('Regular'); } };
  const useReg = () => { try { doc.font('Regular'); } catch { } };

  function drawHeader() {
    useBold();
    cols.forEach(col => {
      doc.rect(col.x, y, col.w, headerH).stroke();
      doc.text(col.label, col.x + pad, y + 4, { width: col.w - pad * 2, align: col.align });
    });
    y += headerH;
    useReg();
  }

  function newPageIfNeeded(nextRowH) {
    if (y + nextRowH > pageBottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
  }

  drawHeader();

  passengers.forEach(p => {
    const row = {
      no: String(p.no ?? ''),
      name: p.name ?? '',
      gender: p.gender ?? '',
      from: p.from ?? '',
      to: p.to ?? '',
      price: String(p.price + "₺" ?? ''),
    };

    const heights = cols.map(col =>
      doc.heightOfString(row[col.key], { width: col.w - pad * 2 })
    );
    const rowH = Math.max(minRowH, ...heights);

    newPageIfNeeded(rowH);

    cols.forEach(col => {
      doc.rect(col.x, y, col.w, rowH).stroke();
      doc.text(row[col.key], col.x + pad, y + 4, {
        width: col.w - pad * 2,
        align: col.align,
      });
    });

    y += rowH;
  });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
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

async function generateAccountReceiptFromDb(tripId, stopId, output, models = {}) {
  const {
    Trip: TripModel = Trip,
    Route: RouteModel = Route,
    RouteStop: RouteStopModel = RouteStop,
    Stop: StopModel = Stop,
    Ticket: TicketModel = Ticket,
    Cargo: CargoModel = Cargo,
    Bus: BusModel = Bus,
    Staff: StaffModel = Staff,
    BusAccountCut: BusAccountCutModel = BusAccountCut,
  } = models;

  const trip = await TripModel.findOne({ where: { id: tripId } });
  if (!trip) throw new Error('Trip not found');

  const route = await RouteModel.findOne({ where: { id: trip.routeId } });
  if (!route) throw new Error('Route not found');

  const routeStops = await RouteStopModel.findAll({ where: { routeId: route.id } });
  const stopIds = [...new Set(routeStops.map(rs => rs.stopId))];
  const stops = stopIds.length
    ? await StopModel.findAll({ where: { id: { [Op.in]: stopIds } } })
    : [];
  const bus = trip.busId ? await BusModel.findOne({ where: { id: trip.busId } }) : null;
  const captain = trip.captainId ? await StaffModel.findOne({ where: { id: trip.captainId } }) : null;

  const currentRouteStop = routeStops.find(rs => rs.stopId == stopId);
  if (!currentRouteStop) {
    throw new Error('Route stop not found for provided stop');
  }

  const routeStopOrder = currentRouteStop.order;

  if (routeStopOrder !== routeStops.length - 1) {
    for (let j = 0; j < routeStops.length; j++) {
      const rs = routeStops[j];
      trip.time = addTime(trip.time, rs.duration)
      if (rs.order == routeStopOrder)
        break
    }
  }

  const tickets = await TicketModel.findAll({
    where: { tripId, fromRouteStopId: stopId, status: { [Op.notIn]: ["canceled", "refund"] } },
    order: [["seatNo", "ASC"]]
  });

  const cargos = await CargoModel.findAll({
    where: { tripId, fromStopId: stopId }
  });

  const passengers = tickets.map(t => ({
    no: t.seatNo,
    price: (t.price || 0).toFixed(2),
    from: stops.find(s => s.id == t.fromRouteStopId)?.title || '',
    to: stops.find(s => s.id == t.toRouteStopId)?.title || '',
    name: [t.name, t.surname].filter(Boolean).join(' '),
    gender: t.gender === 'f' ? 'F' : 'M'
  }));

  const ticketTotal = tickets.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
  const cargoTotal = cargos.reduce((sum, c) => sum + (Number(c.price) || 0), 0);
  const combinedTotal = ticketTotal + cargoTotal;

  const accountCut = await BusAccountCutModel.findOne({ where: { tripId: trip.id, stopId: stopId } });

  const stopTitle = stops.find(s => s.id == stopId)?.title || '';
  let destinationStopTitle = stops.find(s => s.id == route.toStopId)?.title || '';
  if (!destinationStopTitle && route.toStopId) {
    const destinationStop = await StopModel.findOne({ where: { id: route.toStopId } });
    destinationStopTitle = destinationStop?.title || '';
  }
  const totalCut = ['deduction1', 'deduction2', 'deduction3', 'deduction4', 'deduction5']
    .map(key => Number(accountCut?.[key] || 0))
    .reduce((acc, val) => acc + val, 0);
  const commissionAmount = Number(accountCut?.comissionAmount || 0);
  const needToPay = Number(accountCut?.needToPayAmount || 0);
  const payedAmount = Number(accountCut?.payedAmount || 0);
  const tipAmount = Number(accountCut?.tip || 0);
  const afterCommission = combinedTotal - commissionAmount;
  const remainingAmount = needToPay - payedAmount;

  const data = {
    header: {
      stop: stopTitle,
      route: stopTitle && destinationStopTitle ? `${stopTitle} - ${destinationStopTitle}` : destinationStopTitle,
      departure: `${new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(new Date(trip.date))} ${trip.time.split(':').slice(0, 2).join(':')} `,
      arrival: destinationStopTitle,
      bus: bus?.licensePlate || '',
      driver: [captain?.name, captain?.surname].filter(Boolean).join(' ')
    },
    summary: {
      ticketCount: tickets.length,
      ticketTotal: combinedTotal.toFixed(2),
      cargoCount: cargos.length,
      cargoTotal: cargoTotal.toFixed(2),
      commission: commissionAmount.toFixed(2),
      cut: totalCut.toFixed(2),
      tip: tipAmount.toFixed(2),
      needToPay: needToPay.toFixed(2),
      payed: payedAmount.toFixed(2),
      afterComission: afterCommission.toFixed(2),
      remaining: remainingAmount.toFixed(2)
    },
    passengers
  };

  return generateAccountReceipt(data, output);
}

module.exports = { generateAccountReceipt, generateAccountReceiptFromDb };

if (require.main === module) {
  const tripId = process.argv[2];
  const stopId = process.argv[3];
  if (!tripId || !stopId) {
    console.error('Usage: node utilities/accountReceiptPdf.js <tripId> <stopId>');
    process.exit(1);
  }

  generateAccountReceiptFromDb(tripId, stopId, 'account_receipt.pdf')
    .then(() => console.log('account_receipt.pdf created'))
    .catch(err => console.error('Error generating receipt:', err));
}
