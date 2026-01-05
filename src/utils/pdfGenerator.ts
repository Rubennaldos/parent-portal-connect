import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { APP_CONFIG } from '@/config/app.config';

interface Transaction {
  id: string;
  created_at: string;
  ticket_code: string;
  description: string;
  amount: number;
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
  paid_amount?: number;
  pending_amount?: number;
}

export const generateBillingPDF = (data: PDFData) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Colores
  const primaryColor: [number, number, number] = [220, 38, 38]; // red-600
  const secondaryColor: [number, number, number] = [107, 114, 128]; // gray-500
  const tableHeaderColor: [number, number, number] = [254, 226, 226]; // red-100

  // Logo y Header
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 35, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('LIMA CAFÉ 28', pageWidth / 2, 15, { align: 'center' });
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('ESTADO DE CUENTA', pageWidth / 2, 25, { align: 'center' });

  // Información del período
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Período: ${data.period_name}`, 14, 45);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${format(new Date(data.start_date), 'dd MMM yyyy', { locale: es })} - ${format(new Date(data.end_date), 'dd MMM yyyy', { locale: es })}`,
    14,
    52
  );

  // Información del estudiante y padre
  let yPos = 62;
  
  doc.setFont('helvetica', 'bold');
  doc.text('Estudiante:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(data.student_name, 50, yPos);
  
  yPos += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Padre/Tutor:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(data.parent_name, 50, yPos);

  if (data.parent_dni) {
    yPos += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('DNI:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(data.parent_dni, 50, yPos);
  }

  if (data.parent_phone) {
    yPos += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('Teléfono:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(data.parent_phone, 50, yPos);
  }

  yPos += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Sede:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(data.school_name, 50, yPos);

  // Línea separadora
  yPos += 10;
  doc.setDrawColor(...secondaryColor);
  doc.setLineWidth(0.5);
  doc.line(14, yPos, pageWidth - 14, yPos);

  // Título de la tabla
  yPos += 10;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...primaryColor);
  doc.text('DETALLE DE CONSUMOS', 14, yPos);

  // Tabla de transacciones
  yPos += 5;
  
  const tableData = data.transactions.map((transaction, index) => [
    (index + 1).toString(),
    format(new Date(transaction.created_at), 'dd/MM/yyyy', { locale: es }),
    transaction.ticket_code || '-',
    transaction.description || 'Consumo',
    `S/ ${transaction.amount.toFixed(2)}`,
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Fecha', 'Ticket', 'Descripción', 'Monto']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: tableHeaderColor,
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: [0, 0, 0],
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 25, halign: 'center' },
      2: { cellWidth: 30, halign: 'center' },
      3: { cellWidth: 80 },
      4: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  // Obtener la posición final de la tabla
  const finalY = (doc as any).lastAutoTable.finalY || yPos + 50;

  // Resumen de totales
  const summaryY = finalY + 15;
  const summaryX = pageWidth - 80;

  // Fondo del resumen
  doc.setFillColor(254, 242, 242); // red-50
  doc.roundedRect(summaryX - 5, summaryY - 5, 70, data.paid_amount !== undefined ? 35 : 25, 3, 3, 'F');

  // Total
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('TOTAL:', summaryX, summaryY);
  doc.setTextColor(...primaryColor);
  doc.text(`S/ ${data.total_amount.toFixed(2)}`, pageWidth - 20, summaryY, { align: 'right' });

  // Si hay pago parcial
  if (data.paid_amount !== undefined && data.paid_amount > 0) {
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Pagado:', summaryX, summaryY + 7);
    doc.setTextColor(34, 197, 94); // green-500
    doc.text(`S/ ${data.paid_amount.toFixed(2)}`, pageWidth - 20, summaryY + 7, { align: 'right' });
  }

  // Saldo pendiente
  if (data.pending_amount !== undefined && data.pending_amount > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryColor);
    doc.text('SALDO PENDIENTE:', summaryX, summaryY + 15);
    doc.text(`S/ ${data.pending_amount.toFixed(2)}`, pageWidth - 20, summaryY + 15, { align: 'right' });
  }

  // Nota al pie
  const noteY = Math.max(summaryY + 30, pageHeight - 40);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...secondaryColor);
  doc.text(
    'Para realizar el pago, contacte con la administración de su sede.',
    pageWidth / 2,
    noteY,
    { align: 'center' }
  );

  // Footer
  const footerY = pageHeight - 25;
  
  // Línea separadora del footer
  doc.setDrawColor(...secondaryColor);
  doc.setLineWidth(0.3);
  doc.line(14, footerY - 5, pageWidth - 14, footerY - 5);

  // Texto del footer
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...secondaryColor);
  
  const footerLine1 = `© ${new Date().getFullYear()} ERP Profesional diseñado por ARQUISIA Soluciones para Lima Café 28`;
  const footerLine2 = `Versión ${APP_CONFIG.version} ${APP_CONFIG.status} | Generado el ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })}`;
  
  doc.text(footerLine1, pageWidth / 2, footerY + 2, { align: 'center' });
  doc.text(footerLine2, pageWidth / 2, footerY + 7, { align: 'center' });

  // Guardar el PDF
  const fileName = `Estado_Cuenta_${data.student_name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
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

// Función para obtener el blob del PDF (útil para enviar por WhatsApp)
export const getBillingPDFBlob = (data: PDFData): Blob => {
  const doc = new jsPDF();
  // ... mismo código de arriba pero sin el save()
  // Retornar el blob
  return doc.output('blob');
};

