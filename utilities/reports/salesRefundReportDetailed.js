const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate sales & refund report as PDF.
 * @param {Array<Object>} rows - ticket rows to print
 * @param {Object} query - filter information
 * @param {string|stream.Writable} output - file path or writable stream
 * @returns {Promise<void>} resolves when writing finishes
 */
function generateSalesRefundReportDetailed(rows, query, output) {
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
  const title = 'Satış ve İadeler Raporu'.toUpperCase();
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
    { label: 'Toplam Satış: ', value: salesCount },
    { label: 'Toplam İade: ', value: refundCount },
    { label: 'Toplam Yolcu: ', value: salesCount - refundCount },
  ]);
  drawSummaryRow([
    { label: 'Toplam Nakit Satış: ', value: fmt(cashSale) + " ₺" },
    { label: 'Toplam Nakit İade: ', value: fmt(cashRefund) + " ₺" },
    { label: 'Toplam Net Nakit: ', value: fmt(cashSale - cashRefund) + " ₺" },
  ]);
  drawSummaryRow([
    { label: 'Toplam KK Satış: ', value: fmt(cardSale) + " ₺" },
    { label: 'Toplam KK İade: ', value: fmt(cardRefund) + " ₺" },
    { label: 'Toplam Net KK: ', value: fmt(cardSale - cardRefund) + " ₺" },
  ]);
  drawSummaryRow([
    { label: 'Toplam WEB Satış: ', value: fmt(webSale) + " ₺" },
    { label: 'Toplam WEB İade: ', value: fmt(webRefund) + " ₺" },
    { label: 'Toplam Net WEB: ', value: fmt(webSale - webRefund) + " ₺" },
  ]);
  drawSummaryRow([
    { label: 'Toplam Puan Satış: ', value: fmt(pointSale) + " ₺" },
    { label: 'Toplam Puan İade: ', value: fmt(pointRefund) + " ₺" },
    { label: 'Toplam Net Puan: ', value: fmt(pointSale - pointRefund) + " ₺" },
  ]);
  drawSummaryRow([
    { label: 'Gidiş Komisyonu: ', value: fmt(outboundComission) + " ₺" },
    { label: 'Dönüş Komisyonu: ', value: fmt(returnComission) + " ₺" },
    { label: 'Toplam Net Tutar: ', value: fmt((cashSale - cashRefund) + (cardSale - cardRefund) + (webSale - webRefund) + (pointSale - pointRefund)) + " ₺" },
  ]);

  doc.moveDown();

  const columns = [
    { key: 'user', header: 'Kullanıcı', w: 70 },
    { key: 'time', header: 'Zaman', w: 60 },
    { key: 'from', header: 'Nereden', w: 60 },
    { key: 'to', header: 'Nereye', w: 60 },
    { key: 'payment', header: 'Ödeme', w: 50 },
    { key: 'action', header: 'İşlem', w: 45 },
    { key: 'seat', header: 'Koltuk', w: 40 },
    { key: 'gender', header: 'C', w: 20 },
    { key: 'pnr', header: 'PNR', w: 60 },
    { key: 'price', header: 'Ücret', w: 40 },
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
  rows.forEach(row => {
    let action;

    switch (row.status) {
      case "completed":
        action = "Satış";
        break;
      case "refund":
        action = "İade";
        break;
      case "web":
        action = "Web Satış";
        break;
      case "web_refund":
        action = "Web İade";
        break;
      default:
        break;
    }

    const rowValues = {
      user: row.user || '',
      time: new Date(row.time).toLocaleString('tr-TR'),
      from: row.from || '',
      to: row.to || '',
      payment: row.payment == "cash" ? "Nakit" : row.payment == "card" ? "Kredi Kartı" : row.payment == "point" ? "Puan" : row.payment == "web" ? "Web" : "",
      action: action || '',
      seat: row.seat != null ? String(row.seat) : '',
      gender: row.gender || '',
      pnr: row.pnr || '',
      price: (row.price != null ? Number(row.price).toFixed(2) + " ₺" : ''),
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

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = generateSalesRefundReportDetailed;

if (require.main === module) {
  const sample = [
    { user: 'Ali', time: new Date(), from: 'ANK', to: 'IST', payment: 'cash', status: 'completed', seat: 1, gender: 'M', pnr: 'ABC123', price: 100 },
    { user: 'Ayse', time: new Date(), from: 'ANK', to: 'BUR', payment: 'card', status: 'refund', seat: 2, gender: 'F', pnr: 'XYZ789', price: 120 },
  ];
  generateSalesRefundReportDetailed(sample, {}, 'sales_refunds.pdf').then(() => console.log('sales_refunds.pdf created'));
}