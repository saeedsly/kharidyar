import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import QRCode from 'qrcode';
import {
  Camera,
  CheckCircle2,
  Download,
  Home,
  HardDrive,
  ListChecks,
  LockKeyhole,
  Maximize2,
  ReceiptText,
  ScanLine,
  Smartphone,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import type { Receipt, ReceiptItem, ScanResponse, ShoppingItem, ShoppingList } from './types';
import { assetUrl } from './lib/assetUrl';
import {
  addShoppingItemDb,
  clearAllWorkspaceDataDb,
  createShoppingListDb,
  deleteReceiptDb,
  deleteShoppingItemDb,
  fetchAllAppData,
  readMonthlyBudget,
  replaceLocalAppData,
  resetListReconciliationDb,
  saveScannedReceiptAndReconcileDb,
  toggleShoppingItemDb,
  updateShoppingItemDb,
  writeLocalStateMirror,
  writeMonthlyBudget,
  type LocalAppData,
} from './lib/localStore';
import { inferStoreCategory, toPersianDigits } from './lib/persianMatcher';
import { DashboardTab } from './components/DashboardTab';
import { ShoppingListTab } from './components/ShoppingListTab';
import { ReceiptsTab } from './components/ReceiptsTab';
import { ServerConnectTab } from './components/ServerConnectTab';
import { ScannerModal } from './components/ScannerModal';
import { PrivacyModal } from './components/PrivacyModal';

type TabKey = 'dashboard' | 'list' | 'receipts' | 'connect';

const GITHUB_RELEASE_APK_URL =
  'https://github.com/saeedsly/kharidyar/releases/download/v1.4.2/KharidYar-Android7-v1.4.2.apk';

export default function App() {
  const isNative = Capacitor.isNativePlatform();

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [desktopPhoneFrame, setDesktopPhoneFrame] = useState<boolean>(() => !isNative);
  const [privacyModalOpen, setPrivacyModalOpen] = useState<boolean>(false);

  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [activeListId, setActiveListId] = useState<string>('');
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSampleId, setScannerSampleId] = useState<string | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState<number>(() => readMonthlyBudget());
  const [apkDownloadUrl] = useState<string>(GITHUB_RELEASE_APK_URL);
  const [sidebarQr, setSidebarQr] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerHaptic = async () => {
    try {
      if (isNative) {
        await Haptics.impact({ style: ImpactStyle.Light });
      }
    } catch {
      // ignore on web
    }
  };

  const notify = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const refreshData = async () => {
    const data = await fetchAllAppData();
    setLists(data.lists);
    setItems(data.items);
    setReceipts(data.receipts);
    setActiveListId((previous) => {
      if (previous && data.lists.some((list) => list.id === previous)) return previous;
      return data.lists[0]?.id || '';
    });
  };

  useEffect(() => {
    // Load device-local records immediately; app launch makes no network request.
    void refreshData();
  }, []);

  useEffect(() => {
    if (lists.length > 0 || receipts.length > 0) {
      writeLocalStateMirror(lists, items, receipts);
    }
  }, [lists, items, receipts]);

  useEffect(() => {
    const target = apkDownloadUrl.startsWith('http')
      ? apkDownloadUrl
      : `${window.location.origin}${apkDownloadUrl}`;
    QRCode.toDataURL(target, {
      width: 200,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then(setSidebarQr)
      .catch(() => {});
  }, [apkDownloadUrl]);

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) || lists[0] || null,
    [lists, activeListId]
  );

  const activeListItems = useMemo(
    () => items.filter((it) => it.list_id === (activeList?.id || '')),
    [items, activeList]
  );

  const missingBadgeCount = useMemo(
    () =>
      activeListItems.filter((i) => !i.is_checked && i.reconcile_status === 'missing').length,
    [activeListItems]
  );

  const openScanner = (sampleId?: string) => {
    void triggerHaptic();
    setScannerSampleId(sampleId || null);
    setScannerOpen(true);
  };

  const handleCreateList = async (title: string, storeHint?: string) => {
    const created = await createShoppingListDb(title, storeHint);
    setLists((prev) => [...prev, created]);
    setActiveListId(created.id);
    notify(`لیست «${created.title}» ایجاد شد`);
  };

  const handleAddItem = async (payload: {
    name: string;
    quantity: number;
    unit: string;
    category: string;
  }) => {
    if (!activeList) return;
    void triggerHaptic();
    const created = await addShoppingItemDb({
      list_id: activeList.id,
      ...payload,
    });
    setItems((prev) => [...prev, created]);
  };

  const handleToggleItem = async (item: ShoppingItem) => {
    void triggerHaptic();
    const nextChecked = !item.is_checked;
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? {
              ...it,
              is_checked: nextChecked,
              reconcile_status: nextChecked ? 'matched' : 'pending',
            }
          : it
      )
    );
    await toggleShoppingItemDb(item.id, nextChecked);
  };

  const handleDeleteItem = async (itemId: string) => {
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    await deleteShoppingItemDb(itemId);
  };

  const handleUpdateItem = async (itemId: string, patch: Partial<ShoppingItem>) => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
    await updateShoppingItemDb(itemId, patch);
  };

  const handleResetList = async () => {
    if (!activeList) return;
    setItems((prev) =>
      prev.map((it) =>
        it.list_id === activeList.id
          ? {
              ...it,
              is_checked: false,
              reconcile_status: 'pending',
              matched_item_name: null,
              matched_price: null,
            }
          : it
      )
    );
    await resetListReconciliationDb(activeList.id);
    notify('تیک‌های لیست خرید برای خرید جدید آماده شد');
  };

  const handleClearAllUserData = async () => {
    await clearAllWorkspaceDataDb();
    writeMonthlyBudget(0);
    setMonthlyBudget(0);
    setLists([]);
    setItems([]);
    setReceipts([]);
    notify('همهٔ اطلاعات این دستگاه پاک شد.');
  };

  const handleSaveMonthlyBudget = (amount: number) => {
    const safeAmount = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
    writeMonthlyBudget(safeAmount);
    setMonthlyBudget(safeAmount);
    notify(safeAmount ? 'بودجهٔ ماهانه ذخیره شد.' : 'بودجهٔ ماهانه برداشته شد.');
  };

  const handleExportBackup = () => {
    const payload = {
      app: 'KharidYar',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      monthlyBudget,
      data: {
        lists,
        items,
        receipts: receipts.map((receipt) => ({
          ...receipt,
          image_url: null,
          processed_image_url: null,
        })),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kharidyar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('نسخهٔ پشتیبان روی دستگاه آماده شد.');
  };

  const handleImportBackup = (data: LocalAppData, budget?: number) => {
    const safeData: LocalAppData = {
      ...data,
      receipts: data.receipts.map((receipt) => ({
        ...receipt,
        image_url: null,
        processed_image_url: null,
      })),
    };
    replaceLocalAppData(safeData);
    setLists(safeData.lists);
    setItems(safeData.items);
    setReceipts(safeData.receipts);
    setActiveListId(safeData.lists[0]?.id || '');
    const importedBudget = Number.isFinite(budget) && Number(budget) > 0 ? Math.round(Number(budget)) : 0;
    writeMonthlyBudget(importedBudget);
    setMonthlyBudget(importedBudget);
    notify('پشتیبان بازیابی شد؛ اطلاعات فقط روی همین دستگاه ذخیره می‌شوند.');
  };

  const handleConfirmSaveReceipt = async (params: {
    scanResult: ScanResponse;
    editedStoreName: string;
    editedDate: string;
    editedDiscount: number;
    editedTax: number;
    editedItems: ReceiptItem[];
    targetListId: string;
  }) => {
    void triggerHaptic();
    const subtotal = params.editedItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
    const totalAmount = Math.max(
      0,
      subtotal - Number(params.editedDiscount || 0) + Number(params.editedTax || 0)
    );

    setItems((prev) =>
      prev.map((sItem) => {
        if (sItem.list_id !== params.targetListId) return sItem;
        const matchEntry = params.scanResult.reconciliation.items.find(
          (r) => r.shoppingItemId === sItem.id
        );
        if (!matchEntry) return sItem;
        if (matchEntry.status === 'matched') {
          return {
            ...sItem,
            is_checked: true,
            reconcile_status: 'matched',
            matched_item_name: matchEntry.matchedReceiptItemName,
            matched_price: matchEntry.matchedPrice,
          };
        }
        return sItem.is_checked
          ? sItem
          : {
              ...sItem,
              reconcile_status: 'missing',
            };
      })
    );

    const savedReceipt = await saveScannedReceiptAndReconcileDb({
      receipt: {
        ...params.scanResult.receipt,
        image_url: null,
        processed_image_url: null,
        store_name: params.editedStoreName,
        store_category: inferStoreCategory(params.editedStoreName),
        jalali_date: params.editedDate,
        subtotal,
        discount_total: params.editedDiscount,
        tax_total: params.editedTax,
        total_amount: totalAmount,
        items: params.editedItems,
      },
      reconciledListId: params.targetListId || null,
      reconciliationItems: params.scanResult.reconciliation.items,
      missingNames: params.scanResult.reconciliation.missingNames,
      extraCount: params.scanResult.reconciliation.extraCount,
      sourceDevice: isNative ? 'mobile-apk' : 'web',
    });

    setReceipts((prev) => [savedReceipt, ...prev]);
    setActiveTab('list');

    const remMissing = params.scanResult.reconciliation.missingNames.filter((name) => {
      const existing = items.find((i) => i.list_id === params.targetListId && i.name === name);
      return !existing?.is_checked;
    });

    if (remMissing.length > 0) {
      notify(
        `فاکتور ثبت شد! حواست باشه ${toPersianDigits(remMissing.length)} قلم از لیست خرید جا مونده.`
      );
    } else {
      notify('فاکتور ثبت شد و تمام اقلام لیست خرید تیک خوردند!');
    }
  };

  const handleDeleteReceipt = async (receiptId: string) => {
    setReceipts((prev) => prev.filter((r) => r.id !== receiptId));
    await deleteReceiptDb(receiptId);
    notify('فاکتور حذف شد');
  };

  const mobileAppInner = (
    <div className="relative flex flex-col h-full bg-[#F4F6FA] text-slate-900">
      {/* Clean Minimal App Header with Creator Ownership Badge */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-white/90 backdrop-blur-md px-4 py-3.5 pt-safe border-b border-slate-200/70">
        <div className="flex items-center gap-2.5">
          <img
            src={assetUrl('icon-192.png')}
            alt="خریدیـار"
            className="h-9 w-9 rounded-2xl shadow-xs border border-blue-100"
          />
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-900 leading-none">
              خریدیـار
            </h1>
            <p className="text-[11px] font-medium text-slate-500 mt-1">فاکتورها و فهرست خرید</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPrivacyModalOpen(true)}
            aria-label="حریم خصوصی"
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200/80 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 transition cursor-pointer"
          >
            <LockKeyhole className="h-3.5 w-3.5" />
            <span>حریم خصوصی</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('connect')}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 text-[11px] font-bold text-emerald-800 cursor-pointer"
          >
            <WifiOff className="h-3.5 w-3.5" />
            روی دستگاه
          </button>
        </div>
      </header>

      {toastMessage && (
        <div className="mx-4 mt-3 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-lg flex items-center gap-2 z-30">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 pt-4">
        {activeTab === 'dashboard' && (
          <DashboardTab
            receipts={receipts}
            activeList={activeList}
            activeListItems={activeListItems}
            monthlyBudget={monthlyBudget}
            onSaveMonthlyBudget={handleSaveMonthlyBudget}
            onOpenScanner={openScanner}
            onGoToList={() => setActiveTab('list')}
            onGoToReceipts={() => setActiveTab('receipts')}
            onSelectReceipt={(r) => {
              setSelectedReceipt(r);
              setActiveTab('receipts');
            }}
          />
        )}

        {activeTab === 'list' && (
          <ShoppingListTab
            lists={lists}
            activeListId={activeList?.id || ''}
            items={activeListItems}
            onSelectList={setActiveListId}
            onCreateList={handleCreateList}
            onAddItem={handleAddItem}
            onToggleItem={handleToggleItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onResetList={handleResetList}
            onOpenScannerForList={openScanner}
          />
        )}

        {activeTab === 'receipts' && (
          <ReceiptsTab
            receipts={receipts}
            selectedReceipt={selectedReceipt}
            onSelectReceipt={setSelectedReceipt}
            onDeleteReceipt={handleDeleteReceipt}
          />
        )}

        {activeTab === 'connect' && (
          <ServerConnectTab
            lists={lists}
            items={items}
            receipts={receipts}
            monthlyBudget={monthlyBudget}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onClearAllUserData={handleClearAllUserData}
            onOpenPrivacy={() => setPrivacyModalOpen(true)}
          />
        )}
      </main>

      {/* Bottom Frosted Dock */}
      <nav className="sticky bottom-0 z-20 bg-white/95 backdrop-blur-xl border-t border-slate-200/80 px-2 pb-safe pt-1.5">
        <div className="grid grid-cols-5 items-center max-w-md mx-auto">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`flex flex-col items-center gap-1 py-1.5 text-[11px] font-bold transition cursor-pointer ${
              activeTab === 'dashboard' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Home className="h-5 w-5" />
            <span>خانه</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`relative flex flex-col items-center gap-1 py-1.5 text-[11px] font-bold transition cursor-pointer ${
              activeTab === 'list' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <div className="relative">
              <ListChecks className="h-5 w-5" />
              {missingBadgeCount > 0 && (
                <span className="absolute -top-1.5 -left-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-extrabold text-white tabular-fa">
                  {toPersianDigits(missingBadgeCount)}
                </span>
              )}
            </div>
            <span>لیست خرید</span>
          </button>

          <div className="flex justify-center -mt-6">
            <button
              type="button"
              onClick={() => openScanner()}
              aria-label="اسکن فاکتور"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/35 ring-4 ring-white transition hover:bg-blue-700 active:scale-95 cursor-pointer"
            >
              <Camera className="h-6 w-6" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('receipts')}
            className={`flex flex-col items-center gap-1 py-1.5 text-[11px] font-bold transition cursor-pointer ${
              activeTab === 'receipts' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <ReceiptText className="h-5 w-5" />
            <span>فاکتورها</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('connect')}
            className={`flex flex-col items-center gap-1 py-1.5 text-[11px] font-bold transition cursor-pointer ${
              activeTab === 'connect' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <HardDrive className="h-5 w-5" />
            <span>پشتیبان</span>
          </button>
        </div>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#EDF1F7]">
      {!desktopPhoneFrame || isNative ? (
        <div className="mx-auto max-w-2xl min-h-screen bg-[#F4F6FA] shadow-xl flex flex-col">
          {!isNative && (
            <div className="hidden lg:flex items-center justify-between bg-slate-900 text-white px-5 py-2.5 text-xs">
              <span className="font-bold">خریدیـار — فاکتورها و فهرست خرید</span>
              <div className="flex items-center gap-2.5">
                <a
                  href={apkDownloadUrl}
                  download="KharidYar-Android7-v1.4.2.apk"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 font-bold hover:bg-blue-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  دانلود نسخهٔ اندروید
                </a>
                <button
                  type="button"
                  onClick={() => setDesktopPhoneFrame(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1 font-semibold hover:bg-white/25 cursor-pointer"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  نمای موبایل
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 flex flex-col">{mobileAppInner}</div>
        </div>
      ) : (
        <>
          <div className="lg:hidden min-h-screen flex flex-col">{mobileAppInner}</div>

          <div className="hidden lg:grid lg:grid-cols-12 gap-8 max-w-6xl mx-auto px-6 py-7 items-center min-h-screen">
            {/* Interactive Mobile Phone Frame */}
            <div className="col-span-5 flex justify-center">
              <div className="w-[392px] h-[812px] rounded-[50px] bg-slate-900 p-3 shadow-[0_32px_70px_rgba(15,23,42,0.22)] ring-1 ring-slate-800/80 relative flex flex-col">
                <div className="mx-auto mb-1.5 h-5 w-28 rounded-full bg-slate-950 shrink-0" />
                <div className="flex-1 rounded-[38px] overflow-hidden bg-[#F4F6FA]">
                  {mobileAppInner}
                </div>
              </div>
            </div>

            {/* Desktop app preview and download actions */}
            <div className="col-span-7 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-emerald-700 shadow-2xs border border-emerald-200/80">
                <WifiOff className="h-3.5 w-3.5" />
                خریدیـار روی دستگاه • بدون نیاز به اتصال اینترنت
              </div>

              <h1 className="text-3xl font-black tracking-tight text-slate-900 leading-snug">
                خریدیـار
                <span className="block text-base font-bold text-slate-600 mt-1">
                  اسکن فاکتور و مدیریت فهرست خرید؛ بدون نیاز به اینترنت
                </span>
              </h1>

              <div className="flex items-start gap-3 rounded-3xl bg-white p-4 border border-slate-200/80 shadow-xs">
                <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div className="flex-1">
                  <h2 className="text-sm font-extrabold text-slate-900">اطلاعات روی دستگاه شما می‌ماند</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    فاکتورها و فهرست‌ها روی دستگاه ذخیره می‌شوند؛ تصویر برای پردازش به سرور فرستاده نمی‌شود.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrivacyModalOpen(true)}
                  className="shrink-0 rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 cursor-pointer"
                >
                  جزئیات
                </button>
              </div>

              <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <ScanLine className="h-4.5 w-4.5 text-blue-600" />
                    فاکتورهای نمونه
                  </h2>
                  <button
                    type="button"
                    onClick={() => setDesktopPhoneFrame(false)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    نمای وب تمام‌صفحه
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => openScanner('ofogh')}
                    className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5 text-right hover:bg-blue-100/70 transition cursor-pointer"
                  >
                    <Sparkles className="h-6 w-6 text-blue-600 shrink-0" />
                    <div>
                      <p className="text-xs font-extrabold text-slate-900">
                        فاکتور نمونهٔ افق کوروش
                      </p>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        نمونه برای بررسی اسکن
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => openScanner('janbo')}
                    className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-right hover:bg-emerald-100/70 transition cursor-pointer"
                  >
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-xs font-extrabold text-slate-900">
                        فاکتور نمونهٔ جانبو
                      </p>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        نمونه برای بررسی اسکن
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Signed Production Android Download + QR */}
              <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-xs flex items-center justify-between gap-5">
                <div className="space-y-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                    نسخهٔ اندروید ۱.۴.۲
                  </span>
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <a
                      href={apkDownloadUrl}
                      download="KharidYar-Android7-v1.4.2.apk"
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-xs font-extrabold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700 transition"
                    >
                      <Download className="h-4 w-4" />
                      دانلود مستقیم فایل نصب اندروید (APK)
                    </a>
                    <button
                      type="button"
                      onClick={() => openScanner()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer"
                    >
                      <Camera className="h-4 w-4" />
                      اسکن فاکتور
                    </button>
                  </div>
                </div>

                {sidebarQr && (
                  <div className="shrink-0 text-center bg-slate-50 border border-slate-200 rounded-2xl p-3">
                    <img
                      src={sidebarQr}
                      alt="QR Code نصب اندروید"
                      className="h-24 w-24 rounded-xl bg-white p-1"
                    />
                    <span className="block mt-1 text-[10px] font-bold text-slate-600">
                      دریافت با QR
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Scanner Sheet Modal */}
      <ScannerModal
        isOpen={scannerOpen}
        initialSampleId={scannerSampleId}
        lists={lists}
        activeListId={activeList?.id || ''}
        allShoppingItems={items}
        onSelectList={setActiveListId}
        onClose={() => {
          setScannerOpen(false);
          setScannerSampleId(null);
        }}
        onConfirmSave={handleConfirmSaveReceipt}
      />

      <PrivacyModal
        isOpen={privacyModalOpen}
        onClose={() => setPrivacyModalOpen(false)}
        onClearAllUserData={handleClearAllUserData}
      />
    </div>
  );
}
