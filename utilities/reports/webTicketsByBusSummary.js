const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate sales & refund report as PDF.
 * @param {Array<Object>} rows - ticket rows to print
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

  const aggregateMap = new Map();

  rows.forEach(r => {
    const busId = r.busId || 'unknown';
    const licensePlate = r.licensePlate || '-';
    const amount = Number(r.price) || 0;

    if (!aggregateMap.has(busId)) {
      aggregateMap.set(busId, {
        busId,
        licensePlate,
        ticketCount: 0,
        salesTotal: 0,
        goturIncome: 0,
        firmIncome: 0,
        branchIncome: 0,
        busIncome: 0,
      });
    }

    const bucket = aggregateMap.get(busId);
    bucket.licensePlate = licensePlate; // ensure latest label if missing previously
    bucket.ticketCount += 1;
    bucket.salesTotal += amount;
    const goturShare = amount * goturCut;
    const firmShare = amount * firmCut;
    const branchShare = amount * branchCut;
    const busShare = amount - goturShare - firmShare - branchShare;
    bucket.goturIncome += goturShare;
    bucket.firmIncome += firmShare;
    bucket.branchIncome += branchShare;
    bucket.busIncome += busShare;
  });

  const aggregatedRows = Array.from(aggregateMap.values()).sort((a, b) => {
    const plateA = (a.licensePlate || '').toString().toLocaleUpperCase('tr-TR');
    const plateB = (b.licensePlate || '').toString().toLocaleUpperCase('tr-TR');
    return plateA.localeCompare(plateB, 'tr-TR');
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

  const busCount = aggregatedRows.length;

  const fmt = n => Number(n || 0).toFixed(2);

  doc.font('Regular').fontSize(9);

  drawSummaryRow([
    { label: 'Toplam Bilet Adedi: ', value: totals.ticketCount },
    { label: 'Toplam Satış Tutarı: ', value: fmt(totals.salesSummary) + '₺' },
    { label: 'Toplam Götür Hakedişi: ', value: fmt(totals.goturIncome) + '₺' },
  ]);
  drawSummaryRow([
    { label: 'Toplam Firma Hakedişi: ', value: fmt(totals.firmIncome) + '₺' },
    { label: 'Toplam Şube Hakedişi: ', value: fmt(totals.branchIncome) + '₺' },
    { label: 'Toplam Otobüs Hakedişi: ', value: fmt(totals.busIncome) + '₺' },
  ]);

  doc.moveDown();

  const columns = [
    { key: 'licensePlate', header: 'Plaka', w: 60 },
    { key: 'ticketCount', header: 'Bilet Adedi', w: 70 },
    { key: 'salesTotal', header: 'Satış Tutarı', w: 70 },
    { key: 'goturIncome', header: 'Götür Payı', w: 70 },
    { key: 'firmIncome', header: 'Firma Payı', w: 70 },
    { key: 'branchIncome', header: 'Şube Payı', w: 70 },
    { key: 'busIncome', header: 'Otobüs Payı', w: 70 },
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
        align: 'center'
      });
      x += col.w;
    });
    y += headerHeight;
    doc.font('Regular').fontSize(8);
  };

  drawHeader();

  // table rows
  if (aggregatedRows.length === 0) {
    doc.font('Bold').text('Kayıt bulunamadı.', xStart, y + 10);
    doc.font('Regular');
  }

  aggregatedRows.forEach(row => {
    const rowValues = {
      licensePlate: row.licensePlate,
      ticketCount: row.ticketCount,
      salesTotal: fmt(row.salesTotal) + '₺',
      goturIncome: fmt(row.goturIncome) + '₺',
      firmIncome: fmt(row.firmIncome) + '₺',
      branchIncome: fmt(row.branchIncome) + '₺',
      busIncome: fmt(row.busIncome) + '₺',
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
        align: 'center'
      });
      x += col.w;
    });
    y += rowHeight + 10;
  });

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

module.exports = generateWebTicketsReportByStopSummary;

if (require.main === module) {
  const sample = [
    { busId: 1, licensePlate: '34 ABC 123', price: 100 },
    { busId: 1, licensePlate: '34 ABC 123', price: 150 },
    { busId: 2, licensePlate: '06 XYZ 456', price: 200 },
  ];
  generateWebTicketsReportByStopSummary(sample, {}, 'web_tickets.pdf').then(() => console.log('web_tickets.pdf created'));
}
