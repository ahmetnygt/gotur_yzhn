const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const GENDER_LABELS = {
  f: 'Kadın',
  m: 'Erkek',
};

const STATUS_LABELS = {
  reservation: 'Rez',
  web: 'WEB',
  gotur: 'Götür',
  completed: 'Satış',
  open: 'Açık',
};

const PAYMENT_LABELS = {
  cash: 'Nakit',
  card: 'K.Kartı',
  point: 'Puan',
};

const currencyFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const seatPriceFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '0,00 TL';
  }
  return `${currencyFormatter.format(amount)} TL`;
};

const formatSeatPrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) {
    return '';
  }
  return seatPriceFormatter.format(amount);
};

const toUpper = (value) => (value ? value.toLocaleUpperCase('tr-TR') : '');

function registerFonts(doc) {
  const regularFontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
  const boldFontPath = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

  try {
    doc.registerFont('Regular', regularFontPath);
    doc.registerFont('Bold', boldFontPath);
    doc.font('Regular');
  } catch (err) {
    console.warn('Font yüklenemedi, varsayılan font kullanılacak:', err.message);
  }
}

function drawHeader(doc, header) {
  const leftColumn = [
    { label: 'Kalkış Saati', value: header?.departure || '' },
    { label: 'Plaka No', value: header?.plate || '' },
    { label: 'Varış', value: header?.arrival || '' },
  ];

  const rightColumn = [
    { label: 'Otobüs Sahibi', value: header?.owner || '' },
    { label: 'Vergi Dairesi', value: header?.taxOffice || '' },
    { label: 'Vergi Numarası', value: header?.taxNumber || '' },
  ];

  const leftX = doc.page.margins.left;
  const rightX = doc.page.width / 2 + 10;
  let y = doc.page.margins.top;

  doc.fontSize(9);
  leftColumn.forEach((item, index) => {
    const rowY = y + index * 16;
    doc.font('Bold').text(`${item.label} : `, leftX, rowY, { continued: true });
    doc.font('Regular').text(item.value || '');
  });

  rightColumn.forEach((item, index) => {
    const rowY = y + index * 16;
    doc.font('Bold').text(`${item.label} : `, rightX, rowY, { continued: true });
    doc.font('Regular').text(item.value || '');
  });

  const centerY = y + leftColumn.length * 16 + 6;
  const routeTitle = toUpper(header?.route || '');
  const routeCode = header?.routeCode ? ` (${header.routeCode})` : '';
  const modelTitle = header?.busModel ? ` • ${header.busModel}` : '';

  doc.font('Bold').fontSize(13).text(`${routeTitle}`, leftX, centerY, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: 'center',
  });

  const driverLine = header?.driver ? `Şoför: ${header.driver}` : '';
  if (driverLine) {
    doc.font('Regular').fontSize(9).text(driverLine, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
    });
  }

  doc.moveDown(1.2);
}

function drawSeat(doc, x, y, width, height, seatNumber, seatInfo, options) {
  const padding = 4;
  const innerWidth = width - padding * 2;

  if (seatInfo && options?.highlightByStop) {
    doc.save();
    doc.roundedRect(x, y, width, height, 6);
    doc.restore();
  }

  doc.roundedRect(x, y, width, height, 6).stroke();

  doc.save();
  const seatNumberFontSize = Math.min(height * 0.6, 22);
  const seatNumberText = String(seatNumber);
  doc.font('Bold').fontSize(seatNumberFontSize).fillColor('black');
  if (typeof doc.fillOpacity === 'function') {
    doc.fillOpacity(0.3);
  } else if (typeof doc.opacity === 'function') {
    doc.opacity(0.3);
  }
  const numberHeight = doc.heightOfString(seatNumberText, { width });
  const numberY = y + (height - numberHeight) / 2;
  doc.text(seatNumberText, x, numberY, {
    width,
    align: 'center',
  });
  doc.restore();

  if (seatInfo) {
    const seatPrice = formatSeatPrice(seatInfo.price);
    if (seatPrice) {
      doc.font('Bold').fontSize(9).text(seatPrice + "₺", x + padding, y + padding, {
        width: innerWidth,
        align: 'right',
      });
    }

    let cursorY = y + padding;

    const statusBadge = STATUS_LABELS[seatInfo.status];
    const paymentBadge = PAYMENT_LABELS[seatInfo.payment];
    const badges = [statusBadge, paymentBadge].filter(Boolean).join(' • ');
    if (badges) {
      doc.font('Bold').fontSize(7).text(badges, x + padding, cursorY, {
        width: innerWidth,
        align: 'left',
      });
      cursorY += doc.heightOfString(badges, { width: innerWidth }) + 2;
    }

    const name = seatInfo.name || '';
    if (name) {
      doc.font('Regular').fontSize(8).text(name, x + padding, cursorY, {
        width: innerWidth,
        align: 'left',
      });
      cursorY += doc.heightOfString(name, { width: innerWidth }) + 2;
    }

    const routeLabel = [seatInfo.from, seatInfo.to].filter(Boolean).join(' → ');
    if (routeLabel) {
      doc.font('Regular').fontSize(7).text(routeLabel, x + padding, cursorY, {
        width: innerWidth,
        align: 'left',
      });
      cursorY += doc.heightOfString(routeLabel, { width: innerWidth }) + 2;
    }

    const genderLabel = GENDER_LABELS[seatInfo.gender];
    const infoLine = [genderLabel, seatInfo.pnr ? `PNR: ${seatInfo.pnr}` : '']
      .filter(Boolean)
      .join(' • ');
    if (infoLine) {
      doc.font('Regular').fontSize(6.5).fillColor('#333333').text(infoLine, x + padding, cursorY, {
        width: innerWidth,
        align: 'left',
      });
      doc.fillColor('black');
    }
  }
}

function drawSeatLayout(doc, layout) {
  const plan = Array.isArray(layout?.plan) ? layout.plan : [];
  const columns = layout?.columns || 5;
  const rows = Math.ceil(plan.length / columns) || 0;
  if (!rows || !columns) {
    return;
  }

  const gapX = 8;
  const gapY = 8;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const seatWidth = (usableWidth - gapX * (columns - 1)) / columns;
  const seatHeight = Math.max(seatWidth * 0.50, 36);
  const layoutWidth = columns * seatWidth + gapX * (columns - 1);
  const startX = doc.page.margins.left + (usableWidth - layoutWidth) / 2;
  const startY = doc.y;

  let seatNumber = 1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      const hasSeat = plan[index] === 1 || plan[index] === '1';
      if (!hasSeat) {
        continue;
      }

      const x = startX + col * (seatWidth + gapX);
      const y = startY + row * (seatHeight + gapY);
      const seatInfo = layout?.seats ? layout.seats[seatNumber] : null;
      drawSeat(doc, x, y, seatWidth, seatHeight, seatNumber, seatInfo, layout);
      seatNumber += 1;
    }
  }

  doc.y = startY + rows * (seatHeight + gapY);
}

function drawFooter(doc, footer) {
  if (!footer) {
    return;
  }
  const label = footer?.label ? toUpper(footer.label) : '';
  const count = Number(footer?.count) || 0;
  const amountText = formatCurrency(footer?.amount || 0);

  const summaryText = `${label ? `${label} ` : ''}Toplam Yolcu: ${count}   Toplam Tutar: ${amountText}`;

  // const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  // const footerHeight = doc.heightOfString(summaryText, {
  //   width: contentWidth,
  //   align: 'left',
  // });

  // const bottomY = doc.page.height - doc.page.margins.bottom - footerHeight;
  // if (doc.y > bottomY) {
  //   doc.addPage();
  // }

  // doc.y = Math.max(doc.y, bottomY);
  doc.font('Bold').fontSize(10).text(summaryText, doc.x, doc.y);
  doc.moveDown(1.2);
}

function generateTripSeatPlanReport(data, output) {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const stream = typeof output === 'string'
    ? fs.createWriteStream(output, { flags: 'w' })
    : output;

  doc.pipe(stream);
  registerFonts(doc);

  drawHeader(doc, data?.header || {});
  drawFooter(doc, data?.footer || {});
  drawSeatLayout(doc, data?.layout || {});

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = generateTripSeatPlanReport;
