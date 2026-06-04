const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate sales & refund report summary as PDF.
 * @param {Array<Object>} rows - ticket rows to print
 * @param {Object} query - filter information
 * @param {string|stream.Writable} output - file path or writable stream
 * @returns {Promise<void>} resolves when writing finishes
 */
function generateSalesRefundReportSummary(rows, query, output) {
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
    console.warn('Font could not be loaded, using default font:', e.message);
  }
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

  // Reset position for title
  doc.y = doc.page.margins.top;
  doc.moveDown();
  const title = 'Sales and Refunds Summary Report'.toUpperCase();
  doc.font('Bold').fontSize(14);

  const textWidth = doc.widthOfString(title);
  const centerX = (doc.page.width - textWidth) / 2;
  doc.text(title, centerX, doc.y);
  doc.moveDown();

  let salesCount = 0;
  let refundCount = 0;
  let cashSale = 0;
  let cashRefund = 0;
  let cardSale = 0;
  let cardRefund = 0;
  let webSale = 0;
  let webRefund = 0;
  let pointSale = 0;
  let pointRefund = 0;
  let outboundComission = 0;
  let returnComission = 0;

  rows.forEach(r => {
    const amount = Number(r.price) || 0;
    if (r.status !== "refund") salesCount++;
    else refundCount++;

    if (r.payment == "cash") {
      if (r.status == "completed") cashSale += amount;
      else if (r.status == "refund") cashRefund += amount;
    }
    else if (r.payment == "card") {
      if (r.status == "completed") cardSale += amount;
      else if (r.status == "refund") cardRefund += amount;
    }
    else if (r.payment == "web") {
      if (r.status == "completed") webSale += amount;
      else if (r.status == "refund") webRefund += amount;
    }
    else if (r.payment == "point") {
      if (r.status == "completed") pointSale += amount;
      else if (r.status == "refund") pointRefund += amount;
    }
  });

  const fmt = n => Number(n || 0).toFixed(2);

  doc.font('Regular').fontSize(9);

  drawSummaryRow([
    { label: 'Total Sales Count: ', value: salesCount },
    { label: 'Total Refund Count: ', value: refundCount },
    { label: 'Total Passenger Count: ', value: salesCount - refundCount },
  ]);
  drawSummaryRow([
    { label: 'Total Cash Sales: ', value: fmt(cashSale) + "$" },
    { label: 'Total Cash Refunds: ', value: fmt(cashRefund) + "$" },
    { label: 'Total Net Cash: ', value: fmt(cashSale - cashRefund) + "$" },
  ]);
  drawSummaryRow([
    { label: 'Total CC Sales: ', value: fmt(cardSale) + "$" },
    { label: 'Total CC Refunds: ', value: fmt(cardRefund) + "$" },
    { label: 'Total Net CC: ', value: fmt(cardSale - cardRefund) + "$" },
  ]);
  drawSummaryRow([
    { label: 'Total WEB Sales: ', value: fmt(webSale) + "$" },
    { label: 'Total WEB Refunds: ', value: fmt(webRefund) + "$" },
    { label: 'Total Net WEB: ', value: fmt(webSale - webRefund) + "$" },
  ]);
  drawSummaryRow([
    { label: 'Total Point Sales: ', value: fmt(pointSale) + "$" },
    { label: 'Total Point Refunds: ', value: fmt(pointRefund) + "$" },
    { label: 'Total Net Point: ', value: fmt(pointSale - pointRefund) + "$" },
  ]);
  drawSummaryRow([
    { label: 'Outbound Commission: ', value: fmt(outboundComission) + "$" },
    { label: 'Return Commission: ', value: fmt(returnComission) + "$" },
    { label: 'Total Net Amount: ', value: fmt((cashSale - cashRefund) + (cardSale - cardRefund) + (webSale - webRefund) + (pointSale - pointRefund)) + "$" },
  ]);

  doc.moveDown();

  const branchMap = {};
  const overallTotals = {
    salesCount: 0,
    refundCount: 0,
    sale: 0,
    refund: 0,
    cash: 0,
    card: 0,
    point: 0,
    commission: 0,
  };
  rows.forEach(r => {
    const branchKey = r.branch || '';
    const userKey = r.user || '';
    if (!branchMap[branchKey]) {
      branchMap[branchKey] = {
        totals: {
          salesCount: 0,
          refundCount: 0,
          sale: 0,
          refund: 0,
          cash: 0,
          card: 0,
          point: 0,
          web: 0,
          commission: 0,
        },
        users: {}
      };
    }
    if (!branchMap[branchKey].users[userKey]) {
      branchMap[branchKey].users[userKey] = {
        salesCount: 0,
        refundCount: 0,
        sale: 0,
        refund: 0,
        cash: 0,
        card: 0,
        point: 0,
        web: 0,
        commission: 0,
      };
    }
    const amount = Number(r.price) || 0;
    const isRefund = r.status === 'refund' || r.status === 'web_refund';
    const userRec = branchMap[branchKey].users[userKey];
    const branchTotals = branchMap[branchKey].totals;
    if (isRefund) {
      userRec.refundCount++;
      userRec.refund += amount;
      branchTotals.refundCount++;
      branchTotals.refund += amount;
      if (r.payment === 'cash') { userRec.cash -= amount; branchTotals.cash -= amount; }
      else if (r.payment === 'card') { userRec.card -= amount; branchTotals.card -= amount; }
      else if (r.payment === 'point') { userRec.point -= amount; branchTotals.point -= amount; }
      else if (r.payment === 'web') { userRec.web -= amount; branchTotals.web -= amount; }
    } else {
      userRec.salesCount++;
      userRec.sale += amount;
      branchTotals.salesCount++;
      branchTotals.sale += amount;
      if (r.payment === 'cash') { userRec.cash += amount; branchTotals.cash += amount; }
      else if (r.payment === 'card') { userRec.card += amount; branchTotals.card += amount; }
      else if (r.payment === 'point') { userRec.point += amount; branchTotals.point += amount; }
      else if (r.payment === 'web') { userRec.web += amount; branchTotals.web += amount; }
    }
  });

  const columns = [
    { key: 'user', header: 'Username', w: 60 },
    { key: 'salesCount', header: 'Sales Qty', w: 50 },
    { key: 'refundCount', header: 'Refund Qty', w: 50 },
    { key: 'sale', header: 'Sales', w: 50 },
    { key: 'cash', header: 'Cash', w: 50 },
    { key: 'card', header: 'Credit Card', w: 50 },
    { key: 'point', header: 'Points', w: 50 },
    { key: 'net', header: 'Net Sales', w: 50 },
    { key: 'refund', header: 'Refund', w: 50 },
    { key: 'commission', header: 'Commission', w: 50 },
  ];

  let y = doc.y;
  const headerHeight = 32;
  const rowHeight = 14;
  const tableWidth = columns.reduce((sum, col) => sum + col.w, 0);

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

  Object.keys(branchMap).forEach(branch => {
    const b = branchMap[branch];
    Object.keys(b.users).forEach(user => {
      const u = b.users[user];
      const rowValues = {
        user,
        salesCount: u.salesCount,
        refundCount: u.refundCount,
        sale: fmt(u.sale) + '$',
        refund: fmt(u.refund) + '$',
        cash: fmt(u.cash) + '$',
        card: fmt(u.card) + '$',
        point: fmt(u.point) + '$',
        net: fmt(u.sale - u.refund) + '$',
        commission: fmt(u.commission) + '$',
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

    const t = b.totals;
    const totalValues = {
      user: `${branch}`,
      salesCount: t.salesCount,
      refundCount: t.refundCount,
      sale: fmt(t.sale) + '$',
      refund: fmt(t.refund) + '$',
      cash: fmt(t.cash) + '$',
      card: fmt(t.card) + '$',
      point: fmt(t.point) + '$',
      net: fmt(t.sale - t.refund) + '$',
      commission: fmt(t.commission) + '$',
    };
    overallTotals.salesCount += t.salesCount;
    overallTotals.refundCount += t.refundCount;
    overallTotals.sale += t.sale;
    overallTotals.refund += t.refund;
    overallTotals.cash += t.cash;
    overallTotals.card += t.card;
    overallTotals.point += t.point;
    overallTotals.commission += t.commission;

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }

    doc.font('Bold');
    let x = xStart;
    columns.forEach(col => {
      doc.text(totalValues[col.key], x, y + 3, {
        width: col.w,
        align: 'center'
      });
      x += col.w;
    });
    doc.font('Regular');
    y += rowHeight + 10;
  });

  if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    y = doc.page.margins.top;
    drawHeader();
  }

  const overallValues = {
    user: 'GRAND TOTAL',
    salesCount: overallTotals.salesCount,
    refundCount: overallTotals.refundCount,
    sale: fmt(overallTotals.sale) + '$',
    refund: fmt(overallTotals.refund) + '$',
    cash: fmt(overallTotals.cash) + '$',
    card: fmt(overallTotals.card) + '$',
    point: fmt(overallTotals.point) + '$',
    net: fmt(overallTotals.sale - overallTotals.refund) + '$',
    commission: fmt(overallTotals.commission) + '$',
  };

  const lineY = Math.max(doc.page.margins.top + headerHeight, y - 5);
  doc.moveTo(xStart, lineY).lineTo(xStart + tableWidth, lineY).stroke();

  doc.font('Bold');
  let x = xStart;
  columns.forEach(col => {
    doc.text(overallValues[col.key], x, y + 3, {
      width: col.w,
      align: 'center'
    });
    x += col.w;
  });
  doc.font('Regular');
  y += rowHeight + 10;

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = generateSalesRefundReportSummary;

if (require.main === module) {
  const sample = [
    { user: 'Ali', time: new Date(), from: 'ANK', to: 'IST', payment: 'cash', status: 'completed', seat: 1, gender: 'M', pnr: 'ABC123', price: 100 },
    { user: 'Ayse', time: new Date(), from: 'ANK', to: 'BUR', payment: 'card', status: 'refund', seat: 2, gender: 'F', pnr: 'XYZ789', price: 120 },
  ];
  generateSalesRefundReportSummary(sample, {}, 'sales_refunds.pdf').then(() => console.log('sales_refunds.pdf created'));
}