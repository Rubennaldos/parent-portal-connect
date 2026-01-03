import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TicketItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

interface ThermalTicketProps {
  ticketCode: string;
  date: Date;
  cashierEmail: string;
  clientName: string;
  documentType: 'ticket' | 'boleta' | 'factura';
  items: TicketItem[];
  total: number;
  paymentMethod?: string;
  newBalance?: number;
  clientDNI?: string;
  clientRUC?: string;
  isReprint?: boolean;
  showOnScreen?: boolean; // NUEVA PROP
}

export const ThermalTicket = ({
  ticketCode,
  date,
  cashierEmail,
  clientName,
  documentType,
  items,
  total,
  paymentMethod,
  newBalance,
  clientDNI,
  clientRUC,
  isReprint = false,
  showOnScreen = false // POR DEFECTO FALSO
}: ThermalTicketProps) => {
  const getDocumentTitle = () => {
    switch (documentType) {
      case 'boleta':
        return 'BOLETA DE VENTA ELECTRÓNICA';
      case 'factura':
        return 'FACTURA ELECTRÓNICA';
      default:
        return 'TICKET DE VENTA';
    }
  };

  return (
    <div 
      id={showOnScreen ? "thermal-ticket-screen" : "thermal-ticket-container"}
      className={showOnScreen ? "mx-auto bg-white shadow-inner" : "thermal-print-only"}
      style={showOnScreen ? {
        width: '100%',
        maxWidth: '300px',
        margin: '0 auto',
        padding: '20px',
        backgroundColor: '#fff',
        color: '#000',
        fontFamily: '"Courier New", Courier, monospace',
        boxShadow: '0 0 10px rgba(0,0,0,0.1)',
        border: '1px solid #eee'
      } : { 
        display: 'none'
      }}
    >
      <style>{`
        @media screen {
          .thermal-print-only {
            display: none !important;
          }
        }
        @media print {
          /* Ocultar TODO menos el ticket */
          body * {
            visibility: hidden;
            -webkit-print-color-adjust: exact;
          }
          
          /* Mostrar solo el ticket que queremos imprimir */
          .thermal-print-only, .thermal-print-only * {
            visibility: visible;
          }

          #thermal-ticket-screen, #thermal-ticket-screen * {
            visibility: visible;
          }

          /* Posicionar el ticket arriba a la izquierda para la impresora */
          .thermal-print-only, #thermal-ticket-screen {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            margin: 0 !important;
            padding: 5mm !important;
          }

          @page {
            size: 80mm auto;
            margin: 0;
          }
        }
      `}</style>
      
      <div style={{ 
        width: '80mm', 
        fontFamily: '"Courier New", Courier, monospace', 
        fontSize: '12px', 
        padding: '10mm 5mm',
        lineHeight: '1.4',
        color: '#000',
        backgroundColor: '#fff'
      }}>
        {/* HEADER - Logo y Datos de la Empresa */}
        <div style={{ textAlign: 'center', marginBottom: '15px', paddingBottom: '10px', borderBottom: '1px dashed #000' }}>
          <div style={{ 
            fontSize: '20px', 
            fontWeight: 'bold', 
            letterSpacing: '2px',
            marginBottom: '6px'
          }}>
            LIMA CAFE 28
          </div>
          <div style={{ fontSize: '11px', marginBottom: '3px' }}>
            Kiosco Escolar
          </div>
          <div style={{ fontSize: '10px', marginBottom: '3px' }}>
            RUC: 20XXXXXXXXX
          </div>
          <div style={{ fontSize: '10px' }}>
            Av. Principal 123 - Lima, Perú
          </div>
          {documentType !== 'ticket' && (
            <div style={{ 
              fontSize: '11px', 
              fontWeight: 'bold',
              marginTop: '8px',
              padding: '5px',
              border: '2px solid #000',
              backgroundColor: '#000',
              color: '#fff'
            }}>
              {getDocumentTitle()}
            </div>
          )}
        </div>

        {/* DATOS DEL COMPROBANTE */}
        <div style={{ fontSize: '11px', marginBottom: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>TICKET:</td>
                <td style={{ textAlign: 'right', fontFamily: '"Courier New", monospace', fontWeight: 'bold', paddingBottom: '3px' }}>{ticketCode}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>FECHA:</td>
                <td style={{ textAlign: 'right', paddingBottom: '3px' }}>{format(date, "dd/MM/yyyy", { locale: es })}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>HORA:</td>
                <td style={{ textAlign: 'right', paddingBottom: '3px' }}>{format(date, "HH:mm:ss", { locale: es })}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>CAJERO:</td>
                <td style={{ textAlign: 'right', fontSize: '10px', paddingBottom: '3px' }}>{cashierEmail.split('@')[0].toUpperCase()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* DATOS DEL CLIENTE */}
        {(clientName !== 'CLIENTE GENÉRICO' || clientDNI || clientRUC) && (
          <div style={{ 
            fontSize: '11px', 
            marginBottom: '12px',
            paddingTop: '8px',
            paddingBottom: '8px',
            borderTop: '1px solid #000',
            borderBottom: '1px solid #000'
          }}>
            <div style={{ marginBottom: '3px' }}>
              <span style={{ fontWeight: 'bold' }}>CLIENTE:</span>
            </div>
            <div style={{ marginBottom: '2px', fontSize: '10px' }}>
              {clientName}
            </div>
            {documentType === 'boleta' && clientDNI && (
              <div style={{ fontSize: '10px' }}>
                <span style={{ fontWeight: 'bold' }}>DNI: </span>
                <span>{clientDNI}</span>
              </div>
            )}
            {documentType === 'factura' && clientRUC && (
              <div style={{ fontSize: '10px' }}>
                <span style={{ fontWeight: 'bold' }}>RUC: </span>
                <span>{clientRUC}</span>
              </div>
            )}
          </div>
        )}

        {/* ITEMS */}
        <div style={{ marginBottom: '12px' }}>
          <table style={{ 
            width: '100%', 
            borderCollapse: 'collapse',
            fontSize: '11px',
            marginBottom: '5px'
          }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #000' }}>
                <th style={{ textAlign: 'left', paddingBottom: '5px', fontWeight: 'bold' }}>CANT</th>
                <th style={{ textAlign: 'left', paddingBottom: '5px', fontWeight: 'bold' }}>DESCRIPCION</th>
                <th style={{ textAlign: 'right', paddingBottom: '5px', fontWeight: 'bold' }}>IMPORTE</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px dotted #999' }}>
                  <td style={{ paddingTop: '6px', paddingBottom: '6px', verticalAlign: 'top', fontWeight: 'bold' }}>
                    {item.quantity}
                  </td>
                  <td style={{ paddingTop: '6px', paddingBottom: '6px', paddingRight: '5px', verticalAlign: 'top' }}>
                    <div style={{ marginBottom: '2px', fontWeight: 'bold', fontSize: '11px' }}>
                      {item.product_name}
                    </div>
                    <div style={{ fontSize: '9px', color: '#444' }}>
                      S/ {item.unit_price.toFixed(2)} c/u
                    </div>
                  </td>
                  <td style={{ paddingTop: '6px', paddingBottom: '6px', textAlign: 'right', verticalAlign: 'top', fontWeight: 'bold' }}>
                    {item.subtotal.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* TOTAL */}
        <div style={{ 
          borderTop: '2px double #000',
          paddingTop: '10px',
          marginBottom: '15px'
        }}>
          <table style={{ width: '100%', fontSize: '14px', marginBottom: '8px' }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 'bold', fontSize: '16px' }}>TOTAL:</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '18px', letterSpacing: '1px' }}>
                  S/ {total.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
          
          {paymentMethod && (
            <div style={{ fontSize: '11px', marginBottom: '5px' }}>
              <span style={{ fontWeight: 'bold' }}>Pago: </span>
              <span>{paymentMethod.toUpperCase()}</span>
            </div>
          )}
          
          {newBalance !== undefined && (
            <div style={{ 
              fontSize: '11px',
              marginTop: '8px',
              padding: '6px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ddd',
              borderRadius: '3px'
            }}>
              <span style={{ fontWeight: 'bold' }}>Saldo restante: </span>
              <span style={{ fontWeight: 'bold' }}>S/ {newBalance.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ 
          borderTop: '1px dashed #000',
          paddingTop: '12px',
          textAlign: 'center',
          fontSize: '10px'
        }}>
          {isReprint && (
            <div style={{ 
              marginBottom: '10px',
              fontWeight: 'bold',
              fontSize: '11px',
              padding: '5px',
              border: '1px solid #000',
              backgroundColor: '#000',
              color: '#fff'
            }}>
              *** REIMPRESION ***
            </div>
          )}
          
          <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 'bold' }}>
            ¡Gracias por su compra!
          </div>
          
          <div style={{ marginBottom: '5px', fontSize: '10px' }}>
            Vuelva pronto
          </div>
          
          <div style={{ fontSize: '9px', color: '#666', marginTop: '10px' }}>
            Sistema ERP - ARQUISIA
          </div>
          
          {documentType !== 'ticket' && (
            <div style={{ 
              marginTop: '12px',
              fontSize: '8px',
              padding: '8px',
              border: '1px solid #000',
              lineHeight: '1.5'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                Representación impresa de
              </div>
              <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
                comprobante electrónico
              </div>
              <div>
                Consulte en: www.limacafe28.com
              </div>
            </div>
          )}
          
          <div style={{ 
            marginTop: '15px',
            fontSize: '10px',
            letterSpacing: '3px'
          }}>
            ================================
          </div>
        </div>
      </div>
    </div>
  );
};

