import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSpreadsheet, Search, CheckCircle, Save, Download, Clock,
  AlertTriangle, Filter, Sparkles, Send, History, ChevronRight
} from 'lucide-react';
import apiService from '../../services/apiService';
import { PurchasePlan, PurchasePlanItem } from '../../types';

const PurchasePlanningView = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  // Data states
  const [planningData, setPlanningData] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [pastPlans, setPastPlans] = useState<PurchasePlan[]>([]);
  
  // UI states
  const [months, setMonths] = useState<number>(8);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('All');
  
  // Plan building states
  const [planItems, setPlanItems] = useState<Record<string, { finalOrderQty: number, remarks: string }>>({});
  
  // Active Tab
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  
  // Selected Plan for details modal
  const [selectedPlan, setSelectedPlan] = useState<any | null>(null);

  // Price Compare
  const [comparingItem, setComparingItem] = useState<any | null>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const planningRes = await apiService.getPlanningData(months);
      setPlanningData(planningRes.planning || []);
      setSuppliers(planningRes.suppliers || []);
      
      // Initialize plan items
      const initialItems: Record<string, { finalOrderQty: number, remarks: string }> = {};
      (planningRes.planning || []).forEach((item: any) => {
        initialItems[item.id] = {
          finalOrderQty: item.recommendedQty || 0,
          remarks: ''
        };
      });
      setPlanItems(initialItems);
      
      try {
        const plansRes = await apiService.getPurchasePlans();
        setPastPlans(plansRes || []);
      } catch (plansErr) {
        console.warn('Failed to load past plans (possibly old server):', plansErr);
        setPastPlans([]);
      }
      
    } catch (err) {
      console.error('Failed to load planning data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [months]);

  const filteredItems = useMemo(() => {
    return planningData.filter((item: any) => {
      const matchesSupplier = filterSupplier === 'All' || item.supplier?.id === filterSupplier;
      const searchLower = searchQuery.toLowerCase();
      const nameMatch = item.itemName ? item.itemName.toLowerCase().includes(searchLower) : false;
      const codeMatch = item.itemCode ? item.itemCode.toLowerCase().includes(searchLower) : false;
      const matchesSearch = searchQuery === '' || nameMatch || codeMatch;
      return matchesSupplier && matchesSearch;
    });
  }, [planningData, filterSupplier, searchQuery]);

  const handleItemChange = (id: string, field: 'finalOrderQty' | 'remarks' | 'supplierId', value: any) => {
    setPlanItems(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  };

  const handleSavePlan = async (submitForApproval: boolean) => {
    const itemsToSave = planningData
      .filter(item => planItems[item.id]?.finalOrderQty > 0 || item.recommendedQty > 0)
      .map(item => ({
        itemId: item.id,
        supplierId: planItems[item.id]?.supplierId || item.supplier?.id,
        availableStock: item.availableStock,
        avgConsumption: item.avgDemand,
        safetyStock: item.safetyStock,
        incomingPos: item.incomingQty,
        projectedDemand: item.forecastRequirement,
        suggestedQty: item.recommendedQty,
        finalOrderQty: planItems[item.id]?.finalOrderQty || 0,
        remarks: planItems[item.id]?.remarks || '',
        aiRecommendation: item.aiRecommendation
      }));

    if (itemsToSave.length === 0) {
      alert("No items to save in this plan.");
      return;
    }

    setSaving(true);
    try {
      const reference = `PLAN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`;
      const payload = {
        reference,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        items: itemsToSave,
        createdBy: 'u-admin' // Mocked current user
      };
      
      const newPlan = await apiService.createPurchasePlan(payload);
      
      if (submitForApproval) {
        await apiService.approvePurchasePlan(newPlan.id, {
          approverId: 'u-system',
          approverName: 'System',
          comments: 'Submitted for Level 1 Approval',
          status: 'Pending Approval'
        });
        alert(`Plan ${reference} saved and submitted for approval!`);
      } else {
        alert(`Plan ${reference} saved as Draft!`);
      }
      
      loadData();
      setActiveTab('history');
    } catch (err: any) {
      alert('Failed to save plan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportDraft = async () => {
    const itemsToExport = planningData
      .filter(item => planItems[item.id]?.finalOrderQty > 0 || item.recommendedQty > 0 || item.availableStock > 0)
      .map(item => ({
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        supplierId: item.supplier?.id,
        availableStock: item.availableStock,
        avgConsumption: item.avgDemand,
        incomingPos: item.incomingQty,
      }));

    if (itemsToExport.length === 0) {
      alert("No items to export.");
      return;
    }

    setExporting(true);
    try {
      await apiService.exportPurchasePlanDraft({ items: itemsToExport });
    } catch (err: any) {
      alert('Failed to export plan: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExport = (planId: string) => {
    apiService.exportPurchasePlan(planId);
  };

  const handleComparePrice = async (item: any) => {
    setComparingItem(item);
    setLoadingHistory(true);
    try {
      const history = await apiService.getHistoricalPrices(item.id);
      setPriceHistory(history || []);
    } catch (err) {
      console.error(err);
      setPriceHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-6">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">
            <FileSpreadsheet size={14} />
            <span className="text-gray-400">Procurement Planning</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Purchase Planning Module</h1>
          <p className="text-slate-500 text-sm">Create dynamic purchase plans with multi-level approvals and AI insights</p>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'create' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
          >
            Create New Plan
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'history' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
          >
            Plan History & Approvals
          </button>
        </div>
      </div>

      {activeTab === 'create' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Consumption Period</label>
                <select
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="w-40 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                >
                  <option value={3}>3 Months</option>
                  <option value={6}>6 Months</option>
                  <option value={8}>8 Months</option>
                  <option value={12}>12 Months</option>
                </select>
              </div>
              
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Filter Supplier</label>
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  className="w-48 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                >
                  <option value="All">All Suppliers</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Search Items</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by code or name..."
                    className="w-64 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={handleExportDraft}
                disabled={exporting}
                className="px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Download size={14} /> Export to Excel
              </button>
              <button 
                onClick={() => handleSavePlan(false)}
                disabled={saving}
                className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save size={14} /> Save Draft
              </button>
              <button 
                onClick={() => handleSavePlan(true)}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-md shadow-indigo-200 disabled:opacity-50"
              >
                <Send size={14} /> Submit for Approval
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left border-collapse min-w-[1200px]">
                <thead className="bg-slate-800 text-white sticky top-0 z-10">
                  <tr className="text-[9px] font-black uppercase tracking-widest">
                    <th className="px-4 py-3 border-b border-slate-700">Item Details</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Avail Stock</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Incoming</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Avg Cons.</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Safety Stock</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center text-amber-200">Suggested Qty</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center bg-slate-700">Final Order Qty</th>
                    <th className="px-4 py-3 border-b border-slate-700 bg-slate-700">Remarks</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Compare Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                        Loading Planning Data...
                      </td>
                    </tr>
                  ) : filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="text-xs font-black text-slate-900">{item.itemCode}</div>
                        <div className="text-[10px] font-semibold text-slate-500 truncate max-w-[200px]">{item.itemName}</div>
                        <select 
                          className="mt-1 block w-full bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[9px] font-bold text-blue-700 focus:outline-none focus:border-blue-400"
                          value={planItems[item.id]?.supplierId || ''}
                          onChange={(e) => handleItemChange(item.id, 'supplierId', e.target.value)}
                        >
                          <option value="">Select Supplier</option>
                          {suppliers.map(sup => (
                            <option key={sup.id} value={sup.id}>{sup.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-slate-700">{item.availableStock}</td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-slate-500">{item.incomingQty}</td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-indigo-600">{item.avgDemand}</td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-slate-500">{item.safetyStock}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                          item.recommendedQty > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {item.recommendedQty}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center bg-blue-50/30">
                        <input
                          type="number"
                          value={planItems[item.id]?.finalOrderQty ?? 0}
                          onChange={(e) => handleItemChange(item.id, 'finalOrderQty', Number(e.target.value))}
                          className="w-20 px-2 py-1.5 bg-white border border-blue-200 rounded-lg text-xs font-black text-center text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                        />
                      </td>
                      <td className="px-4 py-3 bg-blue-50/30">
                        <input
                          type="text"
                          value={planItems[item.id]?.remarks ?? ''}
                          onChange={(e) => handleItemChange(item.id, 'remarks', e.target.value)}
                          placeholder="Add remark..."
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-medium text-slate-700 focus:outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => handleComparePrice(item)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded shadow-sm text-[9px] font-black uppercase tracking-widest text-slate-600 transition-colors"
                        >
                          Compare
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                        No items found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-slate-50">
            <History size={16} className="text-slate-400" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-600">Saved Plans & Approvals</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white border-b border-gray-100">
                <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">Date Created</th>
                  <th className="px-6 py-4">Created By</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-center">Items</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pastPlans.map(plan => (
                  <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-xs font-black text-slate-800">{plan.reference}</td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-500">
                      {plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-500">{plan.createdBy || 'System'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                        plan.status === 'Approved' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                        plan.status === 'Pending Approval' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                        plan.status === 'Rejected' ? 'bg-rose-50 text-rose-600 border border-rose-200' :
                        'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {plan.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-xs font-black text-slate-600">
                      {plan.items?.length || 0}
                    </td>
                    <td className="px-6 py-4 flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleExport(plan.id)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-all flex items-center gap-1 shadow-sm"
                      >
                        <Download size={12} /> Excel Export
                      </button>
                      <button 
                        onClick={() => setSelectedPlan(plan)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all flex items-center gap-1 shadow-sm"
                      >
                        View Details <ChevronRight size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                {pastPlans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                      No purchase plans found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
              <div>
                <h3 className="text-sm font-black text-slate-800">Plan Details: {selectedPlan.reference}</h3>
                <p className="text-xs font-semibold text-slate-500">Status: {selectedPlan.status}</p>
              </div>
              <button 
                onClick={() => setSelectedPlan(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <span className="text-xl font-bold leading-none">&times;</span>
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-800 text-white sticky top-0 z-10">
                  <tr className="text-[9px] font-black uppercase tracking-widest">
                    <th className="px-4 py-3 border-b border-slate-700">Item</th>
                    <th className="px-4 py-3 border-b border-slate-700">Supplier</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Avail Stock</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center">Avg Cons.</th>
                    <th className="px-4 py-3 border-b border-slate-700 text-center text-emerald-300">Order Qty</th>
                    <th className="px-4 py-3 border-b border-slate-700">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedPlan.items?.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-xs font-black text-slate-900">{item.item?.itemCode || 'Unknown'}</div>
                        <div className="text-[10px] font-semibold text-slate-500">{item.item?.itemName || 'Unknown Item'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-700">
                        {item.supplier?.name || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-slate-700">{item.availableStock}</td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-indigo-600">{item.avgConsumption}</td>
                      <td className="px-4 py-3 text-center text-xs font-black text-emerald-600">{item.finalOrderQty}</td>
                      <td className="px-4 py-3 text-[10px] font-medium text-slate-600">{item.remarks || '-'}</td>
                    </tr>
                  ))}
                  {(!selectedPlan.items || selectedPlan.items.length === 0) && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                        No items in this plan
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            {selectedPlan.status === 'Pending Approval' && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={async () => {
                    try {
                      await apiService.approvePurchasePlan(selectedPlan.id, {
                        approverId: 'u-system',
                        approverName: 'System',
                        comments: 'Rejected by user',
                        status: 'Rejected'
                      });
                      setSelectedPlan(null);
                      loadData();
                    } catch (e: any) { alert(e.message); }
                  }}
                  className="px-4 py-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition-colors"
                >
                  Reject Plan
                </button>
                <button 
                  onClick={async () => {
                    try {
                      await apiService.approvePurchasePlan(selectedPlan.id, {
                        approverId: 'u-system',
                        approverName: 'System',
                        comments: 'Approved by user',
                        status: 'Approved'
                      });
                      setSelectedPlan(null);
                      loadData();
                    } catch (e: any) { alert(e.message); }
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-200"
                >
                  Approve Plan
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {comparingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
              <div>
                <h3 className="text-sm font-black text-slate-800">Price History: {comparingItem.itemCode}</h3>
                <p className="text-xs font-semibold text-slate-500">{comparingItem.itemName}</p>
              </div>
              <button 
                onClick={() => setComparingItem(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <span className="text-xl font-bold leading-none">&times;</span>
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {loadingHistory ? (
                <div className="p-8 text-center text-slate-400 font-bold uppercase tracking-widest animate-pulse">
                  Loading Price History...
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-800 text-white sticky top-0 z-10">
                    <tr className="text-[9px] font-black uppercase tracking-widest">
                      <th className="px-4 py-3 border-b border-slate-700">Date</th>
                      <th className="px-4 py-3 border-b border-slate-700">Supplier</th>
                      <th className="px-4 py-3 border-b border-slate-700 text-center">Unit Price</th>
                      <th className="px-4 py-3 border-b border-slate-700 text-center">Currency</th>
                      <th className="px-4 py-3 border-b border-slate-700">PO Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {priceHistory.map((hist: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-slate-700">
                          {new Date(hist.purchaseDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700">
                          {hist.supplier?.name || 'Unknown'}
                        </td>
                        <td className="px-4 py-3 text-center text-xs font-black text-indigo-600">
                          {hist.unitPrice}
                        </td>
                        <td className="px-4 py-3 text-center text-xs font-bold text-slate-500">
                          {hist.currency}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-600">
                          {hist.poReference || '-'}
                        </td>
                      </tr>
                    ))}
                    {priceHistory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                          No price history found
                        </td>
                      </tr>
                    )}
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

export default PurchasePlanningView;
