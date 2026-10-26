export interface BoundingBox {
  x: number; // normalized 0..1
  y: number;
  w: number;
  h: number;
  text?: string;
  confidence?: number;
}

export interface ReceiptItem {
  id?: string;
  receipt_id?: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  discount: number;
  category: string;
  matched_shopping_item_id?: string | null;
  confidence: number;
  bbox?: BoundingBox | null;
}

export interface Receipt {
  id: string;
  store_name: string;
  store_category: string;
  receipt_date?: string;
  jalali_date: string;
  receipt_number?: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total_amount: number;
  currency: string;
  currency_detected?: boolean;
  detected_rial?: boolean;
  ocr_engine: string;
  ocr_confidence: number;
  amount_read_from_receipt?: boolean;
  subtotal_read_from_receipt?: boolean;
  discount_inferred?: boolean;
  raw_ocr_text?: string;
  image_url?: string | null;
  processed_image_url?: string | null;
  reconciled_list_id?: string | null;
  missing_items_snapshot?: string[];
  extra_items_count?: number;
  source_device?: string;
  created_at?: string;
  items?: ReceiptItem[];
}

export interface ShoppingList {
  id: string;
  title: string;
  store_hint?: string | null;
  status: 'active' | 'completed' | 'archived';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ShoppingItem {
  id: string;
  list_id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  estimated_price?: number;
  is_checked: boolean;
  reconcile_status: 'pending' | 'matched' | 'missing';
  matched_receipt_id?: string | null;
  matched_item_name?: string | null;
  matched_price?: number | null;
  created_at?: string;
}

export interface ReconciliationItemResult {
  shoppingItemId: string;
  shoppingItemName: string;
  status: 'matched' | 'missing';
  matchedReceiptItemIndex: number | null;
  matchedReceiptItemName: string | null;
  matchedPrice: number | null;
  score: number;
}

export interface ScanResponse {
  ok: boolean;
  engine: string;
  durationMs: number;
  originalImageUrl?: string;
  processedImageUrl?: string;
  perspectiveCropped?: boolean;
  lineBoxes: BoundingBox[];
  rawOcrText: string;
  ocrQuality?: {
    itemCount: number;
    unrecognizedItemCount: number;
    amountReadFromReceipt: boolean;
    subtotalReadFromReceipt: boolean;
    itemTotalsMatchSubtotal: boolean;
    payableMatchesItems: boolean;
  };
  receipt: Omit<Receipt, 'id'> & { items: ReceiptItem[] };
  reconciliation: {
    matchedCount: number;
    missingCount: number;
    extraCount: number;
    items: ReconciliationItemResult[];
    missingNames: string[];
    extraItems: ReceiptItem[];
  };
}

export interface ServerRegistryInfo {
  id: string;
  server_url: string;
  cv_engine: string;
  apk_download_url?: string | null;
  apk_version?: string | null;
  status: string;
  last_heartbeat?: string;
}
