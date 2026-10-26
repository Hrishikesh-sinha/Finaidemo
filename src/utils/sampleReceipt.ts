/**
 * Utility to generate a realistic crisp sample receipt on an offscreen canvas
 * for instant testing and presentation of client-side Tesseract.js OCR.
 */

export function generateSampleReceiptDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 580;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle border / receipt outline
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

  // Header
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';

  ctx.font = 'bold 20px Courier, monospace';
  ctx.fillText('BLUE TOKAI COFFEE', canvas.width / 2, 45);

  ctx.font = '13px Courier, monospace';
  ctx.fillText('Connaught Place, New Delhi', canvas.width / 2, 70);
  ctx.fillText('GSTIN: 07AABCB1234F1Z8', canvas.width / 2, 90);

  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  const dateStr = `${day}/${month}/${year}`;

  ctx.fillText(`Date: ${dateStr}   Time: 14:35`, canvas.width / 2, 115);
  ctx.fillText('Tax Invoice / Receipt #: BT-8092', canvas.width / 2, 135);

  // Separator line
  ctx.fillText('------------------------------------------', canvas.width / 2, 155);

  // Table items
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px Courier, monospace';
  ctx.fillText('ITEMS                        QTY   AMOUNT', 24, 175);
  ctx.font = '13px Courier, monospace';
  ctx.fillText('------------------------------------------', 24, 195);

  ctx.fillText('Iced Sea Salt Latte           1    260.00', 24, 220);
  ctx.fillText('Almond Croissant Toast        1    190.00', 24, 245);
  ctx.fillText('Nitro Cold Brew Can           1    220.00', 24, 270);
  ctx.fillText('Artisan Sourdough Toast       1    180.00', 24, 295);

  ctx.fillText('------------------------------------------', 24, 320);

  // Subtotals
  ctx.fillText('Subtotal:                         850.00', 24, 345);
  ctx.fillText('CGST (2.5%):                       21.25', 24, 370);
  ctx.fillText('SGST (2.5%):                       21.25', 24, 395);

  ctx.fillText('==========================================', 24, 420);

  // Grand Total Highlight
  ctx.font = 'bold 17px Courier, monospace';
  ctx.fillText('GRAND TOTAL:                     ₹892.50', 24, 450);

  ctx.font = '13px Courier, monospace';
  ctx.fillText('==========================================', 24, 475);

  ctx.textAlign = 'center';
  ctx.fillText('Payment Mode: UPI Confirmed', canvas.width / 2, 505);
  ctx.fillText('THANK YOU FOR VISITING!', canvas.width / 2, 530);
  ctx.fillText('* Please retain receipt for records *', canvas.width / 2, 550);

  return canvas.toDataURL('image/png');
}
