import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Search, Filter, AlertTriangle, CheckCircle, ArrowRight,
  TrendingDown, ShoppingCart, RefreshCw, Layers
} from 'lucide-react';
import apiService from '../../services/apiService';

const WhatToOrderReportView = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [filterBrand, setFilterBrand] = useState('All');
  const [filterSupplier, setFilterSupplier] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const loadReportData = async () => {
    setLoading(true);
    try {
      const res = await apiService.getPlanningData();
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, []);

  const brands = useMemo(() => {
    if (!data?.planning) return [];
    const unique = new Set<string>();
    data.planning.forEach((item: any) => {
      if (item.category) unique.add(item.category);
    });
    return ['All', ...Array.from(unique)];
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data?.planning) return [];
    return data.planning.filter((item: any) => {
      const matchesBrand = filterBrand === 'All' || item.category === filterBrand;
      const matchesSupplier = filterSupplier === 'All' || item.supplier?.id === filterSupplier;
      const matchesSearch = item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            item.itemCode.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesBrand && matchesSupplier && matchesSearch;
    });
  }, [data, filterBrand, filterSupplier, searchQuery]);

  const urgentItemsCount = useMemo(() => {
    return filteredItems.filter((item: any) => item.recommendedQty > 0).length;
  }, [filteredItems]);

  const handleCreateBulkPO = async (supplierId: string) => {
    const supplierItems = filteredItems.filter((i: any) => i.supplier?.id === supplierId && i.recommendedQty > 0);
    if (supplierItems.length === 0) {
      alert('No recommended purchases for this supplier.');
      return;
    }
    
    if (!window.confirm(`Do you want to generate a Purchase Order for ${supplierItems.length} recommended items?`)) {
      return;
    }

    try {
      const nextRef = await apiService.getNextReference('purchase-order');
      const poItems = supplierItems.map((item: any) => ({
        itemId: item.id,
        description: `${item.itemCode} - ${item.itemName}`,
        qty: item.recommendedQty,
        unitPrice: item.purchasePrice,
        totalAmount: item.recommendedQty * item.purchasePrice,
        taxCode: 'VAT 16%',
        discount: '',
        division: 'General'
      }));

      const payload = {
        supplierId,
        reference: nextRef,
        amount: poItems.reduce((sum: number, i: any) => sum + i.totalAmount, 0),
        currency: 'USD',
        description: `Automated reorder sheet generated for PO reference ${nextRef}`,
        status: 'Ordered',
        orderDate: new Date().toISOString(),
        items: poItems
      };

      const result = await apiService.createOrder(payload);
      alert(`Purchase Order ${nextRef} created successfully!`);
      navigate(`/purchase-orders/view/${result.id}`);
    } catch (err: any) {
      console.error(err);
      alert('Failed to generate reorder: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-black uppercase tracking-widest">Generating reorder advice...</div>;
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-6">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">
            <Layers size={14} />
            <span className="text-gray-400">Inventory Planning Report</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">"What to Order" Monthly Report</h1>
          <p className="text-slate-500 text-sm">Monthly demand calculations and procurement recommendations</p>
        </div>

        <button
          onClick={loadReportData}
          className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          title="Refresh Data"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* KPI Highlight */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            urgentItemsCount > 0 ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
          }`}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reorders Needed</div>
            <div className="text-2xl font-black text-slate-900">{urgentItemsCount} SKUs</div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
            <Filter size={24} />
          </div>
          <div className="flex-1 flex gap-2">
            <div className="flex-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-0.5">Filter Brand</label>
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="w-full bg-slate-50 border-0 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-600 focus:outline-none"
              >
                {brands.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-0.5">Filter Supplier</label>
              <select
                value={filterSupplier}
                onChange={(e) => setFilterSupplier(e.target.value)}
                className="w-full bg-slate-50 border-0 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-600 focus:outline-none"
              >
                <option value="All">All Suppliers</option>
                {data?.suppliers?.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl shadow-xl flex items-center gap-4 text-white">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-blue-400">
            <ShoppingCart size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Average demand</div>
            <div className="text-xs font-bold text-slate-200">Based on 8-month sales history</div>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search items by name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:bg-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <th className="px-6 py-4">SKU</th>
                <th className="px-6 py-4">Product details</th>
                <th className="px-6 py-4">Supplier</th>
                <th className="px-6 py-4 text-center">Stock</th>
                <th className="px-6 py-4 text-center">Incoming</th>
                <th className="px-6 py-4 text-center">8M Demand</th>
                <th className="px-6 py-4 text-center">Forecast ROP</th>
                <th className="px-6 py-4 text-center">Recommended Qty</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredItems.map((item: any) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-black text-xs text-slate-900">{item.itemCode}</td>
                  <td className="px-6 py-4">
                    <div className="text-xs font-extrabold text-slate-800">{item.itemName}</div>
                    <div className="text-[10px] font-bold text-slate-400">{item.brand}</div>
                  </td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-500">{item.supplier?.name || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-xs font-black text-slate-800">{item.qtyOnHand}</td>
                  <td className="px-6 py-4 text-center text-xs font-bold text-blue-600">+{item.incomingQty}</td>
                  <td className="px-6 py-4 text-center text-xs font-bold text-slate-500">{item.avgDemand}</td>
                  <td className="px-6 py-4 text-center text-xs font-black text-slate-600">{item.forecastRequirement}</td>
                  <td className="px-6 py-4 text-center">
                    {item.recommendedQty > 0 ? (
                      <span className="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-full text-[10px] font-black">
                        ORDER {item.recommendedQty}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-slate-50 text-slate-400 rounded-full text-[10px] font-bold">
                        No purchase required
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {item.recommendedQty > 0 && (
                      <button
                        onClick={() => handleCreateBulkPO(item.supplier?.id)}
                        className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-[10px] font-black text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all uppercase tracking-tighter"
                      >
                        Order Supplier List
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-xs text-slate-400 font-bold">
                    No items match current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WhatToOrderReportView;
