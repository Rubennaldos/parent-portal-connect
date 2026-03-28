import { supabase } from '@/lib/supabase';

/**
 * Obtiene el precio efectivo de un producto para una sede específica.
 * Si existe un precio personalizado, lo usa; si no, devuelve el precio base.
 * 
 * @param productId - ID del producto
 * @param schoolId - ID de la sede
 * @returns Objeto con price_sale, price_cost, is_available
 */
export async function getProductPriceForSchool(
  productId: string,
  schoolId: string
): Promise<{
  price_sale: number;
  price_cost: number | null;
  is_available: boolean;
  is_custom_price: boolean;
}> {
  try {
    // Obtener precio base del producto
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('price_sale, price_cost, active')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      throw new Error('Producto no encontrado');
    }

    // Buscar precio personalizado para esta sede
    const { data: customPrice, error: customError } = await supabase
      .from('product_school_prices')
      .select('price_sale, price_cost, is_available')
      .eq('product_id', productId)
      .eq('school_id', schoolId)
      .maybeSingle();

    // Si hay error pero no es "no encontrado", lanzar error
    if (customError && customError.code !== 'PGRST116') {
      throw customError;
    }

    // Si existe precio personalizado, usarlo; si no, usar el precio base
    if (customPrice) {
      return {
        price_sale: customPrice.price_sale,
        price_cost: customPrice.price_cost,
        is_available: customPrice.is_available,
        is_custom_price: true,
      };
    } else {
      return {
        price_sale: product.price_sale,
        price_cost: product.price_cost,
        is_available: product.active,
        is_custom_price: false,
      };
    }
  } catch (error) {
    console.error('Error obteniendo precio del producto:', error);
    throw error;
  }
}

/**
 * Obtiene todos los productos disponibles para una sede específica con sus precios efectivos.
 * 
 * @param schoolId - ID de la sede (null para obtener precios base)
 * @returns Array de productos con precios ajustados
 */
export async function getProductsForSchool(schoolId: string | null): Promise<any[]> {
  try {
    // Si no hay sede específica, devolver productos con precios base
    if (!schoolId) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('total_sales', { ascending: false, nullsFirst: false })
        .order('name', { ascending: true });

      if (error) throw error;
      return data || [];
    }

    // Obtener productos base SOLO de esta sede
    // Solo traer productos explícitamente asignados a esta sede
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .contains('school_ids', [schoolId]);

    if (productsError) throw productsError;

    if (!products || products.length === 0) {
      return [];
    }

    // Obtener todos los precios personalizados para esta sede de una sola vez
    const productIds = products.map(p => p.id);

    const [pricesResult, stockResult] = await Promise.all([
      supabase
        .from('product_school_prices')
        .select('product_id, price_sale, price_cost, is_available')
        .eq('school_id', schoolId)
        .in('product_id', productIds),
      supabase
        .from('product_stock')
        .select('product_id, current_stock, is_enabled')
        .eq('school_id', schoolId)
        .in('product_id', productIds),
    ]);

    if (pricesResult.error && pricesResult.error.code !== 'PGRST116') {
      throw pricesResult.error;
    }

    // Mapear precios personalizados por product_id
    const pricesMap = new Map(
      (pricesResult.data || []).map(cp => [cp.product_id, cp])
    );

    // Mapear stock por product_id
    const stockMap = new Map(
      (stockResult.data || []).map(s => [s.product_id, s])
    );

    // Combinar productos con sus precios efectivos y stock actual
    const productsWithPrices = products
      .map(product => {
        const customPrice = pricesMap.get(product.id);
        const stockRow    = stockMap.get(product.id);
        
        const base = {
          ...product,
          // Stock actual de esta sede (null si no hay registro en product_stock)
          current_stock: stockRow?.current_stock ?? null,
        };

        // Si existe precio personalizado, usarlo
        if (customPrice) {
          return {
            ...base,
            price: customPrice.price_sale,
            price_sale: customPrice.price_sale,
            price_cost: customPrice.price_cost,
            active: customPrice.is_available,
            is_custom_price: true,
          };
        }
        
        // Si no, usar precio base
        return {
          ...base,
          price: product.price_sale || product.price,
          is_custom_price: false,
        };
      })
      // Filtrar solo los que están disponibles
      .filter(p => p.active)
      // Ordenar por ventas y nombre
      .sort((a, b) => {
        const salesDiff = (b.total_sales || 0) - (a.total_sales || 0);
        if (salesDiff !== 0) return salesDiff;
        return (a.name || '').localeCompare(b.name || '');
      });

    return productsWithPrices;
  } catch (error) {
    console.error('Error obteniendo productos para sede:', error);
    throw error;
  }
}
