import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { APP_CONFIG } from '@/config/app.config';

// Helper: asegura que el texto sea safe para Helvetica (Latin-1)
// Reemplaza los pocos caracteres fuera de Latin-1 que podrían llegar de la BD
const safe = (str: string | null | undefined): string => {
  if (!str) return '';
  return str
    .replace(/\u2013/g, '-')   // en-dash
    .replace(/\u2014/g, '-')   // em-dash
    .replace(/\u2018|\u2019/g, "'")  // smart quotes
    .replace(/\u201C|\u201D/g, '"'); // smart double quotes
};

interface KioskItem {
  description: string | null;
  amount: number;
  created_at: string;
  ticket_code?: string | null;
}

interface Transaction {
  id: string;
  created_at: string;
  payment_date?: string;
  ticket_code: string | null;
  description: string;
  amount: number;
  menu_name?: string | null;
  menu_date?: string | null;
  payment_method?: string | null;
  is_kiosk_balance_debt?: boolean;
  kiosk_items?: KioskItem[];
}

interface PDFData {
  student_name: string;
  parent_name: string;
  parent_dni?: string;
  parent_phone?: string;
  school_name: string;
  period_name: string;
  start_date: string;
  end_date: string;
  transactions: Transaction[];
  total_amount: number;
  lunch_amount?: number;
  cafeteria_amount?: number;
  paid_amount?: number;
  pending_amount?: number;
  logo_base64?: string;
  reference_id?: string; // Aparece solo en el pie de página
}

export const generateBillingPDF = (data: PDFData) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ── Colores ──────────────────────────────────────────────────────────────
  const primaryColor: [number, number, number] = [220, 38, 38];   // red-600
  const darkColor: [number, number, number] = [31, 41, 55];        // gray-800
  const secondaryColor: [number, number, number] = [107, 114, 128];// gray-500
  const tableHeaderColor: [number, number, number] = [243, 244, 246]; // gray-100
  const kioskHeaderBg: [number, number, number] = [254, 226, 226]; // rose-100
  const kioskSubBg: [number, number, number] = [255, 241, 242];    // rose-50

  // ── Barra lateral decorativa ─────────────────────────────────────────────
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 5, pageHeight, 'F');

  // ── Logo ─────────────────────────────────────────────────────────────────
  if (data.logo_base64) {
    try {
      doc.addImage(data.logo_base64, 'PNG', 14, 10, 30, 30, undefined, 'FAST');
    } catch (e) {
      console.error('Error adding logo to PDF:', e);
    }
  }

  // ── Encabezado: nombre del colegio ───────────────────────────────────────
  doc.setTextColor(...darkColor);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(safe(data.school_name).toUpperCase(), pageWidth - 14, 18, { align: 'right' });

  doc.setFontSize(11);
  doc.setTextColor(...secondaryColor);
  doc.setFont('helvetica', 'normal');
  doc.text('ESTADO DE CUENTA - DEUDA PENDIENTE', pageWidth - 14, 26, { align: 'right' });

  doc.setFontSize(9);
  doc.text(
    `Emitido el ${format(new Date(), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}`,
    pageWidth - 14,
    33,
    { align: 'right' }
  );

  // ── Secciones de datos (izquierda: periodo | derecha: cliente) ───────────
  let yPos = 50;

  // Columna izquierda: periodo
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PERIODO', 14, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(safe(data.period_name), 14, yPos);
  yPos += 5;
  doc.text(
    `${format(new Date(data.start_date), 'dd/MM/yyyy', { locale: es })} - ${format(new Date(data.end_date), 'dd/MM/yyyy', { locale: es })}`,
    14,
    yPos
  );

  // Columna derecha: cliente
  const rightColX = 110;
  let ryPos = 50;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DATOS DEL CLIENTE', rightColX, ryPos);
  ryPos += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`Alumno:  ${safe(data.student_name)}`, rightColX, ryPos);
  ryPos += 5;
  doc.text(`Tutor:   ${safe(data.parent_name)}`, rightColX, ryPos);
  ryPos += 5;
  doc.text(`Sede:    ${safe(data.school_name)}`, rightColX, ryPos);

  // ── Línea divisora ───────────────────────────────────────────────────────
  yPos = Math.max(yPos, ryPos) + 10;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(14, yPos, pageWidth - 14, yPos);

  // ── Título de tabla ──────────────────────────────────────────────────────
  yPos += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkColor);
  doc.text('DETALLE DE CONSUMOS', 14, yPos);
  yPos += 5;

  // ── Construir filas de la tabla ──────────────────────────────────────────
  const getPaymentMethodLabel = (method: string | null | undefined): string => {
    if (!method) return '-';
    const map: Record<string, string> = {
      efectivo: 'Efectivo',
      yape: 'Yape',
      plin: 'Plin',
      transferencia: 'Transferencia',
      tarjeta: 'Tarjeta',
      teacher_account: 'Cta. Profesor',
    };
    return map[method] || method;
  };

  // Cada entrada puede ser una fila normal o un bloque expandido de kiosco
  type TableRow = (string | { content: string; styles?: Record<string, any> })[];
  const tableData: TableRow[] = [];
  const rowStyles: Record<number, Record<string, any>> = {};
  let rowIndex = 0;

  data.transactions.forEach((transaction, txIndex) => {
    const isKiosk = transaction.is_kiosk_balance_debt === true;

    if (isKiosk && transaction.kiosk_items && transaction.kiosk_items.length > 0) {
      // ── Fila cabecera de kiosco ──────────────────────────────────────────
      rowStyles[rowIndex] = { fillColor: kioskHeaderBg, fontStyle: 'bold', textColor: [185, 28, 28] };
      tableData.push([
        { content: `${txIndex + 1}`, styles: { halign: 'center', fontStyle: 'bold' } },
        format(new Date(transaction.created_at), 'dd/MM/yyyy', { locale: es }),
        '-',
        `Saldo negativo kiosco — ${transaction.kiosk_items.length} consumo(s)`,
        '-',
        `S/ ${Math.abs(transaction.amount).toFixed(2)}`,
      ]);
      rowIndex++;

      // ── Una fila por item del kiosco ─────────────────────────────────────
      transaction.kiosk_items.forEach((item) => {
        rowStyles[rowIndex] = { fillColor: kioskSubBg, fontSize: 7.5, textColor: [100, 0, 0] };
        tableData.push([
          { content: '', styles: { halign: 'center' } },
          format(new Date(item.created_at), 'dd/MM/yyyy HH:mm', { locale: es }),
          safe(item.ticket_code) || '-',
          `  ${safe(item.description) || 'Consumo en cafeteria'}`,
          '-',
          { content: `S/ ${Math.abs(item.amount).toFixed(2)}`, styles: { halign: 'right', textColor: [185, 28, 28] } },
        ]);
        rowIndex++;
      });
    } else {
      // ── Fila normal ───────────────────────────────────────────────────────
      const consumptionDate = format(new Date(transaction.created_at), 'dd/MM/yyyy', { locale: es });
      const paymentDateStr = transaction.payment_date
        ? format(new Date(transaction.payment_date), 'dd/MM/yyyy', { locale: es })
        : consumptionDate;
      const dateDisplay =
        paymentDateStr !== consumptionDate
          ? `${consumptionDate}\n(pago: ${paymentDateStr})`
          : consumptionDate;

      let desc = safe(transaction.description) || 'Consumo';
      if (transaction.menu_name && !desc.toLowerCase().includes(transaction.menu_name.toLowerCase())) {
        desc = `${desc}\n${safe(transaction.menu_name)}`;
      }

      tableData.push([
        { content: (txIndex + 1).toString(), styles: { halign: 'center' } },
        dateDisplay,
        safe(transaction.ticket_code) || '-',
        desc,
        getPaymentMethodLabel(transaction.payment_method),
        { content: `S/ ${Math.abs(transaction.amount).toFixed(2)}`, styles: { halign: 'right', fontStyle: 'bold' } },
      ]);
      rowIndex++;
    }
  });

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Fecha', 'Ticket', 'Detalle', 'Metodo', 'Monto']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: tableHeaderColor,
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [0, 0, 0],
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
    willDrawCell: (hookData: any) => {
      const style = rowStyles[hookData.row.index];
      if (style && hookData.section === 'body') {
        if (style.fillColor) doc.setFillColor(...style.fillColor);
        if (style.textColor) doc.setTextColor(...style.textColor);
        if (style.fontStyle) doc.setFont('helvetica', style.fontStyle);
        if (style.fontSize) doc.setFontSize(style.fontSize);
      }
    },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      1: { cellWidth: 24, halign: 'center' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 74 },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  // ── Resumen de totales ───────────────────────────────────────────────────
  const finalY = (doc as any).lastAutoTable.finalY || yPos + 50;
  const summaryY = finalY + 12;
  const summaryX = pageWidth - 80;
  const hasBreakdown = (data.lunch_amount || 0) > 0 && (data.cafeteria_amount || 0) > 0;
  const breakdownH = hasBreakdown ? 14 : 0;

  doc.setFillColor(254, 242, 242);
  doc.roundedRect(summaryX - 5, summaryY - 5, 70, 30 + breakdownH + (data.paid_amount ? 10 : 0), 3, 3, 'F');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('TOTAL:', summaryX, summaryY);
  doc.setTextColor(...primaryColor);
  doc.text(`S/ ${data.total_amount.toFixed(2)}`, pageWidth - 20, summaryY, { align: 'right' });

  let summaryOffset = 0;
  if (hasBreakdown) {
    summaryOffset = 14;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(194, 65, 12);
    doc.text('Almuerzos:', summaryX, summaryY + 7);
    doc.text(`S/ ${(data.lunch_amount || 0).toFixed(2)}`, pageWidth - 20, summaryY + 7, { align: 'right' });
    doc.setTextColor(126, 34, 206);
    doc.text('Cafeteria:', summaryX, summaryY + 14);
    doc.text(`S/ ${(data.cafeteria_amount || 0).toFixed(2)}`, pageWidth - 20, summaryY + 14, { align: 'right' });
  }

  if (data.paid_amount !== undefined && data.paid_amount > 0) {
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Pagado:', summaryX, summaryY + 7 + summaryOffset);
    doc.setTextColor(34, 197, 94);
    doc.text(`S/ ${data.paid_amount.toFixed(2)}`, pageWidth - 20, summaryY + 7 + summaryOffset, { align: 'right' });
  }

  if (data.pending_amount !== undefined && data.pending_amount > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryColor);
    doc.text('SALDO PENDIENTE:', summaryX, summaryY + 17 + summaryOffset);
    doc.text(`S/ ${data.pending_amount.toFixed(2)}`, pageWidth - 20, summaryY + 17 + summaryOffset, { align: 'right' });
  }

  // ── Nota informativa ─────────────────────────────────────────────────────
  const noteY = Math.max(summaryY + 38 + summaryOffset, pageHeight - 40);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...secondaryColor);
  doc.text(
    'Este documento es un estado de cuenta informativo de consumos realizados.',
    pageWidth / 2,
    noteY,
    { align: 'center' }
  );
  doc.text(
    'Para cualquier duda o aclaracion, contacte con la administracion del colegio.',
    pageWidth / 2,
    noteY + 5,
    { align: 'center' }
  );

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerY = pageHeight - 18;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(14, footerY - 4, pageWidth - 14, footerY - 4);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(156, 163, 175);

  // Izquierda: referencia interna (solo si se pasa)
  if (data.reference_id) {
    doc.text(`Ref. interna: ${data.reference_id}`, 14, footerY + 2);
  }

  // Centro: firma del sistema
  doc.text(
    `(c) ${APP_CONFIG.version} ${APP_CONFIG.status} — ERP Profesional | Generado el ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })}`,
    pageWidth / 2,
    footerY + 2,
    { align: 'center' }
  );

  // Guardar
  const fileName = `EstadoCuenta_${data.student_name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
  doc.save(fileName);

  return doc;
};

// Función para generar múltiples PDFs (masivo)
export const generateMultipleBillingPDFs = async (dataArray: PDFData[]) => {
  const pdfs: { name: string; data: jsPDF }[] = [];
  for (const data of dataArray) {
    const pdf = generateBillingPDF(data);
    pdfs.push({
      name: `${data.student_name.replace(/\s+/g, '_')}.pdf`,
      data: pdf,
    });
  }
  return pdfs;
};

// Función para obtener el blob del PDF
export const getBillingPDFBlob = (data: PDFData): Blob => {
  const doc = generateBillingPDF(data);
  return doc.output('blob');
};
