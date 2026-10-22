import { createClient } from '@supabase/supabase-js';
import type { Receipt, ReceiptItem, ServerRegistryInfo, ShoppingItem, ShoppingList } from '../types';

export const SUPABASE_URL = 'https://gngrgkrypvrgcnkldbhx.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZ3Jna3J5cHZyZ2Nua2xkYmh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTkyNzEsImV4cCI6MjEwODI3NTI3MX0.uHp5_u0ASWy5P0BVjppDC1h4MdXJ-0KgqJl_JkwSMQI';

/**
 * Custom bounded fetch wrapper so slow/filtered mobile ISP networks in Iran NEVER stall UI!
 */
const boundedSupabaseFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal || controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: boundedSupabaseFetch },
  realtime: { params: { eventsPerSecond: 10 } },
});

const CACHE_KEYS = {
  lists: 'kharidyar_lists_v2',
  items: 'kharidyar_items_v2',
  receipts: 'kharidyar_receipts_v2',
};

const DEFAULT_FALLBACK_LISTS: ShoppingList[] = [
  {
    id: 'local-default-list',
    title: 'خرید هفتگی خانه',
    store_hint: 'فروشگاه زنجیره‌ای افق کوروش',
    status: 'active',
  },
];

const DEFAULT_FALLBACK_ITEMS: ShoppingItem[] = [
  {
    id: 'loc-1',
    list_id: 'local-default-list',
    name: 'شیر کم‌چرب',
    quantity: 2,
    unit: 'عدد',
    category: 'لبنیات',
    is_checked: false,
    reconcile_status: 'pending',
  },
  {
    id: 'loc-2',
    list_id: 'local-default-list',
    name: 'پنیر فتا',
    quantity: 1,
    unit: 'بسته',
    category: 'لبنیات',
    is_checked: false,
    reconcile_status: 'pending',
  },
  {
    id: 'loc-3',
    list_id: 'local-default-list',
    name: 'تخم‌مرغ',
    quantity: 1,
    unit: 'شانه',
    category: 'پروتئین',
    is_checked: false,
    reconcile_status: 'pending',
  },
  {
    id: 'loc-4',
    list_id: 'local-default-list',
    name: 'نان تست',
    quantity: 1,
    unit: 'بسته',
    category: 'نان و غلات',
    is_checked: false,
    reconcile_status: 'pending',
  },
  {
    id: 'loc-5',
    list_id: 'local-default-list',
    name: 'ماست یونانی',
    quantity: 1,
    unit: 'سطل',
    category: 'لبنیات',
    is_checked: false,
    reconcile_status: 'pending',
  },
  {
    id: 'loc-6',
    list_id: 'local-default-list',
    name: 'روغن مایع',
    quantity: 1,
    unit: 'بطری',
    category: 'خواربار',
    is_checked: false,
    reconcile_status: 'pending',
  },
  {
    id: 'loc-7',
    list_id: 'local-default-list',
    name: 'گوجه فرنگی',
    quantity: 2,
    unit: 'کیلو',
    category: 'میوه و سبزیجات',
    is_checked: false,
    reconcile_status: 'pending',
  },
];

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalStateMirror(
  lists: ShoppingList[],
  items: ShoppingItem[],
  receipts: Receipt[]
) {
  try {
    localStorage.setItem(CACHE_KEYS.lists, JSON.stringify(lists));
    localStorage.setItem(CACHE_KEYS.items, JSON.stringify(items));
    localStorage.setItem(CACHE_KEYS.receipts, JSON.stringify(receipts));
  } catch {
    // ignore storage quota errors
  }
}

export async function fetchAllAppData(): Promise<{
  lists: ShoppingList[];
  items: ShoppingItem[];
  receipts: Receipt[];
  cloudConnected: boolean;
}> {
  try {
    const [listsRes, itemsRes, receiptsRes, receiptItemsRes] = await Promise.all([
      supabase.from('shopping_lists').select('*').order('created_at', { ascending: true }),
      supabase.from('shopping_items').select('*').order('created_at', { ascending: true }),
      supabase.from('receipts').select('*').order('created_at', { ascending: false }),
      supabase.from('receipt_items').select('*').order('created_at', { ascending: true }),
    ]);

    if (listsRes.error) throw listsRes.error;

    const lists = (listsRes.data || []) as ShoppingList[];
    const items = (itemsRes.data || []) as ShoppingItem[];
    const allRecItems = (receiptItemsRes.data || []) as ReceiptItem[];

    const receipts = ((receiptsRes.data || []) as Receipt[]).map((r) => ({
      ...r,
      items: allRecItems.filter((ri) => ri.receipt_id === r.id),
    }));

    writeLocalStateMirror(lists, items, receipts);

    return { lists, items, receipts, cloudConnected: true };
  } catch (err) {
    console.warn('[Supabase] Fast offline local cache active:', err);
    return {
      lists: readCache<ShoppingList[]>(CACHE_KEYS.lists, DEFAULT_FALLBACK_LISTS),
      items: readCache<ShoppingItem[]>(CACHE_KEYS.items, DEFAULT_FALLBACK_ITEMS),
      receipts: readCache<Receipt[]>(CACHE_KEYS.receipts, []),
      cloudConnected: false,
    };
  }
}

export async function createShoppingListDb(title: string, storeHint?: string): Promise<ShoppingList> {
  try {
    const { data, error } = await supabase
      .from('shopping_lists')
      .insert({ title, store_hint: storeHint || null, status: 'active' })
      .select()
      .single();
    if (!error && data) return data as ShoppingList;
  } catch {
    // offline fallback
  }
  return {
    id: crypto.randomUUID(),
    title,
    store_hint: storeHint || null,
    status: 'active',
  };
}

export async function addShoppingItemDb(item: {
  list_id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
}): Promise<ShoppingItem> {
  try {
    const { data, error } = await supabase
      .from('shopping_items')
      .insert({
        ...item,
        is_checked: false,
        reconcile_status: 'pending',
      })
      .select()
      .single();
    if (!error && data) return data as ShoppingItem;
  } catch {
    // offline fallback
  }
  return {
    id: crypto.randomUUID(),
    ...item,
    is_checked: false,
    reconcile_status: 'pending',
  };
}

export async function toggleShoppingItemDb(itemId: string, isChecked: boolean) {
  try {
    await supabase
      .from('shopping_items')
      .update({
        is_checked: isChecked,
        reconcile_status: isChecked ? 'matched' : 'pending',
      })
      .eq('id', itemId);
  } catch {
    // offline safe
  }
}

export async function deleteShoppingItemDb(itemId: string) {
  try {
    await supabase.from('shopping_items').delete().eq('id', itemId);
  } catch {
    // offline safe
  }
}

export async function resetListReconciliationDb(listId: string) {
  try {
    await supabase
      .from('shopping_items')
      .update({
        is_checked: false,
        reconcile_status: 'pending',
        matched_receipt_id: null,
        matched_item_name: null,
        matched_price: null,
      })
      .eq('list_id', listId);
  } catch {
    // offline safe
  }
}

export async function uploadReceiptImageToCloud(blobOrDataUrl: Blob | string): Promise<string | null> {
  try {
    let blob: Blob;
    if (typeof blobOrDataUrl === 'string') {
      const resp = await fetch(blobOrDataUrl);
      blob = await resp.blob();
    } else {
      blob = blobOrDataUrl;
    }
    const filePath = `scans/receipt-${Date.now()}-${Math.round(Math.random() * 1e5)}.jpg`;
    const { error } = await supabase.storage.from('receipt-images').upload(filePath, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });
    if (error) return null;
    const { data } = supabase.storage.from('receipt-images').getPublicUrl(filePath);
    return data.publicUrl;
  } catch {
    return null;
  }
}

export async function saveScannedReceiptAndReconcileDb(params: {
  receipt: Omit<Receipt, 'id'> & { items: ReceiptItem[] };
  reconciledListId?: string | null;
  reconciliationItems?: Array<{
    shoppingItemId: string;
    status: 'matched' | 'missing';
    matchedReceiptItemName: string | null;
    matchedPrice: number | null;
  }>;
  missingNames?: string[];
  extraCount?: number;
  sourceDevice: string;
}): Promise<Receipt> {
  const { items, ...receiptHeader } = params.receipt;
  const fallbackLocalReceipt: Receipt = {
    id: crypto.randomUUID(),
    ...receiptHeader,
    items,
    created_at: new Date().toISOString(),
  };

  try {
    // Avoid sending megabyte base64 strings into DB text columns; upload cleanly if needed
    let finalImageUrl = receiptHeader.image_url || null;
    if (finalImageUrl && finalImageUrl.startsWith('data:')) {
      const cloudUrl = await uploadReceiptImageToCloud(finalImageUrl);
      finalImageUrl = cloudUrl || null;
    }
    const finalProcessedUrl =
      receiptHeader.processed_image_url && !receiptHeader.processed_image_url.startsWith('data:')
        ? receiptHeader.processed_image_url
        : finalImageUrl;

    const { data: savedHeader, error: headerErr } = await supabase
      .from('receipts')
      .insert({
        store_name: receiptHeader.store_name,
        store_category: receiptHeader.store_category,
        jalali_date: receiptHeader.jalali_date,
        receipt_number: receiptHeader.receipt_number || null,
        subtotal: Math.round(receiptHeader.subtotal || 0),
        discount_total: Math.round(receiptHeader.discount_total || 0),
        tax_total: Math.round(receiptHeader.tax_total || 0),
        total_amount: Math.round(receiptHeader.total_amount || 0),
        currency: receiptHeader.currency || 'تومان',
        ocr_engine: receiptHeader.ocr_engine || 'OpenCV 5.0 + Persian LSTM OCR',
        ocr_confidence: receiptHeader.ocr_confidence || 96,
        raw_ocr_text: receiptHeader.raw_ocr_text || null,
        image_url: finalImageUrl,
        processed_image_url: finalProcessedUrl,
        reconciled_list_id: params.reconciledListId || null,
        missing_items_snapshot: params.missingNames || [],
        extra_items_count: params.extraCount || 0,
        source_device: params.sourceDevice,
      })
      .select()
      .single();

    if (headerErr || !savedHeader) {
      return fallbackLocalReceipt;
    }

    const receiptId = savedHeader.id as string;
    const rowsToInsert = items.map((it) => ({
      receipt_id: receiptId,
      name: it.name,
      quantity: it.quantity || 1,
      unit: it.unit || 'عدد',
      unit_price: Math.round(it.unit_price || 0),
      total_price: Math.round(it.total_price || 0),
      discount: Math.round(it.discount || 0),
      category: it.category || 'خواربار',
      matched_shopping_item_id: it.matched_shopping_item_id || null,
      confidence: it.confidence || 95,
      bbox: it.bbox || null,
    }));

    const { data: insertedItems } = await supabase
      .from('receipt_items')
      .insert(rowsToInsert)
      .select();

    if (params.reconciledListId && params.reconciliationItems?.length) {
      await Promise.all(
        params.reconciliationItems.map(async (rec) => {
          if (rec.status === 'matched') {
            await supabase
              .from('shopping_items')
              .update({
                is_checked: true,
                reconcile_status: 'matched',
                matched_receipt_id: receiptId,
                matched_item_name: rec.matchedReceiptItemName,
                matched_price: rec.matchedPrice ? Math.round(rec.matchedPrice) : null,
              })
              .eq('id', rec.shoppingItemId);
          } else {
            await supabase
              .from('shopping_items')
              .update({ reconcile_status: 'missing' })
              .eq('id', rec.shoppingItemId)
              .eq('is_checked', false);
          }
        })
      );
    }

    return {
      ...(savedHeader as Receipt),
      image_url: finalImageUrl || receiptHeader.image_url,
      items: (insertedItems as ReceiptItem[]) || items,
    };
  } catch {
    return fallbackLocalReceipt;
  }
}

export async function deleteReceiptDb(receiptId: string) {
  try {
    await supabase.from('receipts').delete().eq('id', receiptId);
  } catch {
    // offline safe
  }
}

export async function syncOrDiscoverServerEndpoint(apkFallbackUrl: string): Promise<{
  serverUrl: string;
  isNativeApp: boolean;
  serverOnline: boolean;
  apkDownloadUrl: string;
  cvEngine: string;
}> {
  const customOverride = localStorage.getItem('kharidyar_custom_server_url')?.trim() || '';
  const origin = window.location.origin;
  const isCapacitorNative =
    origin.startsWith('capacitor://') ||
    origin === 'http://localhost' ||
    origin === 'https://localhost';

  if (!isCapacitorNative && !customOverride) {
    try {
      const resp = await fetch('/api/health');
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && ct.includes('application/json')) {
        const health = await resp.json();
        const apkUrl = health.apkReady ? `${origin}/api/download/apk` : apkFallbackUrl;
        // Fire-and-forget non-blocking registration so UI never waits on cloud timeout!
        void supabase
          .from('server_registry')
          .upsert({
            id: 'primary',
            server_url: origin,
            cv_engine: health.cvEngine || 'OpenCV 5.0 + Dual-Head Persian LSTM OCR',
            apk_download_url: apkUrl,
            apk_version: '1.1.0',
            status: 'online',
            last_heartbeat: new Date().toISOString(),
          })
          .then(
            () => {},
            () => {}
          );
        return {
          serverUrl: origin,
          isNativeApp: false,
          serverOnline: true,
          apkDownloadUrl: apkUrl,
          cvEngine: health.cvEngine,
        };
      }
    } catch {
      // ignore
    }
  }

  let candidateUrl = customOverride;
  let discoveredApkUrl = apkFallbackUrl;
  if (!candidateUrl) {
    try {
      const { data } = await supabase
        .from('server_registry')
        .select('*')
        .eq('id', 'primary')
        .maybeSingle();
      const reg = data as ServerRegistryInfo | null;
      if (reg?.server_url) {
        candidateUrl = reg.server_url;
      }
      if (reg?.apk_download_url) {
        discoveredApkUrl = reg.apk_download_url;
      }
    } catch {
      // ignore
    }
  }

  if (candidateUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch(`${candidateUrl.replace(/\/$/, '')}/api/health`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && ct.includes('application/json')) {
        const health = await resp.json();
        return {
          serverUrl: candidateUrl.replace(/\/$/, ''),
          isNativeApp: isCapacitorNative,
          serverOnline: true,
          apkDownloadUrl: discoveredApkUrl,
          cvEngine: health.cvEngine || 'OpenCV 5.0 + Dual-Head Persian LSTM OCR',
        };
      }
    } catch {
      // Server unreachable -> seamless autonomous on-device neural engine!
    }
  }

  return {
    serverUrl: candidateUrl || origin,
    isNativeApp: isCapacitorNative,
    serverOnline: false,
    apkDownloadUrl: discoveredApkUrl,
    cvEngine: 'موتور عصبی داخلی موبایل (On-Device Persian LSTM OCR)',
  };
}
