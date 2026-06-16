import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText, Search, TrendingUp, DollarSign, Layers, Calendar, BarChart3,
  ArrowRight, Landmark, Scale, Coins, Package
} from 'lucide-react';
import apiService from '../../services/apiService';

const CostingReportView = () => {
  const [loading, setLoading] = useState(true);
  const [costings, setCostings] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const loadCostingReport = async () => {
    setLoading(true);
    try {
      const data = await apiService.getProcurementCostingReport();
      setCostings(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCostingReport();
  }, []);

  const filteredCostings = useMemo(() => {
    return costings.filter(c =>
      c.item?.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.item?.itemCode.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [costings, searchQuery]);

  // Calculations for KPI cards
  const summaryStats = useMemo(() => {
    let totalLanded = 0;
    let totalPurchase = 0;
    let totalOverhead = 0;
    
    costings.forEach(c => {
      totalLanded += Number(c.landedCost || 0);
      totalPurchase += Number(c.purchaseCost || 0);
      totalOverhead += (Number(c.freightAllocation || 0) + Number(c.customsAllocation || 0) + Number(c.otherCharges || 0));
    });

    const overheadPercentage = totalPurchase > 0 ? parseFloat(((totalOverhead / totalPurchase) * 100).toFixed(1)) : 0;

    return {
      totalLanded,
      totalPurchase,
      totalOverhead,
      overheadPercentage
    };
  }, [costings]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-black uppercase tracking-widest">Generating cost analysis...</div>;
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-6">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">
            <BarChart3 size={14} />
            <span className="text-gray-400">Financial Reports</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Procurement & Landed Costing Reports</h1>
          <p className="text-slate-500 text-sm">View purchase costs, overhead allocations, and final acquisition unit costs</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
            <Coins size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Purchase Cost</div>
            <div className="text-xl font-black text-slate-900">USD {summaryStats.totalPurchase.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
            <Scale size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Allocated Overheads</div>
            <div className="text-xl font-black text-slate-900">USD {summaryStats.totalOverhead.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
            <Landmark size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Landed Value</div>
            <div className="text-xl font-black text-slate-900">USD {summaryStats.totalLanded.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl shadow-xl flex items-center gap-4 text-white">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-blue-400">
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Avg Overhead markup</div>
            <div className="text-xl font-black text-white">+{summaryStats.overheadPercentage}%</div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
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
                <th className="px-6 py-4">Item Code</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4 text-center">Qty Received</th>
                <th className="px-6 py-4 text-right">Purchase Cost</th>
                <th className="px-6 py-4 text-right">Freight Allocation</th>
                <th className="px-6 py-4 text-right">Customs Allocation</th>
                <th className="px-6 py-4 text-right">Other Charges</th>
                <th className="px-6 py-4 text-right">Landed Cost</th>
                <th className="px-6 py-4 text-right">Unit Landed Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredCostings.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-black text-xs text-slate-900">{c.item?.itemCode}</td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-800">{c.item?.itemName}</td>
                  <td className="px-6 py-4 text-center text-xs font-black text-slate-600">{Number(c.receivedQty)}</td>
                  <td className="px-6 py-4 text-right text-xs font-bold text-slate-600">USD {Number(c.purchaseCost).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-xs font-bold text-slate-500">USD {Number(c.freightAllocation).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-xs font-bold text-slate-500">USD {Number(c.customsAllocation).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-xs font-bold text-slate-500">USD {Number(c.otherCharges).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-xs font-black text-slate-900">USD {Number(c.landedCost).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-xs font-black text-blue-600">
                    USD {Number(c.costPerUnit).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {filteredCostings.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-xs text-slate-400 font-bold">
                    No costing reports generated yet
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

export default CostingReportView;
