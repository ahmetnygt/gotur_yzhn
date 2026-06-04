const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate sales & refund report as PDF.
 * @param {Array<Object>} rows - ticket rows to print
 * @param {string|stream.Writable} output - file path or writable stream
 * @returns {Promise<void>} resolves when writing finishes
 */
function generateWebTicketsReportByBusDetailed(rows, query, output) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: "landscape" });
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
    const colWidth = fullWidth / items.length;
    const rowY = doc.y;

    items.forEach((it, idx) => {
      const x = xStart + idx * colWidth;

      doc.font('Bold').text(it.label, x, rowY, {
        width: colWidth,
        continued: true
      });

      doc.font('Regular').text(it.value, {
        width: colWidth
      });
    });

    doc.moveDown(0.8);
  };

  // place query information above the title and margins
  // doc.y = doc.page.margins.top - 25;
  // drawSummaryRow([
  //   { label: 'Tarih Aralığı: ', value: `${query.startDate} - ${query.endDate}` },
  // ]);
  // drawSummaryRow([
  //   { label: 'Tip: ', value: query.type == "detailed" ? "Detaylı" : "Özet" },
  //   { label: 'Şube: ', value: query.branch },
  //   { label: 'Kullanıcı: ', value: query.user },
  //   { label: 'Durak: ', value: `${query.from} - ${query.to}` },
  // ]);

  // reset position for title
  doc.y = doc.page.margins.top;
  doc.moveDown();
  const title = 'Otobüslere Göre Web Biletleri'.toLocaleUpperCase();
  doc.font('Bold').fontSize(14);

  const textWidth = doc.widthOfString(title);
  const centerX = (doc.page.width - textWidth) / 2; // sayfa ortası
  doc.text(title, centerX, doc.y);
  doc.moveDown();

  const dataRows = Array.isArray(rows) ? rows : [];

  const safeNumber = value => {
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  };

  const normalizeDateValue = value => {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getTime());
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const formatDateTime = value => {
    const date = normalizeDateValue(value);
    if (!date) return '';
    return dateTimeFormatter.format(date);
  };

  const fmt = value => safeNumber(value).toFixed(2);
  const currency = value => `${fmt(value)}₺`;
  const formatCount = value => {
    const num = safeNumber(value);
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
  };

  const preparedRows = dataRows.map(row => {
    const sale = safeNumber(row.salesTotal ?? row.price ?? row.amount);
    const ticketCount = row.ticketCount != null
      ? safeNumber(row.ticketCount)
      : (row.count != null ? safeNumber(row.count) : 1);
    const goturShare = row.goturIncome != null ? safeNumber(row.goturIncome) : sale * goturCut;
    const firmShare = row.firmIncome != null ? safeNumber(row.firmIncome) : sale * firmCut;
    const branchShare = row.branchIncome != null ? safeNumber(row.branchIncome) : sale * branchCut;
    const busShare = row.busIncome != null ? safeNumber(row.busIncome) : sale - goturShare - firmShare - branchShare;

    return {
      busId: row.busId != null ? row.busId : (row.licensePlate ? `plate:${row.licensePlate}` : 'unknown'),
      licensePlate: row.licensePlate || '-',
      stopTitle: row.stopTitle || row.stop || '',
      routeTitle: row.routeTitle || row.route || '',
      departure: normalizeDateValue(row.departure ?? row.departureTime ?? row.tripDate ?? row.tripTime ?? row.time),
      salesTotal: sale,
      ticketCount,
      goturIncome: goturShare,
      firmIncome: firmShare,
      branchIncome: branchShare,
      busIncome: busShare,
    };
  });

  const createTotals = () => ({
    ticketCount: 0,
    salesTotal: 0,
    goturIncome: 0,
    firmIncome: 0,
    branchIncome: 0,
    busIncome: 0,
  });

  const groupedMap = new Map();
  const totals = createTotals();

  preparedRows.forEach(row => {
    const busKey = row.busId != null ? row.busId : (row.licensePlate ? `plate:${row.licensePlate}` : 'unknown');
    if (!groupedMap.has(busKey)) {
      groupedMap.set(busKey, {
        busId: busKey,
        licensePlate: row.licensePlate || '-',
        rows: [],
        totals: {
          ticketCount: 0,
          salesTotal: 0,
          goturIncome: 0,
          firmIncome: 0,
          branchIncome: 0,
          busIncome: 0,
        },
      });
    }
    const bucket = groupedMap.get(busKey);
    if ((bucket.licensePlate === '-' || !bucket.licensePlate) && row.licensePlate) {
      bucket.licensePlate = row.licensePlate;
    }
    bucket.rows.push(row);
    bucket.totals.ticketCount += row.ticketCount;
    bucket.totals.salesTotal += row.salesTotal;
    bucket.totals.goturIncome += row.goturIncome;
    bucket.totals.firmIncome += row.firmIncome;
    bucket.totals.branchIncome += row.branchIncome;
    bucket.totals.busIncome += row.busIncome;

    totals.ticketCount += row.ticketCount;
    totals.salesTotal += row.salesTotal;
    totals.goturIncome += row.goturIncome;
    totals.firmIncome += row.firmIncome;
    totals.branchIncome += row.branchIncome;
    totals.busIncome += row.busIncome;
  });

  const groupedData = Array.from(groupedMap.values()).sort((a, b) => {
    const plateA = (a.licensePlate || '').toString().toLocaleUpperCase('tr-TR');
    const plateB = (b.licensePlate || '').toString().toLocaleUpperCase('tr-TR');
    return plateA.localeCompare(plateB, 'tr-TR');
  });

  groupedData.forEach(group => {
    group.rows.sort((a, b) => {
      const stopA = (a.stopTitle || '').toLocaleUpperCase('tr-TR');
      const stopB = (b.stopTitle || '').toLocaleUpperCase('tr-TR');
      const stopCompare = stopA.localeCompare(stopB, 'tr-TR');
      if (stopCompare !== 0) return stopCompare;

      if (a.departure && b.departure) {
        const timeDiff = a.departure.getTime() - b.departure.getTime();
        if (timeDiff !== 0) return timeDiff;
      } else if (a.departure && !b.departure) {
        return -1;
      } else if (!a.departure && b.departure) {
        return 1;
      }

      const routeA = (a.routeTitle || '').toLocaleUpperCase('tr-TR');
      const routeB = (b.routeTitle || '').toLocaleUpperCase('tr-TR');
      return routeA.localeCompare(routeB, 'tr-TR');
    });
  });

  doc.font('Regular').fontSize(9);

  drawSummaryRow([
    { label: 'Toplam Bilet Adedi: ', value: formatCount(totals.ticketCount) },
    { label: 'Toplam Satış Tutarı: ', value: currency(totals.salesTotal) },
    { label: 'Toplam Götür Hakedişi: ', value: currency(totals.goturIncome) },
  ]);
  drawSummaryRow([
    { label: 'Toplam Firma Hakedişi: ', value: currency(totals.firmIncome) },
    { label: 'Toplam Şube Hakedişi: ', value: currency(totals.branchIncome) },
    { label: 'Toplam Otobüs Hakedişi: ', value: currency(totals.busIncome) },
  ]);

  doc.moveDown();

  const columns = [
    { key: 'licensePlate', header: 'Plaka', percent: 0.1, align: 'left' },
    { key: 'stopTitle', header: 'Durak', percent: 0.14, align: 'left' },
    { key: 'departure', header: 'Hareket', percent: 0.12, align: 'left' },
    { key: 'routeTitle', header: 'Sefer', percent: 0.18, align: 'left' },
    { key: 'goturIncome', header: 'Götür Payı', percent: 0.08, align: 'right' },
    { key: 'firmIncome', header: 'Firma Payı', percent: 0.08, align: 'right' },
    { key: 'branchIncome', header: 'Şube Payı', percent: 0.08, align: 'right' },
    { key: 'busIncome', header: 'Otobüs Payı', percent: 0.08, align: 'right' },
    { key: 'salesTotal', header: 'Satış Tutarı', percent: 0.09, align: 'right' },
    { key: 'ticketCount', header: 'Bilet Adedi', percent: 0.1, align: 'right' },
  ];

  let y = doc.y;
  let allocatedWidth = 0;
  columns.forEach((col, idx) => {
    if (idx === columns.length - 1) {
      col.w = Math.max(fullWidth - allocatedWidth, 0);
    } else {
      col.w = fullWidth * col.percent;
      allocatedWidth += col.w;
    }
  });

  const headerHeight = 18;
  const minRowHeight = 16;
  const rowPaddingTop = 3;
  const rowPaddingBottom = 3;
  const cellPaddingX = 4;

  const drawHeader = () => {
    doc.font('Bold').fontSize(9);
    let x = xStart;
    columns.forEach(col => {
      doc.rect(x, y, col.w, headerHeight * 1.8).stroke();
      doc.text(col.header, x + cellPaddingX, y + 4, {
        width: Math.max(col.w - cellPaddingX * 2, 0),
        align: 'center',
      });
      x += col.w;
    });
    y += headerHeight * 2;
    doc.font('Regular').fontSize(8);
  };

  const drawRow = values => {
    const heights = columns.map(col => {
      const text = values[col.key] ?? '';
      return doc.heightOfString(String(text), {
        width: Math.max(col.w - cellPaddingX * 2, 0),
      });
    });

    const contentHeight = Math.max(...heights, 0);
    const rowHeight = Math.max(contentHeight + rowPaddingTop + rowPaddingBottom, minRowHeight);

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }

    let x = xStart;
    columns.forEach(col => {
      const text = values[col.key] ?? '';
      const width = Math.max(col.w - cellPaddingX * 2, 0);
      doc.text(String(text), x + cellPaddingX, y + rowPaddingTop, {
        width,
        align: col.align || 'left',
      });
      x += col.w;
    });

    y += rowHeight;
  };

  const drawSeparator = () => {
    const lineY = y + 3;
    if (lineY > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      return;
    }
    doc.moveTo(xStart, lineY).lineTo(xStart + fullWidth, lineY).dash(1, { space: 3 }).stroke();
    doc.undash();
    y = lineY + 3;
  };

  drawHeader();

  if (!groupedData.length) {
    doc.font('Bold').text('Kayıt bulunamadı.', xStart, y + 10);
    doc.font('Regular');
  } else {
    groupedData.forEach((group, groupIndex) => {
      let isFirstRowOfBus = true;
      let currentStopTitle = null;
      let currentStopTotals = createTotals();
      let stopRowIndex = 0;

      const flushCurrentStopTotals = () => {
        if (currentStopTitle === null) return;
        const label = currentStopTitle ? `${currentStopTitle} TOPLAMI` : 'DURAK TOPLAMI';
        doc.font('Bold').fontSize(8);
        drawRow({
          licensePlate: '',
          stopTitle: label,
          departure: '',
          routeTitle: '',
          goturIncome: currency(currentStopTotals.goturIncome),
          firmIncome: currency(currentStopTotals.firmIncome),
          branchIncome: currency(currentStopTotals.branchIncome),
          busIncome: currency(currentStopTotals.busIncome),
          salesTotal: currency(currentStopTotals.salesTotal),
          ticketCount: formatCount(currentStopTotals.ticketCount),
        });
        doc.font('Regular').fontSize(8);
        currentStopTotals = createTotals();
        stopRowIndex = 0;
        currentStopTitle = null;
      };

      group.rows.forEach(row => {
        const stopTitle = row.stopTitle || '';
        if (currentStopTitle === null) {
          currentStopTitle = stopTitle;
        } else if (stopTitle !== currentStopTitle) {
          flushCurrentStopTotals();
          currentStopTitle = stopTitle;
        }

        currentStopTotals.ticketCount += row.ticketCount;
        currentStopTotals.salesTotal += row.salesTotal;
        currentStopTotals.goturIncome += row.goturIncome;
        currentStopTotals.firmIncome += row.firmIncome;
        currentStopTotals.branchIncome += row.branchIncome;
        currentStopTotals.busIncome += row.busIncome;

        doc.font('Regular').fontSize(8);
        drawRow({
          licensePlate: isFirstRowOfBus ? (group.licensePlate || '-') : '',
          stopTitle: stopRowIndex === 0 ? (stopTitle || '') : '',
          departure: formatDateTime(row.departure),
          routeTitle: row.routeTitle || '',
          goturIncome: currency(row.goturIncome),
          firmIncome: currency(row.firmIncome),
          branchIncome: currency(row.branchIncome),
          busIncome: currency(row.busIncome),
          salesTotal: currency(row.salesTotal),
          ticketCount: formatCount(row.ticketCount),
        });

        isFirstRowOfBus = false;
        stopRowIndex += 1;
      });

      flushCurrentStopTotals();

      doc.font('Bold').fontSize(8);
      drawRow({
        licensePlate: '',
        stopTitle: 'GENEL TOPLAM',
        departure: '',
        routeTitle: '',
        goturIncome: currency(group.totals.goturIncome),
        firmIncome: currency(group.totals.firmIncome),
        branchIncome: currency(group.totals.branchIncome),
        busIncome: currency(group.totals.busIncome),
        salesTotal: currency(group.totals.salesTotal),
        ticketCount: formatCount(group.totals.ticketCount),
      });
      doc.font('Regular').fontSize(8);

      if (groupIndex < groupedData.length - 1) {
        drawSeparator();
      }
    });
  }

  // if (aggregatedRows.length) {
  //   const totalRowValues = {
  //     licensePlate: 'GENEL TOPLAM',
  //     ticketCount: totals.ticketCount,
  //     salesTotal: fmt(totals.salesSummary) + '₺',
  //     goturIncome: fmt(totals.goturIncome) + '₺',
  //     firmIncome: fmt(totals.firmIncome) + '₺',
  //     branchIncome: fmt(totals.branchIncome) + '₺',
  //     busIncome: fmt(totals.busIncome) + '₺',
  //   };

  //   if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
  //     doc.addPage();
  //     y = doc.page.margins.top;
  //     drawHeader();
  //   }

  //   doc.font('Bold');
  //   let x = xStart;
  //   columns.forEach(col => {
  //     doc.text(totalRowValues[col.key], x, y + 3, {
  //       width: col.w,
  //       align: 'center',
  //     });
  //     x += col.w;
  //   });
  //   doc.font('Regular');
  //   y += rowHeight + 10;
  // }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = generateWebTicketsReportByBusDetailed;

if (require.main === module) {
  const now = new Date();
  const sample = [
    {
      busId: 1,
      licensePlate: '34 ABC 123',
      stopTitle: 'Bandırma',
      routeTitle: 'Bandırma - Çanakkale',
      departure: now,
      salesTotal: 100,
      ticketCount: 2,
    },
    {
      busId: 1,
      licensePlate: '34 ABC 123',
      stopTitle: 'Biga AVM',
      routeTitle: 'Bandırma - Çanakkale',
      departure: new Date(now.getTime() + 45 * 60000),
      salesTotal: 150,
      ticketCount: 3,
    },
    {
      busId: 2,
      licensePlate: '06 XYZ 456',
      stopTitle: 'Ankara',
      routeTitle: 'Ankara - İzmir',
      departure: now,
      salesTotal: 200,
      ticketCount: 4,
    },
  ];
  generateWebTicketsReportByBusDetailed(sample, {}, 'web_tickets.pdf').then(() => console.log('web_tickets.pdf created'));
}
