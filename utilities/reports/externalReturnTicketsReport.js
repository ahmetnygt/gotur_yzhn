const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatCurrency = (value) => {
  const amount = safeNumber(value);
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`;
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

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
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
    const startText = query.startDate || 'Not Specified';
    const endText = query.endDate || 'Not Specified';
    const branchText = query.branch || 'All';
    const userText = query.user || 'All';
    const totalCount = formatCount(totals.count || 0);
    const totalAmount = formatCurrency(totals.amount || 0);

    drawSummaryRow([
      { label: 'Start', value: formatDateTime(startText) },
      { label: 'End', value: formatDateTime(endText) },
      { label: 'Report Date', value: formatDateTime(generatedAt || new Date()) },
    ]);

    drawSummaryRow([
      { label: 'Branch', value: branchText },
      { label: 'User', value: userText },
      { label: 'Total Tickets', value: totalCount },
    ]);

    drawSummaryRow([
      { label: 'Total Amount', value: totalAmount },
    ]);
  };

  const columns = [
    { key: 'branch', label: 'Branch', width: 46, align: 'center' },
    { key: 'user', label: 'User', width: 62, align: 'center' },
    { key: 'transactionDate', label: 'Trans. Date', width: 68, align: 'center' },
    { key: 'tripInfo', label: 'Trip Information', width: 158, align: 'center' },
    { key: 'payment', label: 'Payment', width: 60, align: 'center' },
    { key: 'gender', label: 'G', width: 36, align: 'center' },
    { key: 'pnr', label: 'PNR', width: 60, align: 'center' },
    { key: 'price', label: 'Fee', width: 50, align: 'center' },
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
    const titleText = isContinuation ? `${name} (continued)` : name;
    doc.font('Bold').fontSize(10).text(titleText, xStart, doc.y);
    doc.moveDown(0.3);
    drawTableHeader();
  };

  const title = 'External Region (Return) Tickets Report'.toUpperCase();
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
    doc.font('Bold').fontSize(10).text('No tickets found to list.', xStart, doc.y);
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
    const branchTitle = branch.title || 'Unspecified Branch';
    doc.font('Bold').fontSize(12).text(branchTitle, xStart, doc.y);
    doc.moveDown(0.2);
    doc.font('Regular').fontSize(9).text(
      `Tickets: ${formatCount(branch.totals?.count)} | Amount: ${formatCurrency(branch.totals?.amount)}`,
      xStart,
      doc.y,
    );
    doc.moveDown(0.6);

    const users = Array.isArray(branch.users) ? branch.users : [];
    if (!users.length) {
      ensureSpace(14);
      doc.font('Regular').fontSize(8).text('No records found.', xStart, doc.y);
      doc.moveDown(0.6);
    }

    users.forEach((user) => {
      const userName = user.name || 'Unspecified User';
      printUserHeader(userName);

      const ticketsList = Array.isArray(user.tickets) ? user.tickets : [];

      if (!ticketsList.length) {
        ensureSpace(14);
        doc.font('Regular').fontSize(8).text('No records found.', xStart, doc.y);
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
        `${userName} total: ${formatCount(user.totals?.count)} tickets | ${formatCurrency(user.totals?.amount)}`,
        xStart,
        doc.y,
      );
      doc.moveDown(1);
      doc.font('Regular').fontSize(9);
    });

    ensureSpace(16);
    doc.font('Bold').fontSize(9).text(
      `${branchTitle} total: ${formatCount(branch.totals?.count)} tickets | ${formatCurrency(branch.totals?.amount)}`,
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