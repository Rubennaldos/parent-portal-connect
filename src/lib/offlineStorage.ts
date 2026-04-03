/**
 * ═══════════════════════════════════════════════════════════════════
 * 🔌 OFFLINE STORAGE — Cache local + Cola de transacciones offline
 * ═══════════════════════════════════════════════════════════════════
 *
 * Usa IndexedDB para almacenar:
 * - Alumnos de la sede (para búsqueda y NFC offline)
 * - Productos de la sede (para armar el carrito offline)
 * - Tarjetas NFC (para escanear offline)
 * - Cola de transacciones (ventas hechas sin internet)
 *
 * Diseño: Todo se guarda por school_id para multi-sede.
 */

const DB_NAME = 'limacafe28_offline';
const DB_VERSION = 1;

// Stores (tablas de IndexedDB)
const STORE_STUDENTS = 'students';
const STORE_PRODUCTS = 'products';
const STORE_NFC_CARDS = 'nfc_cards';
const STORE_TX_QUEUE = 'tx_queue';
const STORE_META = 'meta';

// ─── Abrir/crear base de datos IndexedDB ───────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Alumnos
      if (!db.objectStoreNames.contains(STORE_STUDENTS)) {
        const store = db.createObjectStore(STORE_STUDENTS, { keyPath: 'id' });
        store.createIndex('school_id', 'school_id', { unique: false });
        store.createIndex('full_name', 'full_name', { unique: false });
      }

      // Productos
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const store = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
        store.createIndex('school_id', '_school_id', { unique: false });
      }

      // Tarjetas NFC
      if (!db.objectStoreNames.contains(STORE_NFC_CARDS)) {
        const store = db.createObjectStore(STORE_NFC_CARDS, { keyPath: 'id' });
        store.createIndex('card_uid', 'card_uid', { unique: true });
        store.createIndex('school_id', 'school_id', { unique: false });
      }

      // Cola de transacciones offline
      if (!db.objectStoreNames.contains(STORE_TX_QUEUE)) {
        const store = db.createObjectStore(STORE_TX_QUEUE, { keyPath: 'offline_id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      // Metadata (última sincronización, etc.)
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
  });
}

// ─── Helpers genéricos ──────────────────────────────────────────

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllByIndex<T>(storeName: string, indexName: string, value: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putMany<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteByKey(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function putOne<T>(storeName: string, item: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 👦 CACHÉ DE ALUMNOS
// ═══════════════════════════════════════════════════════════════════

export async function cacheStudents(students: any[], schoolId: string): Promise<void> {
  try {
    // Marcar cada alumno con el school_id para filtrado
    const tagged = students.map(s => ({ ...s, school_id: s.school_id || schoolId }));
    await putMany(STORE_STUDENTS, tagged);
    await setMeta(`students_cached_${schoolId}`, new Date().toISOString());
    console.log(`💾 ${students.length} alumnos cacheados para sede ${schoolId}`);
  } catch (err) {
    console.warn('Error cacheando alumnos:', err);
  }
}

export async function getCachedStudents(schoolId: string): Promise<any[]> {
  try {
    return await getAllByIndex(STORE_STUDENTS, 'school_id', schoolId);
  } catch {
    return [];
  }
}

export async function searchCachedStudents(query: string, schoolId: string): Promise<any[]> {
  const all = await getCachedStudents(schoolId);
  const q = query.toLowerCase();
  return all
    .filter(s => s.full_name?.toLowerCase().includes(q) && s.is_active !== false)
    .slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════
// 📦 CACHÉ DE PRODUCTOS
// ═══════════════════════════════════════════════════════════════════

export async function cacheProducts(products: any[], schoolId: string): Promise<void> {
  try {
    const tagged = products.map(p => ({ ...p, _school_id: schoolId }));
    await putMany(STORE_PRODUCTS, tagged);
    await setMeta(`products_cached_${schoolId}`, new Date().toISOString());
    console.log(`💾 ${products.length} productos cacheados para sede ${schoolId}`);
  } catch (err) {
    console.warn('Error cacheando productos:', err);
  }
}

export async function getCachedProducts(schoolId: string): Promise<any[]> {
  try {
    return await getAllByIndex(STORE_PRODUCTS, 'school_id', schoolId);
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📡 CACHÉ DE TARJETAS NFC
// ═══════════════════════════════════════════════════════════════════

export async function cacheNFCCards(cards: any[]): Promise<void> {
  try {
    await putMany(STORE_NFC_CARDS, cards);
    await setMeta('nfc_cached', new Date().toISOString());
    console.log(`💾 ${cards.length} tarjetas NFC cacheadas`);
  } catch (err) {
    console.warn('Error cacheando tarjetas NFC:', err);
  }
}

export async function findNFCCardByUID(cardUID: string): Promise<any | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NFC_CARDS, 'readonly');
      const store = tx.objectStore(STORE_NFC_CARDS);
      const index = store.index('card_uid');
      const req = index.get(cardUID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📤 COLA DE TRANSACCIONES OFFLINE
// ═══════════════════════════════════════════════════════════════════

export interface OfflineTransaction {
  offline_id: string;
  created_at: string;
  status: 'pending' | 'syncing' | 'synced' | 'error';
  error_message?: string;
  // Datos de la venta
  client_mode: 'student' | 'generic' | 'teacher';
  student_id?: string;
  student_name?: string;
  teacher_id?: string;
  teacher_name?: string;
  school_id?: string;
  cashier_id: string;
  cashier_email: string;
  total: number;
  cart: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    barcode?: string;
  }>;
  payment_method?: string;
  payment_details?: any;
  // Para alumnos
  balance_before?: number;
  should_use_balance?: boolean;
  is_free_account?: boolean;
  // Ticket temporal
  temp_ticket_code: string;
}

export async function addToOfflineQueue(tx: OfflineTransaction): Promise<void> {
  try {
    await putOne(STORE_TX_QUEUE, tx);
    console.log(`📤 Venta guardada en cola offline: ${tx.temp_ticket_code}`);
  } catch (err) {
    console.error('Error guardando en cola offline:', err);
    throw err;
  }
}

export async function getPendingOfflineTransactions(): Promise<OfflineTransaction[]> {
  try {
    const all = await getAll<OfflineTransaction>(STORE_TX_QUEUE);
    return all
      .filter(t => t.status === 'pending' || t.status === 'error')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function getAllOfflineTransactions(): Promise<OfflineTransaction[]> {
  try {
    return await getAll<OfflineTransaction>(STORE_TX_QUEUE);
  } catch {
    return [];
  }
}

export async function updateOfflineTransaction(
  offlineId: string,
  updates: Partial<OfflineTransaction>
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TX_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_TX_QUEUE);
    const getReq = store.get(offlineId);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) {
        const updated = { ...existing, ...updates };
        store.put(updated);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function removeFromOfflineQueue(offlineId: string): Promise<void> {
  await deleteByKey(STORE_TX_QUEUE, offlineId);
}

export async function clearSyncedTransactions(): Promise<void> {
  const all = await getAll<OfflineTransaction>(STORE_TX_QUEUE);
  for (const tx of all) {
    if (tx.status === 'synced') {
      await deleteByKey(STORE_TX_QUEUE, tx.offline_id);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📊 METADATA
// ═══════════════════════════════════════════════════════════════════

async function setMeta(key: string, value: any): Promise<void> {
  await putOne(STORE_META, { key, value, updated_at: new Date().toISOString() });
}

export async function getMeta(key: string): Promise<any | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🔄 SINCRONIZACIÓN
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase';
import { calcBillingFlags } from './billingUtils';

/**
 * Precarga todos los datos necesarios para el POS offline.
 * Se llama al abrir el POS cuando hay conexión.
 */
export async function preloadPOSData(schoolId: string): Promise<{
  students: number;
  products: number;
  nfcCards: number;
}> {
  let studentCount = 0;
  let productCount = 0;
  let nfcCount = 0;

  try {
    // 1. Cargar TODOS los alumnos activos de la sede
    const { data: students } = await supabase
      .from('students')
      .select('id, full_name, photo_url, balance, grade, section, free_account, kiosk_disabled, school_id, is_active')
      .eq('school_id', schoolId)
      .eq('is_active', true);

    if (students && students.length > 0) {
      await cacheStudents(students, schoolId);
      studentCount = students.length;
    }
  } catch (err) {
    console.warn('Error precargando alumnos:', err);
  }

  try {
    // 2. Cargar productos (usa la misma función que el POS)
    const { getProductsForSchool } = await import('./productPricing');
    const products = await getProductsForSchool(schoolId);
    if (products.length > 0) {
      await cacheProducts(products, schoolId);
      productCount = products.length;
    }
  } catch (err) {
    console.warn('Error precargando productos:', err);
  }

  try {
    // 3. Cargar tarjetas NFC de la sede
    const { data: nfcCards } = await supabase
      .from('nfc_cards')
      .select('id, card_uid, card_number, holder_type, student_id, teacher_id, school_id, is_active')
      .eq('school_id', schoolId)
      .eq('is_active', true);

    if (nfcCards && nfcCards.length > 0) {
      await cacheNFCCards(nfcCards);
      nfcCount = nfcCards.length;
    }
  } catch (err) {
    console.warn('Error precargando NFC:', err);
  }

  console.log(`✅ Precarga POS completada: ${studentCount} alumnos, ${productCount} productos, ${nfcCount} tarjetas NFC`);
  return { students: studentCount, products: productCount, nfcCards: nfcCount };
}

/**
 * Sincroniza las transacciones pendientes de la cola offline con Supabase.
 * Retorna el número de transacciones sincronizadas exitosamente.
 */
export async function syncOfflineTransactions(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const pending = await getPendingOfflineTransactions();
  if (pending.length === 0) return { synced: 0, failed: 0, errors: [] };

  console.log(`🔄 Sincronizando ${pending.length} transacciones offline...`);

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const offlineTx of pending) {
    try {
      await updateOfflineTransaction(offlineTx.offline_id, { status: 'syncing' });

      // 1. Generar ticket code real
      let ticketCode = offlineTx.temp_ticket_code;
      try {
        const { data: realTicket } = await supabase.rpc('get_next_ticket_number', {
          p_user_id: offlineTx.cashier_id,
        });
        if (realTicket) ticketCode = realTicket;
      } catch {
        // Si falla, mantener el temporal
      }

      // 2. Si es alumno y descontaba saldo, verificar saldo fresco
      let newBalance = offlineTx.balance_before ?? 0;
      let shouldUseBalance = offlineTx.should_use_balance ?? false;

      if (offlineTx.client_mode === 'student' && offlineTx.student_id) {
        const { data: freshStudent } = await supabase
          .from('students')
          .select('balance, free_account')
          .eq('id', offlineTx.student_id)
          .single();

        if (freshStudent) {
          const currentBalance = freshStudent.balance ?? 0;
          shouldUseBalance = currentBalance >= offlineTx.total;
          newBalance = shouldUseBalance ? currentBalance - offlineTx.total : currentBalance;
        }
      }

      // 3. Crear transacción en Supabase
      const txData: any = {
        type: 'purchase',
        amount: -offlineTx.total,
        created_by: offlineTx.cashier_id,
        ticket_code: ticketCode,
        school_id: offlineTx.school_id || null,
        metadata: {
          ...offlineTx.payment_details,
          source: 'pos',
          synced_from_offline: true,
          offline_id: offlineTx.offline_id,
          offline_created_at: offlineTx.created_at,
        },
      };

      if (offlineTx.client_mode === 'student' && offlineTx.student_id) {
        txData.student_id = offlineTx.student_id;
        txData.balance_after = newBalance;
        txData.payment_status = shouldUseBalance ? 'paid' : 'pending';
        txData.payment_method = shouldUseBalance ? 'saldo' : null;
        txData.description = shouldUseBalance
          ? `Compra POS (Saldo) - S/ ${offlineTx.total.toFixed(2)} [OFFLINE]`
          : `Compra POS (Deuda) - S/ ${offlineTx.total.toFixed(2)} [OFFLINE]`;
      } else if (offlineTx.client_mode === 'teacher' && offlineTx.teacher_id) {
        txData.teacher_id = offlineTx.teacher_id;
        txData.student_id = null;
        txData.balance_after = 0;
        txData.payment_status = 'pending';
        txData.description = `Compra Profesor - S/ ${offlineTx.total.toFixed(2)} [OFFLINE]`;
      } else {
        txData.student_id = null;
        txData.balance_after = 0;
        txData.payment_status = 'paid';
        txData.payment_method = offlineTx.payment_method || 'efectivo';
        txData.description = `Venta Genérica POS - S/ ${offlineTx.total.toFixed(2)} [OFFLINE]`;
      }

      // Billing flags: usa el document_type guardado offline o 'ticket' por defecto
      const offlineDocType = (offlineTx as any).document_type ?? 'ticket';
      Object.assign(txData, calcBillingFlags(offlineDocType, txData.payment_method));

      const { data: transaction, error: txError } = await supabase
        .from('transactions')
        .insert(txData)
        .select()
        .single();

      if (txError) throw txError;

      // 4. Crear items
      const items = offlineTx.cart.map(item => ({
        transaction_id: transaction.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      }));

      await supabase.from('transaction_items').insert(items);

      // 5. Registrar en sales
      await supabase.from('sales').insert({
        transaction_id: transaction.id,
        student_id: offlineTx.student_id || null,
        school_id: offlineTx.school_id || null,
        cashier_id: offlineTx.cashier_id,
        total: offlineTx.total,
        subtotal: offlineTx.total,
        discount: 0,
        payment_method: txData.payment_method || 'efectivo',
        items: offlineTx.cart,
      });

      // 6. Actualizar saldo ATÓMICAMENTE si corresponde
      if (offlineTx.client_mode === 'student' && offlineTx.student_id && shouldUseBalance) {
        await supabase.rpc('adjust_student_balance', {
          p_student_id: offlineTx.student_id,
          p_amount: -offlineTx.total,
        });
      }

      // 7. Marcar como sincronizada
      await updateOfflineTransaction(offlineTx.offline_id, { status: 'synced' });
      synced++;
      console.log(`✅ TX offline sincronizada: ${offlineTx.temp_ticket_code} → ${ticketCode}`);
    } catch (err: any) {
      failed++;
      const errMsg = err?.message || 'Error desconocido';
      errors.push(`${offlineTx.temp_ticket_code}: ${errMsg}`);
      await updateOfflineTransaction(offlineTx.offline_id, {
        status: 'error',
        error_message: errMsg,
      });
      console.error(`❌ Error sincronizando TX offline ${offlineTx.temp_ticket_code}:`, err);
    }
  }

  // Limpiar las sincronizadas
  await clearSyncedTransactions();

  console.log(`🔄 Sincronización completada: ${synced} OK, ${failed} fallidas`);
  return { synced, failed, errors };
}
