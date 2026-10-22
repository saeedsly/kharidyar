import { createClient } from '@supabase/supabase-js';
import type { Receipt, ReceiptItem, ServerRegistryInfo, ShoppingItem, ShoppingList } from '../types';

export const SUPABASE_URL = 'https://gngrgkrypvrgcnkldbhx.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZ3Jna3J5cHZyZ2Nua2xkYmh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTkyNzEsImV4cCI6MjEwODI3NTI3MX0.uHp5_u0ASWy5P0BVjppDC1h4MdXJ-0KgqJl_JkwSMQI';

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

const WORKSPACE_STORAGE_KEY = 'kharidyar_workspace_code_v1';

export function getWorkspaceId(): string {
  try {
    const existing = localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim().toUpperCase();
    if (existing && existing.length >= 4) return existing;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let randomPart = '';
    for (let i = 0; i < 6; i++) {
      randomPart += chars[Math.floor(Math.random() * chars.length)];
    }
    const generated = `KY-${randomPart}`;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'default';
  }
}

export function setWorkspaceId(newCode: string): string {
  const cleaned = newCode.trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  const finalCode = cleaned.length >= 4 ? cleaned : getWorkspaceId();
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, finalCode);
  } catch {
    // ignore
  }
  return finalCode;
}

function getCacheKeys(wsId: string) {
  return {
    lists: `kharidyar_${wsId}_lists`,
    items: `kharidyar_${wsId}_items`,
    receipts: `kharidyar_${wsId}_receipts`,
  };
}

const STARTER_ITEMS_TEMPLATE = [
  { name: 'شیر کم‌چرب', quantity: 2, unit: 'عدد', category: 'لبنیات' },
  { name: 'پنیر فتا', quantity: 1, unit: 'بسته', category: 'لبنیات' },
  { name: 'تخم‌مرغ', quantity: 1, unit: 'شانه', category: 'پروتئین' },
  { name: 'نان تست', quantity: 1, unit: 'بسته', category: 'نان و غلات' },
  { name: 'ماست یونانی', quantity: 1, unit: 'سطل', category: 'لبنیات' },
  { name: 'روغن مایع', quantity: 1, unit: 'بطری', category: 'خواربار' },
  { name: 'گوجه فرنگی', quantity: 2, unit: 'کیلو', category: 'میوه و سبزیجات' },
];

function buildLocalFallbackData() {
  const listId = 'local-starter-list';
  const lists: ShoppingList[] = [
    {
      id: listId,
      title: 'خرید هفتگی خانه',
      store_hint: 'فروشگاه زنجیره‌ای افق کوروش',
      status: 'active',
    },
  ];
  const items: ShoppingItem[] = STARTER_ITEMS_TEMPLATE.map((t, idx) => ({
    id: `starter-${idx + 1}`,
    list_id: listId,
    name: t.name,
    quantity: t.quantity,
    unit: t.unit,
    category: t.category,
    is_checked: false,
    reconcile_status: 'pending',
  }));
  const receipts: Receipt[] = [
    {
      id: 'starter-rec-1',
      store_name: 'هایپراستار باکری',
      store_category: 'سوپرمارکت',
      jalali_date: '۱۴۰۵/۰۷/۲۸',
      receipt_number: 'HS-88412',
      subtotal: 555000,
      discount_total: 45000,
      tax_total: 0,
      total_amount: 510000,
      currency: 'تومان',
      ocr_engine: 'OpenCV 5.0 + Persian LSTM OCR',
      ocr_confidence: 97.4,
      items: [
        {
          name: 'فیله مرغ تازه پروتئین',
          quantity: 2,
          unit: 'بسته',
          unit_price: 165000,
          total_price: 330000,
          discount: 0,
          category: 'پروتئین',
          confidence: 98,
        },
        {
          name: 'قهوه ترک ویژه بن‌مانو',
          quantity: 1,
          unit: 'بسته',
          unit_price: 180000,
          total_price: 180000,
          discount: 0,
          category: 'نوشیدنی',
          confidence: 97,
        },
      ],
    },
  ];
  return { lists, items, receipts };
}

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
  const keys = getCacheKeys(getWorkspaceId());
  try {
    localStorage.setItem(keys.lists, JSON.stringify(lists));
    localStorage.setItem(keys.items, JSON.stringify(items));
    localStorage.setItem(keys.receipts, JSON.stringify(receipts));
  } catch {
    // ignore storage quota errors
  }
}

async function seedNewWorkspaceCloud(wsId: string): Promise<{
  lists: ShoppingList[];
  items: ShoppingItem[];
  receipts: Receipt[];
}> {
  const { data: createdList, error } = await supabase
    .from('shopping_lists')
    .insert({
      workspace_id: wsId,
      title: 'خرید هفتگی خانه',
      store_hint: 'فروشگاه زنجیره‌ای افق کوروش',
      status: 'active',
    })
    .select()
    .single();

  if (error || !createdList) {
    return buildLocalFallbackData();
  }

  const { data: createdItems } = await supabase
    .from('shopping_items')
    .insert(
      STARTER_ITEMS_TEMPLATE.map((t) => ({
        workspace_id: wsId,
        list_id: createdList.id,
        name: t.name,
        quantity: t.quantity,
        unit: t.unit,
        category: t.category,
        is_checked: false,
        reconcile_status: 'pending',
      }))
    )
    .select();

  const { data: sampleRec } = await supabase
    .from('receipts')
    .insert({
      workspace_id: wsId,
      store_name: 'هایپراستار باکری',
      store_category: 'سوپرمارکت',
      jalali_date: '۱۴۰۵/۰۷/۲۸',
      receipt_number: 'HS-88412',
      subtotal: 555000,
      discount_total: 45000,
      tax_total: 0,
      total_amount: 510000,
      currency: 'تومان',
      ocr_engine: 'OpenCV 5.0 + Persian LSTM OCR',
      ocr_confidence: 97.4,
      source_device: 'web',
    })
    .select()
    .single();

  let recItems: ReceiptItem[] = [];
  if (sampleRec) {
    const { data: insRecItems } = await supabase
      .from('receipt_items')
      .insert([
        {
          receipt_id: sampleRec.id,
          name: 'فیله مرغ تازه ممتاز',
          quantity: 2,
          unit: 'بسته',
          unit_price: 165000,
          total_price: 330000,
          discount: 0,
          category: 'پروتئین',
          confidence: 98,
        },
        {
          name: 'قهوه ترک ویژه بن‌مانو',
          quantity: 1,
          unit: 'بسته',
          unit_price: 180000,
          total_price: 180000,
          discount: 0,
          category: 'نوشیدنی',
          confidence: 97,
        },
      ])
      .select();
    recItems = (insRecItems as ReceiptItem[]) || [];
  }

  return {
    lists: [createdList as ShoppingList],
    items: (createdItems as ShoppingItem[]) || [],
    receipts: sampleRec ? [{ ...(sampleRec as Receipt), items: recItems }] : [],
  };
}

export async function fetchAllAppData(): Promise<{
  lists: ShoppingList[];
  items: ShoppingItem[];
  receipts: Receipt[];
  cloudConnected: boolean;
}> {
  const wsId = getWorkspaceId();
  const keys = getCacheKeys(wsId);

  try {
    const [listsRes, itemsRes, receiptsRes] = await Promise.all([
      supabase
        .from('shopping_lists')
        .select('*')
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: true }),
      supabase
        .from('shopping_items')
        .select('*')
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: true }),
      supabase
        .from('receipts')
        .select('*')
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: false }),
    ]);

    if (listsRes.error) throw listsRes.error;

    const existingLists = (listsRes.data || []) as ShoppingList[];
    const existingReceipts = (receiptsRes.data || []) as Receipt[];

    // First-time visitor initialization for this personal workspace!
    const wasClearedIntentionally = localStorage.getItem(`kharidyar_${wsId}_cleared`) === '1';
    if (existingLists.length === 0 && existingReceipts.length === 0 && !wasClearedIntentionally) {
      const seeded = await seedNewWorkspaceCloud(wsId);
      writeLocalStateMirror(seeded.lists, seeded.items, seeded.receipts);
      return { ...seeded, cloudConnected: true };
    }

    const receiptIds = existingReceipts.map((r) => r.id);
    let allRecItems: ReceiptItem[] = [];
    if (receiptIds.length > 0) {
      const { data: riData } = await supabase
        .from('receipt_items')
        .select('*')
        .in('receipt_id', receiptIds)
        .order('created_at', { ascending: true });
      allRecItems = (riData as ReceiptItem[]) || [];
    }

    const items = (itemsRes.data || []) as ShoppingItem[];
    const receipts = existingReceipts.map((r) => ({
      ...r,
      items: allRecItems.filter((ri) => ri.receipt_id === r.id),
    }));

    writeLocalStateMirror(existingLists, items, receipts);
    return { lists: existingLists, items, receipts, cloudConnected: true };
  } catch (err) {
    console.warn('[Supabase] Fast offline local cache active:', err);
    const starter = buildLocalFallbackData();
    return {
      lists: readCache<ShoppingList[]>(keys.lists, starter.lists),
      items: readCache<ShoppingItem[]>(keys.items, starter.items),
      receipts: readCache<Receipt[]>(keys.receipts, starter.receipts),
      cloudConnected: false,
    };
  }
}

export async function clearAllWorkspaceDataDb(): Promise<void> {
  const wsId = getWorkspaceId();
  const keys = getCacheKeys(wsId);
  try {
    localStorage.setItem(`kharidyar_${wsId}_cleared`, '1');
    localStorage.setItem(keys.lists, '[]');
    localStorage.setItem(keys.items, '[]');
    localStorage.setItem(keys.receipts, '[]');
  } catch {
    // ignore
  }
  try {
    await Promise.all([
      supabase.from('receipts').delete().eq('workspace_id', wsId),
      supabase.from('shopping_lists').delete().eq('workspace_id', wsId),
    ]);
  } catch {
    // offline safe
  }
}

export async function createShoppingListDb(title: string, storeHint?: string): Promise<ShoppingList> {
  const wsId = getWorkspaceId();
  try {
    const { data, error } = await supabase
      .from('shopping_lists')
      .insert({ workspace_id: wsId, title, store_hint: storeHint || null, status: 'active' })
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
  const wsId = getWorkspaceId();
  try {
    const { data, error } = await supabase
      .from('shopping_items')
      .insert({
        workspace_id: wsId,
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
  const wsId = getWorkspaceId();
  const { items, ...receiptHeader } = params.receipt;
  const fallbackLocalReceipt: Receipt = {
    id: crypto.randomUUID(),
    ...receiptHeader,
    items,
    created_at: new Date().toISOString(),
  };

  try {
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
        workspace_id: wsId,
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
  const isStaticPublicCdn = origin.includes('.github.io');

  if (!isCapacitorNative && !isStaticPublicCdn && !customOverride) {
    try {
      const resp = await fetch('/api/health');
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && ct.includes('application/json')) {
        const health = await resp.json();
        const apkUrl = health.apkReady ? `${origin}/api/download/apk` : apkFallbackUrl;
        void supabase
          .from('server_registry')
          .upsert({
            id: 'primary',
            server_url: origin,
            cv_engine: health.cvEngine || 'OpenCV 5.0 + Dual-Head Persian LSTM OCR',
            apk_download_url: apkUrl,
            apk_version: '1.2.0',
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
      const timer = setTimeout(() => ctrl.abort(), 2800);
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
      // Seamless autonomous WASM engine!
    }
  }

  return {
    serverUrl: candidateUrl || origin,
    isNativeApp: isCapacitorNative,
    serverOnline: false,
    apkDownloadUrl: discoveredApkUrl,
    cvEngine: 'موتور عصبی وب‌اسمبلی + کلود ابری (Dual-Head Persian WASM + Cloud AI)',
  };
}
