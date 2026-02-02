/**
 * Servicio de Impresión para POS
 * Maneja la impresión automática de tickets y comandas según configuración
 */

import { supabase } from './supabase';
import { 
  printTicketDirect, 
  generateTicketContent, 
  generateComandaContent,
  isQZTrayAvailable 
} from './printerService';
import { printTicketHTML, printComandaHTML, isHTMLPrintAvailable } from './htmlPrinterService';
import type { TicketData, ComandaData } from './htmlPrinterService';

interface PrintConfig {
  printer_device_name: string;
  business_name: string;
  business_ruc: string | null;
  business_address: string | null;
  business_phone: string | null;
  print_header: boolean;
  header_text: string;
  print_footer: boolean;
  footer_text: string;
  auto_cut_paper: boolean;
  cut_mode: 'partial' | 'full';
  qr_prefix: string;
  auto_generate_qr: boolean;
  
  // Comanda
  print_comanda: boolean;
  comanda_header: string;
  print_separate_comanda: boolean;
  comanda_copies: number;
  
  // Por tipo de venta
  print_ticket_general: boolean;
  print_comanda_general: boolean;
  print_ticket_credit: boolean;
  print_comanda_credit: boolean;
  print_ticket_teacher: boolean;
  print_comanda_teacher: boolean;
  
  // Cajón de dinero
  open_cash_drawer?: boolean;
  cash_drawer_pin?: number;
  open_drawer_on_general?: boolean;
  open_drawer_on_credit?: boolean;
  open_drawer_on_teacher?: boolean;
}

interface CartItem {
  product: {
    id: string;
    name: string;
    price: number;
  };
  quantity: number;
}

interface SaleData {
  ticketCode: string;
  clientName: string;
  cart: CartItem[];
  total: number;
  paymentMethod: 'cash' | 'card' | 'credit' | 'teacher';
  saleType: 'general' | 'credit' | 'teacher';
  schoolId: string;
}

/**
 * Obtener configuración de impresora para una sede
 */
async function getPrinterConfig(schoolId: string): Promise<PrintConfig | null> {
  try {
    const { data, error } = await supabase
      .from('printer_configs')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      console.warn('⚠️ No hay configuración de impresora activa para esta sede');
      return null;
    }

    return data;
  } catch (error) {
    console.error('❌ Error obteniendo configuración de impresora:', error);
    return null;
  }
}

/**
 * Determinar si debe imprimir ticket según tipo de venta y configuración
 */
function shouldPrintTicket(config: PrintConfig, saleType: string): boolean {
  switch (saleType) {
    case 'general':
      return config.print_ticket_general;
    case 'credit':
      return config.print_ticket_credit;
    case 'teacher':
      return config.print_ticket_teacher;
    default:
      return false;
  }
}

/**
 * Determinar si debe imprimir comanda según tipo de venta y configuración
 */
function shouldPrintComanda(config: PrintConfig, saleType: string): boolean {
  if (!config.print_comanda) return false;
  
  switch (saleType) {
    case 'general':
      return config.print_comanda_general;
    case 'credit':
      return config.print_comanda_credit;
    case 'teacher':
      return config.print_comanda_teacher;
    default:
      return false;
  }
}

/**
 * Determinar si debe abrir el cajón de dinero según tipo de venta y configuración
 */
function shouldOpenCashDrawer(config: PrintConfig, saleType: string): boolean {
  if (!config.open_cash_drawer) return false;
  
  switch (saleType) {
    case 'general':
      return config.open_drawer_on_general ?? true;
    case 'credit':
      return config.open_drawer_on_credit ?? false;
    case 'teacher':
      return config.open_drawer_on_teacher ?? false;
    default:
      return false;
  }
}

/**
 * Imprimir venta desde POS
 * Se ejecuta automáticamente después de completar una venta
 * Intenta usar QZ Tray primero, si falla usa impresión HTML
 */
export async function printPOSSale(saleData: SaleData): Promise<void> {
  try {
    // Obtener configuración de impresora
    const config = await getPrinterConfig(saleData.schoolId);
    
    // Intentar QZ Tray con timeout
    let qzAvailable = false;
    try {
      console.log('🔍 Verificando QZ Tray...');
      qzAvailable = await Promise.race([
        isQZTrayAvailable(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)) // 3 segundos timeout
      ]);
    } catch (error) {
      console.warn('⚠️ Error verificando QZ Tray:', error);
      qzAvailable = false;
    }
    
    // Si QZ Tray NO está disponible, usar impresión HTML
    if (!qzAvailable) {
      console.warn('⚠️ QZ Tray no disponible - Usando impresión HTML');
      return await printPOSSaleHTML(saleData, config);
    }
    
    console.log('✅ QZ Tray disponible - Intentando imprimir...');
    
    if (!config) {
      console.warn('⚠️ Sin configuración de impresora - Usando impresión HTML como fallback');
      return await printPOSSaleHTML(saleData, null);
    }

    const printTicket = shouldPrintTicket(config, saleData.saleType);
    const printComanda = shouldPrintComanda(config, saleData.saleType);
    const openDrawer = shouldOpenCashDrawer(config, saleData.saleType);

    console.log(`🖨️ Imprimiendo venta ${saleData.saleType}:`, {
      ticket: printTicket,
      comanda: printComanda,
      drawer: openDrawer
    });

    // Preparar items para ticket
    const ticketItems = saleData.cart.map(item => ({
      name: item.product.name,
      price: item.product.price,
      quantity: item.quantity
    }));

    // Preparar items para comanda
    const comandaItems = saleData.cart.map(item => ({
      name: item.product.name,
      quantity: item.quantity
    }));

    // IMPRIMIR TICKET
    if (printTicket) {
      try {
        const ticketContent = generateTicketContent(
          config.business_name,
          config.business_ruc,
          config.business_address,
          config.business_phone,
          saleData.ticketCode,
          ticketItems,
          saleData.total,
          config.print_header ? config.header_text : undefined,
          config.print_footer ? config.footer_text : undefined
        );

        await printTicketDirect(
          config.printer_device_name,
          ticketContent,
          config.auto_cut_paper,
          config.cut_mode,
          openDrawer  // 💰 Abrir cajón si está configurado
        );

        console.log('✅ Ticket impreso');
        if (openDrawer) {
          console.log('💰 Cajón de dinero abierto');
        }
      } catch (error) {
        console.error('❌ Error imprimiendo ticket:', error);
      }
    }

    // IMPRIMIR COMANDA
    if (printComanda) {
      try {
        // Imprimir según número de copias configurado
        for (let i = 0; i < (config.comanda_copies || 1); i++) {
          const comandaContent = generateComandaContent(
            config.comanda_header,
            saleData.ticketCode,
            comandaItems,
            saleData.clientName
          );

          await printTicketDirect(
            config.printer_device_name,
            comandaContent,
            config.auto_cut_paper,
            config.cut_mode
          );

          console.log(`✅ Comanda ${i + 1}/${config.comanda_copies} impresa`);
        }
      } catch (error) {
        console.error('❌ Error imprimiendo comanda:', error);
      }
    }

    if (!printTicket && !printComanda) {
      console.log('ℹ️ No hay nada configurado para imprimir para este tipo de venta');
    }

  } catch (error) {
    console.error('❌ Error general en printPOSSale con QZ Tray:', error);
    console.log('🔄 Intentando con impresión HTML como fallback...');
    
    // Fallback a HTML si QZ Tray falla
    try {
      const config = await getPrinterConfig(saleData.schoolId);
      await printPOSSaleHTML(saleData, config);
    } catch (htmlError) {
      console.error('❌ Error también con HTML:', htmlError);
      // No lanzar error - la venta ya se completó exitosamente
    }
  }
}

/**
 * Imprimir venta usando HTML (fallback cuando QZ Tray no está disponible)
 */
async function printPOSSaleHTML(saleData: SaleData, config: PrintConfig | null): Promise<void> {
  try {
    console.log('🖨️ Imprimiendo con HTML (sin QZ Tray)');
    
    // Determinar si debe imprimir ticket y/o comanda
    const shouldPrintTicketNow = config ? shouldPrintTicket(config, saleData.saleType) : true;
    const shouldPrintComandaNow = config ? shouldPrintComanda(config, saleData.saleType) : 
                                   (saleData.saleType === 'credit' || saleData.saleType === 'teacher');
    
    // IMPRIMIR TICKET (si está configurado)
    if (shouldPrintTicketNow) {
      // Preparar datos del ticket para HTML
      const ticketData: TicketData = {
        businessName: config?.business_name || 'LIMA CAFÉ 28',
        businessRuc: config?.business_ruc || null,
        businessAddress: config?.business_address || null,
        businessPhone: config?.business_phone || null,
        ticketCode: saleData.ticketCode,
        date: new Date().toLocaleString('es-PE'),
        clientName: saleData.clientName,
        items: saleData.cart.map(item => ({
          name: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          total: item.product.price * item.quantity
        })),
        subtotal: saleData.total / 1.18, // Sin IGV
        tax: saleData.total - (saleData.total / 1.18), // IGV 18%
        total: saleData.total,
        paymentMethod: saleData.paymentMethod === 'cash' ? 'Efectivo' : 
                       saleData.paymentMethod === 'card' ? 'Tarjeta' :
                       saleData.paymentMethod === 'credit' ? 'Crédito' :
                       saleData.paymentMethod === 'teacher' ? 'Profesor' : 'Otro',
        headerText: config?.print_header ? config.header_text : undefined,
        footerText: config?.print_footer ? config.footer_text : undefined,
        // 🎨 Configuración de formato (respetando módulo de impresoras)
        logoUrl: config?.logo_url,
        logoWidth: config?.logo_width || 120,
        logoHeight: config?.logo_height || 60,
        paperWidth: config?.paper_width || 80,
        fontSize: config?.font_size || 'normal',
        fontFamily: config?.font_family || 'monospace',
        showQr: config?.show_qr_code || config?.auto_generate_qr || false,
        qrPrefix: config?.qr_prefix || 'TKT'
      };
      
      // Imprimir ticket
      printTicketHTML(ticketData);
      console.log('✅ Ticket HTML generado');
    }
    
    // IMPRIMIR COMANDA (si está configurado o es crédito/profesor)
    if (shouldPrintComandaNow) {
      // Pequeño delay para que no se abran ambas ventanas al mismo tiempo
      setTimeout(() => {
        const comandaData: ComandaData = {
          ticketCode: saleData.ticketCode,
          date: new Date().toLocaleString('es-PE'),
          clientName: saleData.clientName,
          items: saleData.cart.map(item => ({
            name: item.product.name,
            quantity: item.quantity
          })),
          headerText: config?.comanda_header || '🍽️ COMANDA COCINA',
          // 🎨 Configuración de formato (respetando módulo de impresoras)
          paperWidth: config?.paper_width || 80,
          fontSize: config?.font_size || 'normal',
          fontFamily: config?.font_family || 'monospace',
          showQr: config?.auto_generate_qr || false,
          qrPrefix: config?.qr_prefix || 'CMD'
        };
        
        printComandaHTML(comandaData);
        console.log('✅ Comanda HTML generada');
      }, 800); // 800ms después del ticket
    }
    
    console.log('ℹ️  Ventanas de impresión abiertas - El usuario puede imprimir con Ctrl+P');
    
  } catch (error) {
    console.error('❌ Error al imprimir con HTML:', error);
    throw error;
  }
}

export default {
  printPOSSale
};
