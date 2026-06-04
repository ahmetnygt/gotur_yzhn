const PDFDocument = require('pdfkit');
const fs = require('fs');

/**
 * Generate a bus ticket PDF similar to the provided design.
 * The PDF will be created in A4 size with some spacing.
 */
function generateTicket(outputPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(fs.createWriteStream(outputPath));

  // Trip information
  doc.fontSize(12);
  doc.text('Kalk\u0131\u015f Saati : 12/09/2050 05:00', 40, 40);
  doc.text('Plaka No : 18 BCH 859', 40, 60);
  doc.text('Var\u0131\u015f : BURSA', 40, 80);

  doc.text('Otob\u00fcs Sahibi : ANAFARTALAR TUR\u0130ZM', 330, 40);
  doc.text('Vergi Dairesi : \u00c7ANAKKALE VD', 330, 60);
  doc.text('Vergi Numaras\u0131 : 069137440', 330, 80);

  // Seat box helper
  const seatWidth = 100;
  const seatHeight = 60;
  function drawSeat(x, y, seat) {
    doc.rect(x, y, seatWidth, seatHeight).stroke();
    if (seat) {
      doc.fontSize(10).text(seat.name, x + 5, y + 5, { width: seatWidth - 10, align: 'left' });
      doc.text(seat.price, x + seatWidth - 30, y + 5, { width: 25, align: 'right' });
      doc.text(`${seat.no} ${seat.id}`, x + 5, y + 20, { width: seatWidth - 10 });
      doc.text(`${seat.gender} ${seat.channel}`, x + 5, y + 35, { width: seatWidth - 10 });
    }
  }

  // Sample passenger data for left side
  const leftPassengers = [
    { name: 'Sefaya Canger', price: '599', no: 2, id: '3790502656', gender: 'Kad\u0131n', channel: 'WEB' },
    { name: 'Ali nurdahan Canger', price: '599', no: 3, id: '3790502656', gender: 'Erkek', channel: 'WEB' },
    { name: 'Cem Canger', price: '599', no: 4, id: '3790502656', gender: 'Erkek', channel: 'WEB' },
    { name: 'Eren Canger', price: '599', no: 5, id: '3790502656', gender: 'Erkek', channel: 'WEB' }
  ];

  // Draw left side seats (2 columns x 2 rows for demo)
  let x0 = 40;
  let y0 = 120;
  leftPassengers.forEach((p, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    drawSeat(x0 + col * (seatWidth + 10), y0 + row * (seatHeight + 10), p);
  });

  // Draw empty seats on right side
  x0 = 330;
  y0 = 120;
  for (let i = 0; i < 8; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    drawSeat(x0 + col * (seatWidth + 10), y0 + row * (seatHeight + 10));
  }

  // Bottom info
  doc.text('\u00c7ANAKKALE Toplam Yolcu Toplam Tutar: 2396', 40, 320);

  doc.end();
}

if (require.main === module) {
  generateTicket('ticket.pdf');
  console.log('ticket.pdf created');
}

module.exports = generateTicket;
