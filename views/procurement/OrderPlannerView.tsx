import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Search, Edit2, Calendar, Package, ArrowLeft, Settings, Tag,
  FileSpreadsheet, AlertTriangle, CheckCircle, XCircle, Plus, Save, Clock,
  ChevronDown, History, Image as ImageIcon, FileText, ShoppingCart
} from 'lucide-react';
import apiService from '../../services/apiService';
import { motion, AnimatePresence } from 'framer-motion';

const OrderPlannerView = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Lead time inputs state
  const [leadTimes, setLeadTimes] = useState({
    country: '',
    brand: '',
    moq: '0',
    containerCapacity: '',
    leadTimeProcessing: '0',
    leadTimeProduction: '0',
    leadTimeShipping: '0',
    leadTimeRoad: '0',
    leadTimeExtra: '0'
  });

  // Selected items and order quantities
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<Record<string, boolean>>({});

  // Dialog states
  const [activeHistoryItemId, setActiveHistoryItemId] = useState<string | null>(null);
  const [historicalPrices, setHistoricalPrices] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadPlannerData = async () => {
    setLoading(true);
    try {
      const res = await apiService.getPlanningData();
      setData(res);
      if (res.suppliers?.length > 0) {
        // Set first supplier as default
        const firstSup = res.suppliers[0];
        setSelectedSupplierId(firstSup.id);
      }
    } catch (err) {
      console.error('Failed to load planning data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlannerData();
  }, []);

  const selectedSupplier = useMemo(() => {
    if (!data?.suppliers || !selectedSupplierId) return null;
    return data.suppliers.find((s: any) => s.id === selectedSupplierId);
  }, [data, selectedSupplierId]);

  // Sync lead time fields when supplier changes
  useEffect(() => {
    if (selectedSupplier) {
      setLeadTimes({
        country: selectedSupplier.country || '',
        brand: selectedSupplier.brand || '',
        moq: String(selectedSupplier.moq || 0),
        containerCapacity: selectedSupplier.containerCapacity || '',
        leadTimeProcessing: String(selectedSupplier.leadTimeProcessing || 0),
        leadTimeProduction: String(selectedSupplier.leadTimeProduction || 0),
        leadTimeShipping: String(selectedSupplier.leadTimeShipping || 0),
        leadTimeRoad: String(selectedSupplier.leadTimeRoad || 0),
        leadTimeExtra: String(selectedSupplier.leadTimeExtra || 0)
      });
      // Clear selections on supplier change
      setSelectedItemIds({});
      setOrderQuantities({});
    }
  }, [selectedSupplier]);

  const totalLeadTimeDays = useMemo(() => {
    return (Number(leadTimes.leadTimeProcessing) || 0) +
           (Number(leadTimes.leadTimeProduction) || 0) +
           (Number(leadTimes.leadTimeShipping) || 0) +
           (Number(leadTimes.leadTimeRoad) || 0) +
           (Number(leadTimes.leadTimeExtra) || 0);
  }, [leadTimes]);

  const supplierItems = useMemo(() => {
    if (!data?.planning || !selectedSupplier) return [];
    
    // Filter items. If supplier has a brand, match brand with item category.
    // If not, match items where supplier is the primary linked supplier.
    const query = searchQuery.toLowerCase();
    return data.planning.filter((item: any) => {
      const matchesSupplier = item.supplier?.id === selectedSupplier.id ||
        (selectedSupplier.brand && item.category && 
         selectedSupplier.brand.toLowerCase() === item.category.toLowerCase());
         
      const matchesSearch = item.itemName.toLowerCase().includes(query) ||
                            item.itemCode.toLowerCase().includes(query);
      return matchesSupplier && matchesSearch;
    });
  }, [data, selectedSupplier, searchQuery]);

  // Update default suggested quantities
  useEffect(() => {
    if (supplierItems.length > 0) {
      const newQuantities: Record<string, number> = {};
      const newSelections: Record<string, boolean> = {};
      supplierItems.forEach((item: any) => {
        if (item.recommendedQty > 0) {
          newQuantities[item.id] = item.recommendedQty;
          newSelections[item.id] = true;
        } else {
          newQuantities[item.id] = 0;
        }
      });
      setOrderQuantities(newQuantities);
      setSelectedItemIds(newSelections);
    }
  }, [supplierItems]);


  const handleLoadHistory = async (itemId: string) => {
    setActiveHistoryItemId(itemId);
    setLoadingHistory(true);
    try {
      const prices = await apiService.getHistoricalPrices(itemId);
      setHistoricalPrices(prices || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleGeneratePO = async () => {
    const selectedList = supplierItems.filter((item: any) => selectedItemIds[item.id] && (orderQuantities[item.id] || 0) > 0);
    if (selectedList.length === 0) {
      alert('Please select at least one item with order quantity greater than 0.');
      return;
    }

    // Check MOQ constraint
    const totalOrderQty = selectedList.reduce((sum, item) => sum + (orderQuantities[item.id] || 0), 0);
    const supplierMoq = Number(leadTimes.moq) || 0;
    if (totalOrderQty < supplierMoq) {
      if (!window.confirm(`Total order quantity (${totalOrderQty}) is below the supplier MOQ (${supplierMoq}). Do you still want to proceed?`)) {
        return;
      }
    }

    try {
      const nextRef = await apiService.getNextReference('purchase-order');
      const poItems = selectedList.map((item: any) => ({
        itemId: item.id,
        description: `${item.itemCode} - ${item.itemName}`,
        qty: orderQuantities[item.id] || 0,
        unitPrice: item.purchasePrice,
        totalAmount: (orderQuantities[item.id] || 0) * item.purchasePrice,
        taxCode: 'VAT 16%',
        discount: '',
        division: 'General'
      }));

      const poAmount = poItems.reduce((sum, item) => sum + item.totalAmount, 0);

      const payload = {
        supplierId: selectedSupplier.id,
        reference: nextRef,
        amount: poAmount,
        currency: selectedSupplier.currency || 'USD',
        description: `Order Placed via Procurement Planner for brand ${leadTimes.brand || 'N/A'}`,
        status: 'Ordered',
        orderDate: new Date().toISOString(),
        docOptions: {
          leadTimes: {
            processing: Number(leadTimes.leadTimeProcessing),
            production: Number(leadTimes.leadTimeProduction),
            shipping: Number(leadTimes.leadTimeShipping),
            road: Number(leadTimes.leadTimeRoad)
          },
          estimatedArrival: new Date(Date.now() + totalLeadTimeDays * 86400000).toISOString()
        },
        items: poItems
      };

      const result = await apiService.createOrder(payload);
      alert(`Purchase Order ${nextRef} generated successfully!`);
      navigate(`/purchase-orders/view/${result.id}`);
    } catch (err: any) {
      console.error('PO generation failed:', err);
      alert('Failed to generate Purchase Order: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-black uppercase tracking-widest">Loading order planner...</div>;
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Header Area */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-6">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">
            <FileSpreadsheet size={14} />
            <span className="text-gray-400">Procurement Planning</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Supplier Order Planning Sheet</h1>
          <p className="text-slate-500 text-sm">Calculate item demands, configure shipping lead times, and generate purchase orders</p>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-[11px] font-black uppercase tracking-wider text-slate-400">Select Supplier:</label>
          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {data?.suppliers?.map((sup: any) => (
              <option key={sup.id} value={sup.id}>{sup.name} ({sup.code})</option>
            ))}
          </select>
        </div>
      </div>

      {selectedSupplier && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Supplier lead time properties editor */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-gray-50 pb-4">
              <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-blue-600 flex items-center gap-2">
                <Clock size={16} /> Lead Times & Planning Specs
              </h2>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 px-2.5 py-1 rounded-md">
                Admin Master
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Brand Name</label>
                <input
                  type="text"
                  value={leadTimes.brand}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                  placeholder="N/A"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Supplier Country</label>
                <input
                  type="text"
                  value={leadTimes.country}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                  placeholder="N/A"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Processing days</label>
                <input
                  type="number"
                  value={leadTimes.leadTimeProcessing}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Production days</label>
                <input
                  type="number"
                  value={leadTimes.leadTimeProduction}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Ocean Shipping days</label>
                <input
                  type="number"
                  value={leadTimes.leadTimeShipping}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Road Transport days</label>
                <input
                  type="number"
                  value={leadTimes.leadTimeRoad}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Extra Days</label>
                <input
                  type="number"
                  value={leadTimes.leadTimeExtra}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-rose-500/80 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Minimum Order Qty</label>
                <input
                  type="number"
                  value={leadTimes.moq}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-indigo-500/80 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Container Capacity</label>
                <input
                  type="text"
                  value={leadTimes.containerCapacity}
                  disabled
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed"
                  placeholder="N/A"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-50 flex flex-col gap-2">
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>Total Lead Time:</span>
                <span className="text-slate-900">{totalLeadTimeDays} Days ({parseFloat((totalLeadTimeDays / 30).toFixed(1))} Months)</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>Projected ETA:</span>
                <span className="text-blue-600 font-extrabold">
                  {new Date(Date.now() + totalLeadTimeDays * 86400000).toLocaleDateString('en-GB')}
                </span>
              </div>
            </div>
          </div>

          {/* Planning Items Table */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-slate-50/50">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  type="text"
                  placeholder="Filter items by code or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none"
                />
              </div>

              <button
                onClick={handleGeneratePO}
                className="bg-blue-600 text-white px-5 py-2 rounded-xl text-xs font-black hover:bg-blue-700 transition-all flex items-center gap-1.5 shadow-md shadow-blue-200 uppercase tracking-widest border border-blue-500"
              >
                <ShoppingCart size={14} /> Generate Purchase Order
              </button>
            </div>

            <div className="overflow-x-auto flex-1 max-h-[500px]">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 sticky top-0 bg-white">
                    <th className="px-4 py-3 text-center">Select</th>
                    <th className="px-4 py-3">Code / Name</th>
                    <th className="px-4 py-3 text-center">Stock</th>
                    <th className="px-4 py-3 text-center">Inflow (Demand)</th>
                    <th className="px-4 py-3 text-center">Available</th>
                    <th className="px-4 py-3 text-center">Suggested Qty</th>
                    <th className="px-4 py-3 text-center">Order Qty</th>
                    <th className="px-4 py-3">Historical Prices</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {supplierItems.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={!!selectedItemIds[item.id]}
                          onChange={(e) => setSelectedItemIds({ ...selectedItemIds, [item.id]: e.target.checked })}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-bold text-slate-900">{item.itemCode}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate max-w-xs">{item.itemName}</div>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-xs text-slate-800">{item.qtyOnHand}</td>
                      <td className="px-4 py-3 text-center text-xs text-slate-500 font-bold">{item.avgDemand} <span className="text-[9px] text-slate-400">/mo</span></td>
                      <td className="px-4 py-3 text-center text-xs text-slate-600 font-bold">
                        {item.availableStock}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                          item.recommendedQty > 0 ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-slate-50 text-slate-400'
                        }`}>
                          {item.recommendedQty > 0 ? item.recommendedQty : '0'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number"
                          value={orderQuantities[item.id] || 0}
                          onChange={(e) => setOrderQuantities({ ...orderQuantities, [item.id]: Number(e.target.value) || 0 })}
                          disabled={!selectedItemIds[item.id]}
                          className="w-20 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs font-bold text-center outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleLoadHistory(item.id)}
                          className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[9px] font-bold text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all uppercase tracking-tighter"
                        >
                          Compare Prices
                        </button>
                      </td>
                    </tr>
                  ))}
                  {supplierItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-xs text-slate-400 font-bold">
                        No inventory items associated with brand "{leadTimes.brand || 'N/A'}"
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Historical prices modal */}
      {activeHistoryItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-black text-slate-900 tracking-tight uppercase">Historical Purchase Prices</h3>
              <button
                onClick={() => setActiveHistoryItemId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-6 max-h-96 overflow-y-auto">
              {loadingHistory ? (
                <div className="text-center py-8 text-xs text-slate-400 animate-pulse font-bold">LOADING HISTORY...</div>
              ) : historicalPrices.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400 font-bold">NO PREVIOUS PURCHASES RECORDED</div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Supplier</th>
                      <th className="pb-2 text-center">Qty</th>
                      <th className="pb-2 text-right">Unit Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicalPrices.map((h: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-50 text-xs font-semibold">
                        <td className="py-2 text-slate-500">{new Date(h.purchaseDate).toLocaleDateString('en-GB')}</td>
                        <td className="py-2 text-slate-800">{h.supplier?.name}</td>
                        <td className="py-2 text-center text-slate-600">{h.qty}</td>
                        <td className="py-2 text-right text-indigo-600 font-bold">
                          {h.currency} {Number(h.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderPlannerView;
