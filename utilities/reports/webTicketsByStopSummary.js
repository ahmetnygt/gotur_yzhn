const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate web ticket summary grouped by stop as PDF.
 * @param {Array<Object>} rows - ticket rows to print
 * @param {Object} query - query metadata for report header
 * @param {string|stream.Writable} output - file path or writable stream
 * @returns {Promise<void>} resolves when writing finishes
 */
function generateWebTicketsReportByStopSummary(rows, query, output) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = typeof output === 'string' ? fs.createWriteStream(output, { flags: 'w' }) : output;
  doc.pipe(stream);

  const regularFontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
  const boldFontPath = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');
  try {
    doc.registerFont('Regular', regularFontPath);
    doc.registerFont('Bold', boldFontPath);
    doc.font('Regular');
  } catch (e) {
    console.warn('Font yüklenemedi, varsayılan font kullanılacak:', e.message);
  }

  const goturCut = 0.1;
  const firmCut = 0.05;
  const branchCut = 0.05;

  const xStart = doc.page.margins.left;
  const fullWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Regular').fontSize(9);

  const drawSummaryRow = items => {
    if (!items.length) return;
    const colWidth = fullWidth / items.length;
    const rowY = doc.y;

    items.forEach((it, idx) => {
      const x = xStart + idx * colWidth;

      doc.font('Bold').text(it.label, x, rowY, {
        width: colWidth,
        continued: true,
      });

      doc.font('Regular').text(it.value, {
        width: colWidth,
      });
    });

    doc.moveDown(0.8);
  };

  doc.y = doc.page.margins.top;
  doc.moveDown();
  const title = 'Duraklara Göre Web Biletleri'.toLocaleUpperCase('tr-TR');
  doc.font('Bold').fontSize(14);

  const textWidth = doc.widthOfString(title);
  const centerX = Math.max(xStart, (doc.page.width - textWidth) / 2);
  doc.text(title, centerX, doc.y);
  doc.moveDown();

  const list = Array.isArray(rows) ? rows : [];
  const aggregateMap = new Map();

  const parseNumber = value => {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const pickFirstNumber = values => {
    for (const value of values) {
      const num = parseNumber(value);
      if (num !== null) return num;
    }
    return null;
  };

  const extractStopTitle = row => {
    const candidates = [
      row.stopTitle,
      row.stop,
      row.stopName,
      row.fromTitle,
      row.from,
      row.fromStop,
      row.fromPlaceString,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    const fallbackId = pickFirstNumber([
      row.stopId,
      row.routeStopId,
      row.fromRouteStopId,
      row.fromStopId,
    ]);
    if (fallbackId !== null) return String(fallbackId);
    return '-';
  };

  const extractStopKey = row => {
    const candidates = [
      row.stopId,
      row.routeStopId,
      row.fromRouteStopId,
      row.fromStopId,
      row.stopKey,
      row.stopCode,
    ];
    for (const candidate of candidates) {
      if (candidate === 0) return '0';
      if (candidate !== undefined && candidate !== null && candidate !== '') {
        return String(candidate);
      }
    }
    const title = extractStopTitle(row);
    return title && title !== '-' ? title : 'unknown';
  };

  list.forEach(row => {
    const stopKey = extractStopKey(row);
    const stopTitle = extractStopTitle(row);

    if (!aggregateMap.has(stopKey)) {
      aggregateMap.set(stopKey, {
        stopKey,
        stopTitle: stopTitle || '-',
        ticketCount: 0,
        salesTotal: 0,
        goturIncome: 0,
        firmIncome: 0,
        branchIncome: 0,
        busIncome: 0,
      });
    }

    const bucket = aggregateMap.get(stopKey);
    if ((!bucket.stopTitle || bucket.stopTitle === '-') && stopTitle && stopTitle !== '-') {
      bucket.stopTitle = stopTitle;
    }

    const ticketCountValue = pickFirstNumber([
      row.ticketCount,
      row.count,
      row.quantity,
      row.qty,
    ]);
    const ticketCount = ticketCountValue !== null && ticketCountValue > 0 ? ticketCountValue : 1;

    const explicitTotal = pickFirstNumber([
      row.salesTotal,
      row.total,
      row.totalAmount,
      row.amount,
      row.grossTotal,
      row.netTotal,
    ]);

    let saleAmount = explicitTotal;
    if (saleAmount === null) {
      const unitPrice = pickFirstNumber([
        row.price,
        row.ticketPrice,
        row.fare,
        row.netPrice,
        row.amountPerTicket,
      ]);
      saleAmount = unitPrice !== null ? unitPrice * ticketCount : 0;
    }

    const goturShareValue = pickFirstNumber([
      row.goturIncome,
      row.goturShare,
      row.goturPay,
    ]);
    const firmShareValue = pickFirstNumber([
      row.firmIncome,
      row.firmShare,
      row.firmPay,
    ]);
    const branchShareValue = pickFirstNumber([
      row.branchIncome,
      row.branchShare,
      row.branchPay,
    ]);
    const busShareValue = pickFirstNumber([
      row.busIncome,
      row.busShare,
      row.busPay,
    ]);

    const goturShare = goturShareValue !== null ? goturShareValue : saleAmount * goturCut;
    const firmShare = firmShareValue !== null ? firmShareValue : saleAmount * firmCut;
    const branchShare = branchShareValue !== null ? branchShareValue : saleAmount * branchCut;
    const busShare = busShareValue !== null ? busShareValue : saleAmount - goturShare - firmShare - branchShare;

    bucket.ticketCount += ticketCount;
    bucket.salesTotal += saleAmount;
    bucket.goturIncome += goturShare;
    bucket.firmIncome += firmShare;
    bucket.branchIncome += branchShare;
    bucket.busIncome += busShare;
  });

  const aggregatedRows = Array.from(aggregateMap.values()).sort((a, b) => {
    const stopA = (a.stopTitle || '').toString().toLocaleUpperCase('tr-TR');
    const stopB = (b.stopTitle || '').toString().toLocaleUpperCase('tr-TR');
    return stopA.localeCompare(stopB, 'tr-TR');
  });

  const totals = aggregatedRows.reduce((acc, row) => {
    acc.ticketCount += row.ticketCount;
    acc.salesSummary += row.salesTotal;
    acc.goturIncome += row.goturIncome;
    acc.firmIncome += row.firmIncome;
    acc.branchIncome += row.branchIncome;
    acc.busIncome += row.busIncome;
    return acc;
  }, {
    ticketCount: 0,
    salesSummary: 0,
    goturIncome: 0,
    firmIncome: 0,
    branchIncome: 0,
    busIncome: 0,
  });

  const fmtCurrency = value => `${Number(value || 0).toFixed(2)}₺`;
  const fmtNumber = value => {
    const num = Number(value);
    if (Number.isNaN(num)) return '0';
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(2);
  };

  doc.font('Regular').fontSize(9);

  drawSummaryRow([
    { label: 'Toplam Bilet Adedi: ', value: fmtNumber(totals.ticketCount) },
    { label: 'Toplam Satış Tutarı: ', value: fmtCurrency(totals.salesSummary) },
    { label: 'Toplam Götür Hakedişi: ', value: fmtCurrency(totals.goturIncome) },
  ]);
  drawSummaryRow([
    { label: 'Toplam Firma Hakedişi: ', value: fmtCurrency(totals.firmIncome) },
    { label: 'Toplam Şube Hakedişi: ', value: fmtCurrency(totals.branchIncome) },
    { label: 'Toplam Otobüs Hakedişi: ', value: fmtCurrency(totals.busIncome) },
  ]);

  doc.moveDown();

  const columns = [
    { key: 'stopTitle', header: 'Durak', w: 120 },
    { key: 'ticketCount', header: 'Bilet Adedi', w: 60 },
    { key: 'salesTotal', header: 'Satış Tutarı', w: 65 },
    { key: 'goturIncome', header: 'Götür Payı', w: 65 },
    { key: 'firmIncome', header: 'Firma Payı', w: 65 },
    { key: 'branchIncome', header: 'Şube Payı', w: 65 },
    { key: 'busIncome', header: 'Otobüs Payı', w: 65 },
  ];

  let y = doc.y;
  const headerHeight = 16;
  const rowHeight = 14;

  const drawHeader = () => {
    doc.font('Bold').fontSize(9);
    let x = xStart;
    columns.forEach(col => {
      doc.rect(x, y, col.w, headerHeight).stroke();
      doc.text(col.header, x, y + 4, {
        width: col.w,
        align: 'center',
      });
      x += col.w;
    });
    y += headerHeight;
    doc.font('Regular').fontSize(8);
  };

  drawHeader();

  if (aggregatedRows.length === 0) {
    doc.font('Bold').text('Kayıt bulunamadı.', xStart, y + 10);
    doc.font('Regular');
  }

  aggregatedRows.forEach(row => {
    const rowValues = {
      stopTitle: row.stopTitle || '-',
      ticketCount: fmtNumber(row.ticketCount),
      salesTotal: fmtCurrency(row.salesTotal),
      goturIncome: fmtCurrency(row.goturIncome),
      firmIncome: fmtCurrency(row.firmIncome),
      branchIncome: fmtCurrency(row.branchIncome),
      busIncome: fmtCurrency(row.busIncome),
    };

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }

    let x = xStart;
    columns.forEach(col => {
      doc.text(rowValues[col.key], x, y + 3, {
        width: col.w,
        align: 'center',
      });
      x += col.w;
    });
    y += rowHeight + 10;
  });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = generateWebTicketsReportByStopSummary;

if (require.main === module) {
  const sample = [
    { stopId: 1, stopTitle: 'Ankara Otogarı', price: 100 },
    { stopId: 1, stopTitle: 'Ankara Otogarı', price: 150 },
    { stopId: 2, stopTitle: 'İstanbul Esenler', price: 200 },
  ];
  generateWebTicketsReportByStopSummary(sample, {}, 'web_tickets_by_stop.pdf')
    .then(() => console.log('web_tickets_by_stop.pdf created'));
}
