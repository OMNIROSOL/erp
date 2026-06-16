import React, { useState, useEffect, useMemo } from 'react';
import {
  Ship, Calendar, Clock, DollarSign, ArrowRight, Settings, AlertCircle,
  Truck, CheckCircle, Package, ArrowRightLeft, FileSpreadsheet, Anchor, FileText
} from 'lucide-react';
import apiService from '../../services/apiService';

const statusColumns = [
  { id: 'Ordered', name: 'Ordered', color: 'bg-blue-500/10 text-blue-500' },
  { id: 'Production', name: 'Production', color: 'bg-purple-500/10 text-purple-500' },
  { id: 'Shipped', name: 'Shipped', color: 'bg-indigo-500/10 text-indigo-500' },
  { id: 'In Transit', name: 'In Transit', color: 'bg-cyan-500/10 text-cyan-500' },
  { id: 'Customs Clearance', name: 'Customs', color: 'bg-amber-500/10 text-amber-500' },
  { id: 'Arrived', name: 'Arrived', color: 'bg-emerald-500/10 text-emerald-500' },
  { id: 'Received', name: 'Received', color: 'bg-slate-500/10 text-slate-400' }
];

const IncomingShipmentsView = () => {
  const [loading, setLoading] = useState(true);
  const [shipments, setShipments] = useState<any[]>([]);
  const [activeShipment, setActiveShipment] = useState<any>(null);

  // Landed cost calculator state
  const [expenses, setExpenses] = useState({
    freight: '0',
    customs: '0',
    clearing: '0',
    insurance: '0',
    transport: '0',
    handling: '0',
    miscellaneous: '0'
  });
  const [allocationMethod, setAllocationMethod] = useState<'ByValue' | 'ByQuantity'>('ByValue');

  const loadShipments = async () => {
    setLoading(true);
    try {
      const data = await apiService.getProcurementShipments();
      setShipments(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShipments();
  }, []);

  const handleUpdateStatus = async (shipmentId: string, newStatus: string) => {
    try {
      // Find the purchase order id
      const shipment = shipments.find(s => s.id === shipmentId);
      if (!shipment) return;

      const poId = shipment.purchaseOrderId;
      
      // If setting to Received, open the costing allocation panel
      if (newStatus === 'Received') {
        setActiveShipment(shipment);
        return;
      }

      await apiService.saveOrderCostsAndPayments(poId, {
        status: newStatus
      });
      loadShipments();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAllocateCosts = async () => {
    if (!activeShipment) return;
    try {
      const poId = activeShipment.purchaseOrderId;
      const expensesList = [
        { description: 'Freight', amount: Number(expenses.freight) || 0 },
        { description: 'Customs Duty', amount: Number(expenses.customs) || 0 },
        { description: 'Clearing Charges', amount: Number(expenses.clearing) || 0 },
        { description: 'Insurance', amount: Number(expenses.insurance) || 0 },
        { description: 'Transport', amount: Number(expenses.transport) || 0 },
        { description: 'Handling', amount: Number(expenses.handling) || 0 },
        { description: 'Miscellaneous', amount: Number(expenses.miscellaneous) || 0 }
      ];

      await apiService.saveOrderCostsAndPayments(poId, {
        status: 'Received',
        expenses: expensesList,
        allocationMethod
      });

      alert('Landed costs allocated successfully and shipment marked as Received!');
      setActiveShipment(null);
      setExpenses({
        freight: '0',
        customs: '0',
        clearing: '0',
        insurance: '0',
        transport: '0',
        handling: '0',
        miscellaneous: '0'
      });
      loadShipments();
    } catch (err) {
      console.error(err);
      alert('Failed to allocate landed costs.');
    }
  };

  const groupedShipments = useMemo(() => {
    const groups: Record<string, any[]> = {
      'Ordered': [],
      'Production': [],
      'Shipped': [],
      'In Transit': [],
      'Customs Clearance': [],
      'Arrived': [],
      'Received': []
    };
    shipments.forEach(s => {
      if (groups[s.status]) {
        groups[s.status].push(s);
      }
    });
    return groups;
  }, [shipments]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-black uppercase tracking-widest">Loading incoming shipments...</div>;
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-6">
        <div>
          <div className="flex items-center space-x-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">
            <Anchor size={14} />
            <span className="text-gray-400">Logistics Tracking</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Incoming Shipments Board</h1>
          <p className="text-slate-500 text-sm">Monitor milestones from supplier production to warehouse receipt</p>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {statusColumns.map(col => {
          const columnShipments = groupedShipments[col.id] || [];
          return (
            <div key={col.id} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200/50 min-h-[400px] flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${col.color}`}>
                  {col.name}
                </span>
                <span className="text-xs font-bold text-slate-400">{columnShipments.length}</span>
              </div>

              <div className="flex-1 space-y-3">
                {columnShipments.map(s => {
                  const delayed = s.delayedDays > 0;
                  return (
                    <div
                      key={s.id}
                      className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 hover:shadow-md transition-shadow relative group"
                    >
                      <div className="flex justify-between items-start">
                        <div className="text-[10px] font-bold text-slate-400">{s.purchaseOrder?.supplier?.name}</div>
                        {delayed && (
                          <div className="flex items-center gap-1 text-[9px] text-rose-500 font-bold bg-rose-50 px-1.5 py-0.5 rounded-full">
                            <AlertCircle size={10} /> Delayed {s.delayedDays}d
                          </div>
                        )}
                      </div>

                      <div className="font-extrabold text-xs text-slate-800">PO: {s.purchaseOrder?.reference}</div>

                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <Calendar size={12} className="text-slate-400" />
                        <span>ETA: {new Date(s.eta).toLocaleDateString('en-GB')}</span>
                      </div>

                      <div className="text-xs font-extrabold text-blue-600">
                        USD {Number(s.shipmentValue).toLocaleString()}
                      </div>

                      {/* Dropdown status updater */}
                      <div className="pt-2 border-t border-slate-50 flex items-center justify-between">
                        <select
                          value={s.status}
                          onChange={(e) => handleUpdateStatus(s.id, e.target.value)}
                          className="bg-slate-50 border-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500 focus:outline-none"
                        >
                          {statusColumns.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Landed Cost Allocation Modal */}
      {activeShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-black text-slate-900 tracking-tight uppercase">Landed Cost Allocation</h3>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500">
                Marking PO <strong>{activeShipment.purchaseOrder?.reference}</strong> as Received. Input expenses to allocate them to individual items.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase text-slate-400">Ocean Freight cost</label>
                  <input
                    type="number"
                    value={expenses.freight}
                    onChange={(e) => setExpenses({ ...expenses, freight: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase text-slate-400">Customs Duty</label>
                  <input
                    type="number"
                    value={expenses.customs}
                    onChange={(e) => setExpenses({ ...expenses, customs: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase text-slate-400">Clearing Agent Fees</label>
                  <input
                    type="number"
                    value={expenses.clearing}
                    onChange={(e) => setExpenses({ ...expenses, clearing: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase text-slate-400">Road Transport</label>
                  <input
                    type="number"
                    value={expenses.transport}
                    onChange={(e) => setExpenses({ ...expenses, transport: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 block">Allocation Method</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="allocationMethod"
                      value="ByValue"
                      checked={allocationMethod === 'ByValue'}
                      onChange={() => setAllocationMethod('ByValue')}
                    />
                    Proportional by Value (Cost)
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="allocationMethod"
                      value="ByQuantity"
                      checked={allocationMethod === 'ByQuantity'}
                      onChange={() => setAllocationMethod('ByQuantity')}
                    />
                    Proportional by Quantity
                  </label>
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-50">
                <button
                  type="button"
                  onClick={() => setActiveShipment(null)}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAllocateCosts}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black"
                >
                  Allocate & Mark Received
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncomingShipmentsView;
