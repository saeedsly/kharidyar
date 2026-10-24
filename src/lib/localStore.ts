import type { Receipt, ReceiptItem, ShoppingItem, ShoppingList } from '../types';

const WORKSPACE_STORAGE_KEY = 'kharidyar_workspace_code_v1';
const MONTHLY_BUDGET_KEY = 'kharidyar_monthly_budget_v1';

export interface LocalAppData {
  lists: ShoppingList[];
  items: ShoppingItem[];
  receipts: Receipt[];
}

export function createLocalId(prefix = 'ky'): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getWorkspaceId(): string {
  try {
    const existing = localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim().toUpperCase();
    if (existing && existing.length >= 4) return existing;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let randomPart = '';
    for (let i = 0; i < 6; i++) randomPart += chars[Math.floor(Math.random() * chars.length)];
    const generated = `KY-${randomPart}`;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'KY-LOCAL';
  }
}

export function setWorkspaceId(newCode: string): string {
  const cleaned = newCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const code = cleaned.length >= 4 ? cleaned : getWorkspaceId();
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, code);
  } catch {
    // The app still works for this session when browser storage is restricted.
  }
  return code;
}

function getCacheKeys(workspaceId = getWorkspaceId()) {
  return {
    lists: `kharidyar_${workspaceId}_lists`,
    items: `kharidyar_${workspaceId}_items`,
    receipts: `kharidyar_${workspaceId}_receipts`,
  };
}

function emptyFirstRunData(): LocalAppData {
  return {
    lists: [
      {
        id: 'local-starter-list',
        title: 'لیست خرید من',
        status: 'active',
        created_at: new Date().toISOString(),
      },
    ],
    items: [],
    receipts: [],
  };
}

function readJsonArray<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function cleanReceiptForLocal(receipt: Receipt): Receipt {
  // Never put full photos or temporary object URLs in localStorage. Parsed receipt data is enough
  // for the monthly report and takes a fraction of the space, even on older Android WebViews.
  return {
    ...receipt,
    image_url: null,
    processed_image_url: null,
    items: (receipt.items || []).map((item) => ({ ...item, bbox: null })),
  };
}

export function writeLocalStateMirror(lists: ShoppingList[], items: ShoppingItem[], receipts: Receipt[]) {
  const keys = getCacheKeys();
  try {
    localStorage.setItem(keys.lists, JSON.stringify(lists));
    localStorage.setItem(keys.items, JSON.stringify(items));
    localStorage.setItem(keys.receipts, JSON.stringify(receipts.map(cleanReceiptForLocal)));
  } catch (error) {
    console.warn('[KharidYar] Could not save local data. Export a backup and free storage space.', error);
  }
}

export function replaceLocalAppData(data: LocalAppData): void {
  writeLocalStateMirror(data.lists, data.items, data.receipts);
}

export function readMonthlyBudget(): number {
  try {
    const value = Number(localStorage.getItem(MONTHLY_BUDGET_KEY) || 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}

export function writeMonthlyBudget(amount: number): void {
  try {
    const safeAmount = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
    if (safeAmount > 0) localStorage.setItem(MONTHLY_BUDGET_KEY, String(safeAmount));
    else localStorage.removeItem(MONTHLY_BUDGET_KEY);
  } catch {
    // Budget remains usable during this session if storage is unavailable.
  }
}

function readLocalData(): LocalAppData {
  const keys = getCacheKeys();
  const lists = readJsonArray<ShoppingList>(keys.lists);
  const items = readJsonArray<ShoppingItem>(keys.items);
  const receipts = readJsonArray<Receipt>(keys.receipts);
  const firstRun = emptyFirstRunData();
  return {
    lists: lists ?? firstRun.lists,
    items: items ?? firstRun.items,
    receipts: (receipts ?? firstRun.receipts).map(cleanReceiptForLocal),
  };
}

function writeCurrentData(data: LocalAppData): void {
  writeLocalStateMirror(data.lists, data.items, data.receipts);
}

export async function fetchAllAppData(): Promise<LocalAppData & { cloudConnected: false }> {
  const data = readLocalData();
  // Make the first-run list persistent and keep migrated local data under the same keys used by
  // earlier versions. No network request is made during launch.
  writeCurrentData(data);
  return { ...data, cloudConnected: false };
}

export async function clearAllWorkspaceDataDb(): Promise<void> {
  const keys = getCacheKeys();
  try {
    localStorage.setItem(keys.lists, '[]');
    localStorage.setItem(keys.items, '[]');
    localStorage.setItem(keys.receipts, '[]');
  } catch {
    // Nothing else is required; state will be cleared in memory by the caller.
  }
}

export async function createShoppingListDb(title: string, storeHint?: string): Promise<ShoppingList> {
  const created: ShoppingList = {
    id: createLocalId('list'),
    title,
    store_hint: storeHint || null,
    status: 'active',
    created_at: new Date().toISOString(),
  };
  const data = readLocalData();
  writeCurrentData({ ...data, lists: [...data.lists, created] });
  return created;
}

export async function addShoppingItemDb(item: {
  list_id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
}): Promise<ShoppingItem> {
  const created: ShoppingItem = {
    id: createLocalId('item'),
    ...item,
    is_checked: false,
    reconcile_status: 'pending',
    created_at: new Date().toISOString(),
  };
  const data = readLocalData();
  writeCurrentData({ ...data, items: [...data.items, created] });
  return created;
}

export async function updateShoppingItemDb(itemId: string, patch: Partial<ShoppingItem>): Promise<void> {
  const data = readLocalData();
  writeCurrentData({
    ...data,
    items: data.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
  });
}

export async function toggleShoppingItemDb(itemId: string, isChecked: boolean): Promise<void> {
  await updateShoppingItemDb(itemId, {
    is_checked: isChecked,
    reconcile_status: isChecked ? 'matched' : 'pending',
  });
}

export async function deleteShoppingItemDb(itemId: string): Promise<void> {
  const data = readLocalData();
  writeCurrentData({ ...data, items: data.items.filter((item) => item.id !== itemId) });
}

export async function resetListReconciliationDb(listId: string): Promise<void> {
  const data = readLocalData();
  writeCurrentData({
    ...data,
    items: data.items.map((item) =>
      item.list_id === listId
        ? {
            ...item,
            is_checked: false,
            reconcile_status: 'pending',
            matched_receipt_id: null,
            matched_item_name: null,
            matched_price: null,
          }
        : item
    ),
  });
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
  const data = readLocalData();
  const receiptId = createLocalId('receipt');
  const { items, ...header } = params.receipt;
  const saved: Receipt = cleanReceiptForLocal({
    ...header,
    id: receiptId,
    reconciled_list_id: params.reconciledListId || null,
    missing_items_snapshot: params.missingNames || [],
    extra_items_count: params.extraCount || 0,
    source_device: params.sourceDevice,
    created_at: new Date().toISOString(),
    items: items.map((item) => ({
      ...item,
      id: item.id || createLocalId('receipt-item'),
      receipt_id: receiptId,
    })),
  });

  const reconciliation = new Map((params.reconciliationItems || []).map((entry) => [entry.shoppingItemId, entry]));
  const nextItems = data.items.map((item) => {
    if (!params.reconciledListId || item.list_id !== params.reconciledListId) return item;
    const match = reconciliation.get(item.id);
    if (!match) return item;
    if (match.status === 'matched') {
      return {
        ...item,
        is_checked: true,
        reconcile_status: 'matched' as const,
        matched_receipt_id: receiptId,
        matched_item_name: match.matchedReceiptItemName,
        matched_price: match.matchedPrice,
      };
    }
    return item.is_checked ? item : { ...item, reconcile_status: 'missing' as const };
  });

  writeCurrentData({
    ...data,
    items: nextItems,
    receipts: [saved, ...data.receipts.filter((receipt) => receipt.id !== receiptId)],
  });
  return saved;
}

export async function deleteReceiptDb(receiptId: string): Promise<void> {
  const data = readLocalData();
  writeCurrentData({ ...data, receipts: data.receipts.filter((receipt) => receipt.id !== receiptId) });
}
