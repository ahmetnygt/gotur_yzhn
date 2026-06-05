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
  })} ₺`;
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

function generateExternalReturnTicketsReport(data, output) {
  const {
    generatedAt,
    query = {},
    totals = {},
    branches = [],
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
    console.warn('Font could not be loaded, using default:', err.message);
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

  const drawSummarySections = () => {
    const startText = query.startDate || 'Belirtilmedi';
    const endText = query.endDate || 'Belirtilmedi';
    const branchText = query.branch || 'Tümü';
    const userText = query.user || 'Tümü';
    const totalCount = formatCount(totals.count || 0);
    const totalAmount = formatCurrency(totals.amount || 0);

    drawSummaryRow([
      { label: 'Başlangıç', value: formatDateTime(startText) },
      { label: 'Bitiş', value: formatDateTime(endText) },
      { label: 'Rapor Tarihi', value: formatDateTime(generatedAt || new Date()) },
    ]);

    drawSummaryRow([
      { label: 'Şube', value: branchText },
      { label: 'Kullanıcı', value: userText },
      { label: 'Toplam Bilet', value: totalCount },
    ]);

    drawSummaryRow([
      { label: 'Toplam Tutar', value: totalAmount },
    ]);
  };

  const columns = [
    { key: 'branch', label: 'Şube', width: 46, align: 'center' },
    { key: 'user', label: 'Kullanıcı', width: 62, align: 'center' },
    { key: 'transactionDate', label: 'İşlem Tarihi', width: 68, align: 'center' },
    { key: 'tripInfo', label: 'Sefer Bilgisi', width: 158, align: 'center' },
    { key: 'payment', label: 'Ödeme', width: 60, align: 'center' },
    { key: 'gender', label: 'C', width: 36, align: 'center' },
    { key: 'pnr', label: 'PNR', width: 60, align: 'center' },
    { key: 'price', label: 'Ücret', width: 50, align: 'center' },
  ];

  const formatTripInfo = (info) => {
    if (!info) return '';
    const departureTime = formatDateTime(info.departureTime);
    const stops = [info.departureStop, info.arrivalStop].filter(Boolean).join(' - ');
    return [stops, departureTime].filter(Boolean).join(' ');
  };

  const formatColumnValue = (ticket, key) => {
    switch (key) {
      case 'transactionDate':
        return formatDateTime(ticket.transactionDate);
      case 'tripInfo':
        return formatTripInfo(ticket.tripInfo);
      case 'payment':
        return ticket.payment || '';
      case 'gender':
        return ticket.gender || '';
      case 'price':
        return formatCurrency(ticket.price);
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

    doc.moveDown(1);
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
    const titleText = isContinuation ? `${name} (devamı)` : name;
    doc.font('Bold').fontSize(10).text(titleText, xStart, doc.y);
    doc.moveDown(0.3);
    drawTableHeader();
  };

  const title = 'Dış Hat (Dönüş) Biletleri Raporu'.toUpperCase();
  doc.font('Bold').fontSize(14).text(title, xStart, doc.y, {
    width: usableWidth,
    align: 'center',
  });
  doc.moveDown(0.8);
  doc.font('Regular').fontSize(9);

  drawSummarySections();
  doc.moveDown(0.5);

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
    const branchTitle = branch.title || 'Belirtilmeyen Şube';
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
      const userName = user.name || 'Belirtilmeyen Kullanıcı';
      printUserHeader(userName);

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
            printUserHeader(userName, true);
          }
          drawRow(ticket, rowHeight);
        });
      }

      ensureSpace(14);
      doc.font('Bold').fontSize(8).text(
        `${userName} toplam: ${formatCount(user.totals?.count)} bilet | ${formatCurrency(user.totals?.amount)}`,
        xStart,
        doc.y,
      );
      doc.moveDown(1);
      doc.font('Regular').fontSize(9);
    });

    ensureSpace(16);
    doc.font('Bold').fontSize(9).text(
      `${branchTitle} toplam: ${formatCount(branch.totals?.count)} bilet | ${formatCurrency(branch.totals?.amount)}`,
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

module.exports = generateExternalReturnTicketsReport;