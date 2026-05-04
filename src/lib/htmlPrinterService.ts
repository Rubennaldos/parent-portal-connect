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
  ticketCorrelative?: string;
  date: string;
  clientName: string;
  clientDocument?: string;
  cashierLabel?: string;
  documentType?: 'ticket' | 'boleta' | 'factura';
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  tax?: number;
  total: number;
  currency?: string;
  paymentMethod: string;
  headerText?: string;
  footerText?: string;
  // Configuración adicional de formato
  logoUrl?: string | null;
  logoWidth?: number;
  logoHeight?: number;
  paperWidth?: number;
  fontSize?: string;
  fontFamily?: string;
  showQr?: boolean;
  qrPrefix?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ComandaData {
  ticketCode: string;
  date: string;
  clientName: string;
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
  }>;
  headerText?: string;
  // Configuración adicional de formato
  paperWidth?: number;
  fontSize?: string;
  fontFamily?: string;
  showQr?: boolean;
  qrPrefix?: string;
}

/**
 * Generar HTML del ticket con estilos para impresora térmica
 */
function generateTicketHTML(data: TicketData): string {
  const paperWidth = data.paperWidth || 80;
  const fontSize = data.fontSize === 'small' ? '11px' : data.fontSize === 'large' ? '14px' : '12px';
  const fontFamily = data.fontFamily || 'Courier New, monospace';
  const currency = data.currency || 'S/';
  const normalizedDocumentType = data.documentType || 'ticket';
  const documentTitle =
    normalizedDocumentType === 'boleta'
      ? 'BOLETA DE VENTA'
      : normalizedDocumentType === 'factura'
        ? 'FACTURA DE VENTA'
        : 'TICKET DE VENTA';
  const fiscalBadge =
    normalizedDocumentType === 'ticket'
      ? 'Documento interno - no fiscal'
      : 'Representacion impresa de comprobante electronico';
  const subtotal =
    typeof data.subtotal === 'number' && Number.isFinite(data.subtotal)
      ? data.subtotal
      : +(data.total / 1.18).toFixed(2);
  const tax =
    typeof data.tax === 'number' && Number.isFinite(data.tax)
      ? data.tax
      : +(data.total - subtotal).toFixed(2);
  const rawCorrelative = data.ticketCorrelative || data.ticketCode;
  const correlative = escapeHtml(rawCorrelative);
  const sanitizedDate = escapeHtml(data.date);
  const sanitizedClientName = escapeHtml(data.clientName);
  const sanitizedCashier = data.cashierLabel ? escapeHtml(data.cashierLabel) : null;
  const sanitizedClientDocument = data.clientDocument ? escapeHtml(data.clientDocument) : null;
  const sanitizedPaymentMethod = escapeHtml(data.paymentMethod);
  const itemsHTML = data.items.map((item) => `
    <tr>
      <td style="padding: 4px 0; width: 13%;">${item.quantity}</td>
      <td style="padding: 4px 4px 4px 0; width: 45%;">${escapeHtml(item.name)}</td>
      <td style="padding: 4px 0; width: 20%; text-align: right;">${currency} ${item.price.toFixed(2)}</td>
      <td style="padding: 4px 0; width: 22%; text-align: right; font-weight: 700;">${currency} ${item.total.toFixed(2)}</td>
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
          size: ${paperWidth}mm auto;
          margin: 0;
        }
        
        @media print {
          body {
            margin: 0;
            padding: 4mm;
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
          font-family: ${fontFamily};
          font-size: ${fontSize};
          line-height: 1.4;
          max-width: ${paperWidth}mm;
          margin: 0 auto;
          padding: 8px;
          background: white;
        }
        
        .ticket {
          width: 100%;
        }
        
        .header {
          text-align: center;
          margin-bottom: 8px;
          border-bottom: 2px dashed #000;
          padding-bottom: 8px;
        }
        
        .business-name {
          font-size: 17px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        
        .business-info {
          font-size: 10px;
          margin: 2px 0;
        }
        
        .separator {
          border-top: 1px dashed #000;
          margin: 8px 0;
        }
        
        .info-section {
          margin: 8px 0;
        }
        
        .info-row {
          display: flex;
          justify-content: space-between;
          margin: 3px 0;
          font-size: 11px;
        }
        
        .items-table {
          width: 100%;
          margin: 8px 0;
          font-size: 11px;
          border-collapse: collapse;
        }
        
        .items-table td {
          padding: 3px 0;
        }
        
        .items-table th {
          padding-bottom: 5px;
          border-bottom: 1px solid #000;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .items-table td:last-child, .items-table th:last-child {
          text-align: right;
        }
        
        .totals {
          margin-top: 8px;
          border-top: 1px dashed #000;
          padding-top: 8px;
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
          margin-top: 8px;
          padding-top: 5px;
          border-top: 2px solid #000;
        }
        
        .footer {
          text-align: center;
          margin-top: 12px;
          padding-top: 8px;
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

        .document-title {
          font-weight: 800;
          text-align: center;
          border: 1px solid #000;
          padding: 6px;
          margin: 8px 0;
          letter-spacing: 0.4px;
        }

        .fiscal-badge {
          text-align: center;
          font-size: 10px;
          margin-top: 5px;
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
        <!-- Logo -->
        ${data.logoUrl ? `
          <div style="text-align: center; margin-bottom: 10px;">
            <img src="${data.logoUrl}" 
                 style="width: ${data.logoWidth || 120}px; height: ${data.logoHeight || 60}px; object-fit: contain;" 
                 alt="Logo" />
          </div>
        ` : ''}
        
        <!-- Header -->
        <div class="header">
          <div class="business-name">${escapeHtml(data.businessName)}</div>
          ${data.businessRuc ? `<div class="business-info">RUC: ${escapeHtml(data.businessRuc)}</div>` : ''}
          ${data.businessAddress ? `<div class="business-info">${escapeHtml(data.businessAddress)}</div>` : ''}
          ${data.businessPhone ? `<div class="business-info">Tel: ${escapeHtml(data.businessPhone)}</div>` : ''}
        </div>
        
        <div class="document-title">${documentTitle}</div>
        <div class="fiscal-badge">${fiscalBadge}</div>
        ${data.headerText ? `<div style="text-align: center; margin: 8px 0; font-weight: bold;">${escapeHtml(data.headerText)}</div>` : ''}
        
        <!-- Info -->
        <div class="info-section">
          <div class="info-row">
            <span>Correlativo:</span>
            <span><strong>${correlative}</strong></span>
          </div>
          <div class="info-row">
            <span>Fecha:</span>
            <span>${sanitizedDate}</span>
          </div>
          <div class="info-row">
            <span>Cliente:</span>
            <span>${sanitizedClientName}</span>
          </div>
          ${sanitizedClientDocument ? `
            <div class="info-row">
              <span>Documento:</span>
              <span>${sanitizedClientDocument}</span>
            </div>
          ` : ''}
          ${sanitizedCashier ? `
            <div class="info-row">
              <span>Cajero:</span>
              <span>${sanitizedCashier}</span>
            </div>
          ` : ''}
          <div class="info-row">
            <span>Pago:</span>
            <span>${sanitizedPaymentMethod}</span>
          </div>
        </div>
        
        <div class="separator"></div>
        
        <!-- Items -->
        <table class="items-table">
          <thead>
            <tr>
              <th style="text-align: left;">Cant</th>
              <th style="text-align: left;">Producto</th>
              <th style="text-align: right;">P.U.</th>
              <th style="text-align: right;">Importe</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
        
        <!-- Totals -->
        <div class="totals">
          <div class="total-row">
            <span>Subtotal:</span>
            <span>${currency} ${subtotal.toFixed(2)}</span>
          </div>
          ${tax ? `
            <div class="total-row">
              <span>IGV (18%):</span>
              <span>${currency} ${tax.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="total-row main">
            <span>TOTAL:</span>
            <span>${currency} ${data.total.toFixed(2)}</span>
          </div>
        </div>
        
        <!-- QR Code -->
        ${data.showQr ? `
          <div style="text-align: center; border: 2px solid #000; padding: 10px; margin: 10px 0;">
            <div style="font-weight: bold; font-family: monospace;">QR: ${escapeHtml(data.ticketCode)}</div>
            <div style="font-size: 10px; color: #666;">Código para validación</div>
          </div>
        ` : ''}
        
        <!-- Footer -->
        <div class="footer">
          ${data.footerText ? `<div class="footer-text">${escapeHtml(data.footerText)}</div>` : ''}
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
          Si el cuadro no aparece, usa este botón para abrir impresión
        </p>
      </div>
      
      <script>
        window.addEventListener('load', function() {
          setTimeout(function() {
            window.print();
          }, 250);
        });
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
    const startTime = Date.now();
    console.log('🖨️ Imprimiendo ticket con HTML...');
    
    // 🚀 OPTIMIZACIÓN: Abrir ventana con about:blank primero (instantáneo)
    const printWindow = window.open('about:blank', '_blank', 'width=400,height=600');
    
    if (!printWindow) {
      throw new Error('No se pudo abrir ventana de impresión. Verifica que no esté bloqueada por el navegador.');
    }
    
    // 🚀 OPTIMIZACIÓN: Escribir HTML minificado (sin espacios innecesarios)
    const ticketHTML = generateTicketHTML(ticketData).replace(/\s+/g, ' ').trim();
    
    // 🚀 OPTIMIZACIÓN: document.write es más rápido que innerHTML
    printWindow.document.write(ticketHTML);
    printWindow.document.close();
    
    const endTime = Date.now();
    console.log(`✅ Ventana abierta en ${endTime - startTime}ms`);
    
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

/**
 * Generar HTML de la comanda (para cocina)
 */
function generateComandaHTML(data: ComandaData): string {
  const paperWidth = data.paperWidth || 80;
  const fontSize = data.fontSize === 'small' ? '12px' : data.fontSize === 'large' ? '16px' : '14px';
  const fontFamily = data.fontFamily || 'Courier New, monospace';
  
  const itemsHTML = data.items.map(item => `
    <div class="comanda-item">
      <div class="item-quantity">${item.quantity}x</div>
      <div class="item-name">${item.name}</div>
      ${item.notes ? `<div class="item-notes">→ ${item.notes}</div>` : ''}
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Comanda ${data.ticketCode}</title>
      <style>
        @page {
          size: ${paperWidth}mm auto;
          margin: 0;
        }
        
        @media print {
          body { margin: 0; padding: 5mm; }
          .no-print { display: none !important; }
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
          font-family: ${fontFamily};
          font-size: ${fontSize};
          line-height: 1.5;
          max-width: ${paperWidth}mm;
          margin: 0 auto;
          padding: 10px;
        }
        
        .comanda-header {
          text-align: center;
          background: #000;
          color: #fff;
          padding: 15px;
          margin-bottom: 15px;
          font-size: 20px;
          font-weight: bold;
        }
        
        .comanda-info {
          border: 2px solid #000;
          padding: 10px;
          margin-bottom: 15px;
        }
        
        .info-line {
          margin: 5px 0;
          font-weight: bold;
        }
        
        .comanda-title {
          text-align: center;
          font-size: 18px;
          font-weight: bold;
          margin: 15px 0 10px 0;
          background: #f0f0f0;
          padding: 8px;
        }
        
        .comanda-item {
          border-bottom: 1px dashed #ccc;
          padding: 12px 0;
        }
        
        .item-quantity {
          font-size: 24px;
          font-weight: bold;
          color: #000;
          display: inline-block;
          min-width: 50px;
        }
        
        .item-name {
          font-size: 16px;
          font-weight: bold;
          margin: 5px 0;
        }
        
        .item-notes {
          font-size: 12px;
          color: #666;
          margin-left: 50px;
          font-style: italic;
        }
        
        .footer-comanda {
          text-align: center;
          margin-top: 20px;
          padding: 15px;
          background: #f9f9f9;
          border: 2px dashed #000;
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
          margin: 10px 0;
          background: #FF5722;
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
        }
        
        .print-button:hover {
          background: #E64A19;
        }
        
        .close-button {
          display: block;
          width: 100%;
          padding: 10px;
          background: #607D8B;
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 14px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <!-- Header destacado -->
      <div class="comanda-header">
        🍽️ COMANDA COCINA 🍽️
      </div>
      
      <!-- Info del pedido -->
      <div class="comanda-info">
        <div class="info-line">PEDIDO: ${data.ticketCode}</div>
        <div class="info-line">HORA: ${new Date().toLocaleTimeString('es-PE')}</div>
        <div class="info-line">CLIENTE: ${data.clientName}</div>
      </div>
      
      <!-- Título de productos -->
      <div class="comanda-title">
        PRODUCTOS A PREPARAR
      </div>
      
      <!-- Items -->
      <div>
        ${itemsHTML}
      </div>
      
      <!-- QR Code -->
      ${data.showQr ? `
        <div style="text-align: center; border: 3px solid #ff9800; padding: 15px; background: white; margin-top: 15px;">
          <div style="font-weight: bold; font-family: monospace; font-size: 14px;">QR: ${data.ticketCode}</div>
          <div style="font-size: 10px; color: #666; margin-top: 5px;">Escanear para confirmar entrega</div>
        </div>
      ` : ''}
      
      <!-- Footer -->
      <div class="footer-comanda">
        <strong>PREPARAR Y ENTREGAR</strong>
      </div>
      
      <div class="cut-line">
        ✂️ -------------------------------- ✂️<br>
        <small>Cortar aquí</small>
      </div>
      
      <!-- Buttons -->
      <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button class="print-button" onclick="window.print()">
          🍽️ Imprimir Comanda
        </button>
        <button class="close-button" onclick="window.close()">
          ✖️ Cerrar
        </button>
      </div>
      
      <script>
        // 🚀 Imprimir INMEDIATAMENTE cuando la ventana carga
        window.addEventListener('load', function() {
          console.log('🚀 Comanda cargada - Abriendo diálogo de impresión...');
          setTimeout(function() {
            window.print();
          }, 100);
        });
        
        // Auto-cerrar ventana después de imprimir
        window.addEventListener('afterprint', function() {
          console.log('✅ Comanda impresa - Cerrando ventana...');
          setTimeout(function() {
            window.close();
          }, 500);
        });
      </script>
    </body>
    </html>
  `;
}

/**
 * Imprimir comanda (para cocina)
 */
export function printComandaHTML(comandaData: ComandaData): void {
  try {
    const startTime = Date.now();
    console.log('🍽️ Imprimiendo comanda con HTML...');
    
    // 🚀 OPTIMIZACIÓN: about:blank + write directo
    const printWindow = window.open('about:blank', '_blank', 'width=400,height=600');
    
    if (!printWindow) {
      throw new Error('No se pudo abrir ventana de comanda.');
    }
    
    // 🚀 OPTIMIZACIÓN: HTML minificado
    const comandaHTML = generateComandaHTML(comandaData).replace(/\s+/g, ' ').trim();
    printWindow.document.write(comandaHTML);
    printWindow.document.close();
    
    const endTime = Date.now();
    console.log(`✅ Comanda abierta en ${endTime - startTime}ms`);
    
  } catch (error) {
    console.error('❌ Error al imprimir comanda:', error);
    throw error;
  }
}

export default {
  printTicketHTML,
  printComandaHTML,
  isHTMLPrintAvailable
};
