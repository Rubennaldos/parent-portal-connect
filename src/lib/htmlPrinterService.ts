/**
 * 🖨️ Servicio de Impresión HTML
 * Impresión directa usando window.print() del navegador
 * Sin necesidad de QZ Tray ni popups
 */

export interface TicketData {
  businessName: string;
  businessRuc?: string;
  businessAddress?: string;
  businessPhone?: string;
  ticketCode: string;
  date: string;
  clientName: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  tax?: number;
  total: number;
  paymentMethod: string;
  headerText?: string;
  footerText?: string;
}

/**
 * Generar HTML del ticket con estilos para impresora térmica
 */
function generateTicketHTML(data: TicketData): string {
  const itemsHTML = data.items.map(item => `
    <tr>
      <td style="padding: 4px 0;">${item.quantity}x ${item.name}</td>
      <td style="padding: 4px 0; text-align: right;">S/ ${item.price.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Ticket ${data.ticketCode}</title>
      <style>
        @page {
          size: 80mm auto;
          margin: 0;
        }
        
        @media print {
          body {
            margin: 0;
            padding: 10mm;
          }
          
          .no-print {
            display: none !important;
          }
        }
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.4;
          max-width: 80mm;
          margin: 0 auto;
          padding: 10px;
          background: white;
        }
        
        .ticket {
          width: 100%;
        }
        
        .header {
          text-align: center;
          margin-bottom: 10px;
          border-bottom: 2px dashed #000;
          padding-bottom: 10px;
        }
        
        .business-name {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 5px;
        }
        
        .business-info {
          font-size: 10px;
          margin: 2px 0;
        }
        
        .separator {
          border-top: 1px dashed #000;
          margin: 10px 0;
        }
        
        .info-section {
          margin: 10px 0;
        }
        
        .info-row {
          display: flex;
          justify-content: space-between;
          margin: 3px 0;
          font-size: 11px;
        }
        
        .items-table {
          width: 100%;
          margin: 10px 0;
          font-size: 11px;
        }
        
        .items-table td {
          padding: 4px 0;
        }
        
        .items-table td:last-child {
          text-align: right;
        }
        
        .totals {
          margin-top: 10px;
          border-top: 1px dashed #000;
          padding-top: 10px;
        }
        
        .total-row {
          display: flex;
          justify-content: space-between;
          margin: 5px 0;
          font-size: 12px;
        }
        
        .total-row.main {
          font-size: 16px;
          font-weight: bold;
          margin-top: 10px;
          padding-top: 5px;
          border-top: 2px solid #000;
        }
        
        .footer {
          text-align: center;
          margin-top: 15px;
          padding-top: 10px;
          border-top: 2px dashed #000;
          font-size: 10px;
        }
        
        .footer-text {
          margin: 3px 0;
        }
        
        .cut-line {
          text-align: center;
          margin: 20px 0 10px 0;
          font-size: 10px;
          color: #666;
        }
        
        .print-button {
          display: block;
          width: 100%;
          padding: 15px;
          margin: 20px 0;
          background: #4CAF50;
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
        }
        
        .print-button:hover {
          background: #45a049;
        }
        
        .close-button {
          display: block;
          width: 100%;
          padding: 10px;
          margin: 10px 0;
          background: #f44336;
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 14px;
          cursor: pointer;
        }
        
        .close-button:hover {
          background: #da190b;
        }
      </style>
    </head>
    <body>
      <div class="ticket">
        <!-- Header -->
        <div class="header">
          <div class="business-name">${data.businessName}</div>
          ${data.businessRuc ? `<div class="business-info">RUC: ${data.businessRuc}</div>` : ''}
          ${data.businessAddress ? `<div class="business-info">${data.businessAddress}</div>` : ''}
          ${data.businessPhone ? `<div class="business-info">Tel: ${data.businessPhone}</div>` : ''}
        </div>
        
        ${data.headerText ? `<div style="text-align: center; margin: 10px 0; font-weight: bold;">${data.headerText}</div>` : ''}
        
        <!-- Info -->
        <div class="info-section">
          <div class="info-row">
            <span>Ticket:</span>
            <span><strong>${data.ticketCode}</strong></span>
          </div>
          <div class="info-row">
            <span>Fecha:</span>
            <span>${data.date}</span>
          </div>
          <div class="info-row">
            <span>Cliente:</span>
            <span>${data.clientName}</span>
          </div>
          <div class="info-row">
            <span>Pago:</span>
            <span>${data.paymentMethod}</span>
          </div>
        </div>
        
        <div class="separator"></div>
        
        <!-- Items -->
        <table class="items-table">
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
        
        <!-- Totals -->
        <div class="totals">
          <div class="total-row">
            <span>Subtotal:</span>
            <span>S/ ${data.subtotal.toFixed(2)}</span>
          </div>
          ${data.tax ? `
            <div class="total-row">
              <span>IGV (18%):</span>
              <span>S/ ${data.tax.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="total-row main">
            <span>TOTAL:</span>
            <span>S/ ${data.total.toFixed(2)}</span>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
          ${data.footerText ? `<div class="footer-text">${data.footerText}</div>` : ''}
          <div class="footer-text">¡Gracias por su compra!</div>
          <div class="footer-text">${new Date().toLocaleString('es-PE')}</div>
        </div>
        
        <div class="cut-line">
          ✂️ -------------------------------- ✂️<br>
          <small>Cortar aquí</small>
        </div>
      </div>
      
      <!-- Buttons (hidden on print) -->
      <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button class="print-button" onclick="window.print()">
          🖨️ Imprimir Ticket
        </button>
        <button class="close-button" onclick="window.close()">
          ✖️ Cerrar
        </button>
        <p style="color: #666; font-size: 12px; margin-top: 10px;">
          Después de imprimir, corta el papel en la línea indicada ✂️
        </p>
      </div>
      
      <script>
        // Auto-print después de cargar (opcional)
        // window.onload = () => {
        //   setTimeout(() => window.print(), 500);
        // };
      </script>
    </body>
    </html>
  `;
}

/**
 * Imprimir ticket usando window.print()
 * Abre una ventana nueva con el ticket y permite al usuario imprimir
 */
export function printTicketHTML(ticketData: TicketData): void {
  try {
    console.log('🖨️ Imprimiendo ticket con HTML...');
    
    // Generar HTML del ticket
    const ticketHTML = generateTicketHTML(ticketData);
    
    // Abrir ventana nueva
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    
    if (!printWindow) {
      throw new Error('No se pudo abrir ventana de impresión. Verifica que no esté bloqueada por el navegador.');
    }
    
    // Escribir HTML en la ventana
    printWindow.document.write(ticketHTML);
    printWindow.document.close();
    
    // Enfocar la ventana
    printWindow.focus();
    
    console.log('✅ Ventana de impresión abierta exitosamente');
    console.log('ℹ️  El usuario puede imprimir con Ctrl+P o click en "Imprimir Ticket"');
    
  } catch (error) {
    console.error('❌ Error al imprimir con HTML:', error);
    throw error;
  }
}

/**
 * Verificar si la impresión HTML está disponible
 * Siempre está disponible en navegadores modernos
 */
export function isHTMLPrintAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.print === 'function';
}

export default {
  printTicketHTML,
  isHTMLPrintAvailable
};
