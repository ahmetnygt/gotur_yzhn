const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatCurrency = (value) => {
  const amount = safeNumber(value);
  return `${amount.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} TL`;
};

const formatCount = (value) => {
  const num = safeNumber(value);
  return String(Math.round(num));
};

const normalizeDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
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

const formatDateTime = (value) => {
  const date = normalizeDate(value);
  return date ? dateTimeFormatter.format(date) : '';
};

function generateUpcomingTicketsReport(data, output) {
  const {
    generatedAt,
    branches = [],
    totals = {},
    summary = {},
  } = data || {};

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = typeof output === 'string'
    ? fs.createWriteStream(output, { flags: 'w' })
    : output;

  doc.pipe(stream);

  const regularFontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
  const boldFontPath = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

  try {
    doc.registerFont('Regular', regularFontPath);
    doc.registerFont('Bold', boldFontPath);
    doc.font('Regular');
  } catch (err) {
    console.warn('Font yüklenemedi, varsayılan font kullanılacak:', err.message);
  }

  const xStart = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  const ensureSpace = (height) => {
    if (doc.y + height > pageBottom) {
      doc.addPage();
      doc.font('Regular').fontSize(9);
    }
  };

  const overallTotals = {
    count: safeNumber(totals.count),
    amount: safeNumber(totals.amount),
    payments: {
      cash: safeNumber(totals.payments?.cash),
      card: safeNumber(totals.payments?.card),
      point: safeNumber(totals.payments?.point),
      other: safeNumber(totals.payments?.other),
    },
  };

  const title = 'İleri Tarihli Satışlar Raporu'.toLocaleUpperCase('tr-TR');
  doc.font('Bold').fontSize(14).text(title, xStart, doc.y, { width: usableWidth, align: 'center' });
  doc.moveDown(0.8);
  doc.font('Regular').fontSize(9);

  const drawSummaryRow = (items) => {
    if (!items.length) return;
    const colWidth = usableWidth / items.length;
    const rowY = doc.y;

    items.forEach((item, index) => {
      const x = xStart + index * colWidth;
      const label = item.label?.endsWith(':') ? item.label : `${item.label}: `;

      doc.font('Bold').text(label, x, rowY, {
        width: colWidth,
        continued: true,
      });

      doc.font('Regular').text(item.value ?? '', {
        width: colWidth,
      });
    });

    doc.moveDown(0.8);
  };

  const chunk = (arr, size) => {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  };

  const drawSummarySections = (items, perRow) => {
    if (!items.length) return;
    const groups = chunk(items, perRow);
    groups.forEach((group) => {
      ensureSpace(16);
      drawSummaryRow(group);
    });
  };

  const summaryItems = [
    { label: 'Rapor Tarihi', value: formatDateTime(generatedAt || new Date()) },
    { label: 'Toplam Bilet', value: formatCount(overallTotals.count) },
    { label: 'Toplam Tutar', value: formatCurrency(overallTotals.amount) },
  ];

  drawSummarySections(summaryItems, summaryItems.length);

  const paymentItems = [
    { label: 'Nakit', value: formatCurrency(overallTotals.payments.cash) },
    { label: 'K.Kartı', value: formatCurrency(overallTotals.payments.card) },
    { label: 'Puan', value: formatCurrency(overallTotals.payments.point) },
  ];

  if (overallTotals.payments.other) {
    paymentItems.push({ label: 'Diğer', value: formatCurrency(overallTotals.payments.other) });
  }

  drawSummarySections(paymentItems, paymentItems.length);
  doc.moveDown(0.5);

  const columns = [
    { key: 'pnr', label: 'PNR', width: 65, align: 'center' },
    { key: 'departure', label: 'Kalkış', width: 110, align: 'center' },
    { key: 'route', label: 'Güzergah', width: 190, align: 'center' },
    { key: 'seat', label: 'Koltuk', width: 40, align: 'center' },
    { key: 'payment', label: 'Ödeme', width: 50, align: 'center' },
    { key: 'price', label: 'Tutar', width: 60, align: 'center' },
  ];

  const formatColumnValue = (ticket, key) => {
    switch (key) {
      case 'departure':
        return formatDateTime(ticket.departure);
      case 'price':
        return formatCurrency(ticket.price);
      case 'seat':
        return ticket.seat ?? '';
      case 'pnr':
      case 'route':
      case 'payment':
      default:
        return ticket[key] ?? '';
    }
  };

  const calculateRowHeight = (ticket) => {
    let height = 0;
    columns.forEach((col) => {
      const text = formatColumnValue(ticket, col.key);
      const textHeight = doc.heightOfString(String(text), {
        width: col.width,
      });
      height = Math.max(height, textHeight + 4);
    });
    return height;
  };

  const drawTableHeader = () => {
    ensureSpace(20);
    const headerY = doc.y;
    let x = xStart;

    doc.font('Bold').fontSize(8);
    columns.forEach((col) => {
      doc.rect(x, headerY - 2, col.width, 16).stroke();
      doc.text(col.label, x, headerY, {
        width: col.width,
        align: col.align || 'left',
      });
      x += col.width;
    });

    doc.moveDown(0.3);
    // doc.moveTo(xStart, doc.y).lineTo(xStart + usableWidth, doc.y).stroke();
    doc.moveDown(0.4);
    doc.font('Regular').fontSize(8);
  };

  const drawRow = (ticket, rowHeight) => {
    const rowY = doc.y;
    let rowBottom = rowY;
    let x = xStart;

    columns.forEach((col) => {
      const value = formatColumnValue(ticket, col.key);
      doc.text(String(value), x, rowY, {
        width: col.width,
        align: col.align || 'left',
      });
      rowBottom = Math.max(rowBottom, doc.y);
      doc.x = xStart;
      doc.y = rowY;
      x += col.width;
    });

    doc.y = Math.max(rowBottom + 2, rowY + rowHeight);
  };

  const printUserHeader = (name, isContinuation = false) => {
    ensureSpace(18);
    const titleText = isContinuation ? `${name} (devam)` : name;
    doc.font('Bold').fontSize(10).text(titleText, xStart, doc.y);
    doc.moveDown(0.3);
    drawTableHeader();
  };

  if (!branches.length) {
    ensureSpace(20);
    doc.font('Bold').fontSize(10).text('Listelenecek bilet bulunamadı.', xStart, doc.y);
    doc.end();
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  branches.forEach((branch, branchIndex) => {
    if (branchIndex > 0) {
      doc.moveDown(0.5);
    }

    ensureSpace(24);
    const branchTitle = branch.title || 'Belirtilmemiş Şube';
    doc.font('Bold').fontSize(12).text(branchTitle, xStart, doc.y);
    doc.moveDown(0.2);
    doc.font('Regular').fontSize(9).text(
      `Bilet: ${formatCount(branch.totals?.count)} | Tutar: ${formatCurrency(branch.totals?.amount)}`,
      xStart,
      doc.y,
    );
    doc.moveDown(0.6);

    const users = Array.isArray(branch.users) ? branch.users : [];
    if (!users.length) {
      ensureSpace(14);
      doc.font('Regular').fontSize(8).text('Kayıt bulunamadı.', xStart, doc.y);
      doc.moveDown(0.6);
    }

    users.forEach((user) => {
      printUserHeader(user.name || 'Belirtilmemiş Kullanıcı');

      const ticketsList = Array.isArray(user.tickets) ? user.tickets : [];

      if (!ticketsList.length) {
        ensureSpace(14);
        doc.font('Regular').fontSize(8).text('Kayıt bulunamadı.', xStart, doc.y);
        doc.moveDown(0.6);
      } else {
        ticketsList.forEach((ticket) => {
          const rowHeight = calculateRowHeight(ticket);
          if (doc.y + rowHeight > pageBottom) {
            doc.addPage();
            printUserHeader(user.name || 'Belirtilmemiş Kullanıcı', true);
          }
          drawRow(ticket, rowHeight);
        });
      }

      ensureSpace(14);
      doc.font('Bold').fontSize(8).text(
        `Kullanıcı Toplamı: ${formatCount(user.totals?.count)} bilet | ${formatCurrency(user.totals?.amount)}`,
        xStart,
        doc.y,
      );
      doc.moveDown(1);
      doc.font('Regular').fontSize(9);
    });

    ensureSpace(16);
    doc.font('Bold').fontSize(9).text(
      `Şube Toplamı: ${formatCount(branch.totals?.count)} bilet | ${formatCurrency(branch.totals?.amount)}`,
      xStart,
      doc.y,
    );
    doc.moveDown(1);
    doc.font('Regular').fontSize(9);
  });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = generateUpcomingTicketsReport;
