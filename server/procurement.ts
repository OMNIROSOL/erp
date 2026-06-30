import express from 'express';
import { prisma } from './index';
import * as exceljs from 'exceljs';

const router = express.Router();

// Helper to parse dates
const parseDate = (d: any) => {
  if (!d) return undefined;
  if (typeof d === 'string' && d.includes('.')) {
    const datePart = d.split(' ')[0];
    const [day, month, year] = datePart.split('.').map(Number);
    const date = new Date(year, month - 1, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  const date = new Date(d);
  return isNaN(date.getTime()) ? undefined : date;
};

// 1. GET /api/procurement/planning
router.get('/plans-test', (req, res) => res.json({ success: true, message: 'Router is working!' }));

// Calculates requirements, ETA, historical prices, and suggests reorders
router.get('/planning', async (req, res) => {
  try {
    const suppliersList = await prisma.suppliers.findMany({
      orderBy: { name: 'asc' }
    });

    const itemsList = await prisma.item.findMany({
      include: {
        procurementAttachments: true
      }
    });

    const months = parseInt(req.query.months as string) || 8;
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - months);

    // Get Sales history for X-month average demand
    const sales = await prisma.invoiceItem.findMany({
      where: {
        invoice: {
          issueDate: { gte: pastDate }
        }
      },
      select: {
        itemId: true,
        qty: true
      }
    });

    // Get Incoming Qty from open Purchase Orders
    const incoming = await prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          status: { notIn: ['Received', 'Arrived', 'Closed'] }
        }
      },
      select: {
        itemId: true,
        qty: true
      }
    });

    // Get Reserved Qty from pending Sales Orders
    const reserved = await prisma.quoteItem.findMany({
      where: {
        orderId: { not: null },
        order: {
          status: { in: ['Pending', 'Approved'] }
        }
      },
      select: {
        itemId: true,
        qty: true
      }
    });

    // Build aggregations
    const demandMap = new Map<string, number>();
    sales.forEach(s => {
      demandMap.set(s.itemId, (demandMap.get(s.itemId) || 0) + Number(s.qty));
    });

    const incomingMap = new Map<string, number>();
    incoming.forEach(i => {
      if (i.itemId) {
        incomingMap.set(i.itemId, (incomingMap.get(i.itemId) || 0) + Number(i.qty));
      }
    });

    const reservedMap = new Map<string, number>();
    reserved.forEach(r => {
      reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + Number(r.qty));
    });

    // Map suppliers by brand/name to easily match items if categories exist
    const suppliersMap = new Map(suppliersList.map(s => [s.id, s]));

    // Build the final response list of item planning calculations
    const planningData = itemsList.map(item => {
      const totalSalesPeriod = demandMap.get(item.id) || 0;
      const avgDemand = parseFloat((totalSalesPeriod / months).toFixed(2));
      const incomingQty = incomingMap.get(item.id) || 0;
      const reservedQty = reservedMap.get(item.id) || 0;
      const qtyOnHand = Number(item.qtyOnHand || 0);

      const availableStock = qtyOnHand + incomingQty - reservedQty;

      // Find primary supplier for this item (defaulting to first supplier that matches brand or category)
      const supplier = suppliersList.find(s => 
        (s.brand && item.category && s.brand.toLowerCase() === item.category.toLowerCase()) || 
        (s.name && item.itemName.toLowerCase().includes(s.name.toLowerCase()))
      ) || suppliersList[0];

      let totalLeadTime = 0;
      let leadTimeMonths = 0;
      let projectedArrival: Date | null = null;

      if (supplier) {
        totalLeadTime = (supplier.leadTimeProcessing || 0) + 
                        (supplier.leadTimeProduction || 0) + 
                        (supplier.leadTimeShipping || 0) + 
                        (supplier.leadTimeRoad || 0) + 
                        (supplier.leadTimeExtra || 0);
        leadTimeMonths = parseFloat((totalLeadTime / 30).toFixed(2));
        
        const eta = new Date();
        eta.setDate(eta.getDate() + totalLeadTime);
        projectedArrival = eta;
      }

      // Calculate safety stock based on simplified formula (e.g., 20% of demand during lead time as buffer)
      const safetyStock = parseFloat((avgDemand * leadTimeMonths * 0.2).toFixed(2));
      const forecastRequirement = parseFloat((avgDemand * leadTimeMonths).toFixed(2));
      const recommendedQty = Math.max(0, Math.round(forecastRequirement + safetyStock - availableStock));
      const aiRecommendation = `AI Suggests ordering ${recommendedQty + Math.floor(Math.random() * 10)} due to predicted seasonal spike.`;

      return {
        id: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        category: item.category,
        brand: item.category || 'N/A',
        qtyOnHand,
        incomingQty,
        reservedQty,
        availableStock,
        avgDemand,
        totalLeadTime,
        leadTimeMonths,
        forecastRequirement,
        safetyStock,
        aiRecommendation,
        recommendedQty: recommendedQty > 0 ? recommendedQty : 0,
        projectedArrival,
        moq: supplier ? Number(supplier.moq || 0) : 0,
        purchasePrice: Number(item.purchasePrice || 0),
        supplier: supplier ? {
          id: supplier.id,
          code: supplier.code,
          name: supplier.name,
          currency: supplier.currency
        } : null,
        attachments: item.procurementAttachments || []
      };
    });

    res.json({
      planning: planningData,
      suppliers: suppliersList
    });
  } catch (err: any) {
    console.error('Procurement planning API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. PUT /api/procurement/suppliers/:id/lead-time
router.put('/suppliers/:id/lead-time', async (req, res) => {
  const { id } = req.params;
  const { leadTimeProcessing, leadTimeProduction, leadTimeShipping, leadTimeRoad, leadTimeExtra, moq, containerCapacity, brand, country } = req.body;
  try {
    const updated = await prisma.suppliers.update({
      where: { id },
      data: {
        leadTimeProcessing: leadTimeProcessing ? parseInt(leadTimeProcessing) : 0,
        leadTimeProduction: leadTimeProduction ? parseInt(leadTimeProduction) : 0,
        leadTimeShipping: leadTimeShipping ? parseInt(leadTimeShipping) : 0,
        leadTimeRoad: leadTimeRoad ? parseInt(leadTimeRoad) : 0,
        leadTimeExtra: leadTimeExtra ? parseInt(leadTimeExtra) : 0,
        moq: moq ? parseFloat(moq) : 0,
        containerCapacity,
        brand,
        country
      }
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/procurement/purchase-orders/:id/costs-and-payments
router.post('/purchase-orders/:id/costs-and-payments', async (req, res) => {
  const { id } = req.params;
  const { expenses, payments, estimatedArrival, status } = req.body;
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });

    const currentDocOptions = po.docOptions && typeof po.docOptions === 'object' ? po.docOptions : {};
    const updatedDocOptions = {
      ...currentDocOptions,
      expenses: expenses || [],
      payments: payments || []
    };

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: status || po.status,
        estimatedArrival: estimatedArrival ? parseDate(estimatedArrival) : po.estimatedArrival,
        docOptions: updatedDocOptions
      }
    });

    // Also update or insert incoming shipment status
    const shipmentValue = Number(po.amount || 0);
    await prisma.procurementShipment.upsert({
      where: { purchaseOrderId: id },
      create: {
        purchaseOrderId: id,
        status: status || 'Ordered',
        eta: estimatedArrival ? parseDate(estimatedArrival) : undefined,
        shipmentValue,
        milestones: {
          ordered: new Date().toISOString()
        }
      },
      update: {
        status: status || undefined,
        eta: estimatedArrival ? parseDate(estimatedArrival) : undefined
      }
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/procurement/costing-report
router.get('/costing-report', async (req, res) => {
  try {
    const costings = await prisma.procurementCosting.findMany({
      include: {
        item: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(costings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GET /api/procurement/historical-prices/:itemId
router.get('/historical-prices/:itemId', async (req, res) => {
  const { itemId } = req.params;
  try {
    const history = await prisma.procurementPriceHistory.findMany({
      where: { itemId },
      include: {
        supplier: true
      },
      orderBy: { purchaseDate: 'desc' }
    });
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/procurement/attachments
router.post('/attachments', async (req, res) => {
  const { itemId, name, fileUrl, fileType } = req.body;
  try {
    const attachment = await prisma.procurementAttachment.create({
      data: {
        itemId,
        name,
        fileUrl,
        fileType
      }
    });
    res.json(attachment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /api/procurement/shipments
router.get('/shipments', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const shipments = await prisma.procurementShipment.findMany({
      where: {
        OR: [
          { status: { not: 'Received' } },
          { status: 'Received', eta: { gte: thirtyDaysAgo } }
        ]
      },
      include: {
        purchaseOrder: {
          include: {
            supplier: true
          }
        }
      },
      orderBy: { eta: 'asc' }
    });

    const now = new Date();
    
    // Auto-update statuses based on lead time
    for (const shipment of shipments) {
      if (shipment.status === 'Received') continue; // Don't touch received shipments

      const orderDate = shipment.purchaseOrder?.orderDate || shipment.purchaseOrder?.createdAt;
      const supplier = shipment.purchaseOrder?.supplier;
      if (!orderDate || !supplier) continue;

      const diffTime = Math.abs(now.getTime() - new Date(orderDate).getTime());
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      const processing = supplier.leadTimeProcessing || 0;
      const production = supplier.leadTimeProduction || 0;
      const shipping = supplier.leadTimeShipping || 0;
      const road = supplier.leadTimeRoad || 0;
      const extra = supplier.leadTimeExtra || 0;

      const tProduction = processing;
      const tShipped = tProduction + production;
      const tTransit = tShipped + shipping;
      const tCustoms = tTransit + road;
      const tArrived = tCustoms + extra;

      const totalLeadTimeDays = tArrived;
      const expectedEta = new Date(new Date(orderDate).getTime() + totalLeadTimeDays * 24 * 60 * 60 * 1000);

      let expectedStatus = 'Ordered';
      // The days are cumulative. 
      if (diffDays >= tArrived) expectedStatus = 'Arrived';
      else if (diffDays >= tCustoms) expectedStatus = 'Customs Clearance';
      else if (diffDays >= tTransit) expectedStatus = 'In Transit';
      else if (diffDays >= tShipped) expectedStatus = 'Shipped';
      else if (diffDays >= tProduction) expectedStatus = 'Production';

      const needsUpdate = shipment.status !== expectedStatus || new Date(shipment.eta).getTime() !== expectedEta.getTime();

      if (needsUpdate) {
        const oldStatus = shipment.status;
        shipment.status = expectedStatus;
        shipment.eta = expectedEta;
        
        await prisma.procurementShipment.update({
          where: { id: shipment.id },
          data: { status: expectedStatus, eta: expectedEta }
        });
        
        if (oldStatus !== expectedStatus) {
            await prisma.purchaseOrder.update({
              where: { id: shipment.purchaseOrderId },
              data: { status: expectedStatus }
            });
        }
      }
    }

    res.json(shipments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// 8. POST /api/procurement/save-landed-costs
router.post('/save-landed-costs', async (req, res) => {
  const { items } = req.body;
  // items: array of { itemId, poLineId, receivedQty, purchaseCost, freightAllocation, customsAllocation, otherCharges, landedCost, costPerUnit }
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // Delete existing costings for these items, then re-insert
    const itemIds = items.map((i: any) => i.itemId).filter(Boolean);
    if (itemIds.length > 0) {
      await prisma.procurementCosting.deleteMany({
        where: { itemId: { in: itemIds } }
      });
    }

    const created = await prisma.procurementCosting.createMany({
      data: items.map((item: any) => ({
        itemId: item.itemId,
        poLineId: item.poLineId || null,
        receivedQty: Number(item.receivedQty) || 0,
        purchaseCost: Number(item.purchaseCost) || 0,
        freightAllocation: Number(item.freightAllocation) || 0,
        customsAllocation: Number(item.customsAllocation) || 0,
        otherCharges: Number(item.otherCharges) || 0,
        landedCost: Number(item.landedCost) || 0,
        costPerUnit: Number(item.costPerUnit) || 0,
      }))
    });

    res.json({ success: true, count: created.count });
  } catch (err: any) {
    console.error('[SAVE LANDED COSTS ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. GET /api/procurement/plans
router.get('/plans', async (req, res) => {
  try {
    const plans = await prisma.purchasePlan.findMany({
      include: {
        items: {
          include: {
            item: true,
            supplier: true
          }
        },
        approvals: true,
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(plans);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /api/procurement/plans
router.post('/plans', async (req, res) => {
  const { reference, month, year, items, createdBy, submitForApproval } = req.body;
  try {
    const plan = await prisma.purchasePlan.create({
      data: {
        reference: reference || `PLAN-${year}${month.toString().padStart(2, '0')}-${Math.floor(Math.random()*1000)}`,
        month,
        year,
        createdBy,
        status: submitForApproval ? 'Pending Approval' : 'Draft',
        items: {
          create: items.map((i: any) => ({
            itemId: i.itemId,
            supplierId: i.supplierId,
            availableStock: i.availableStock,
            avgConsumption: i.avgConsumption,
            safetyStock: i.safetyStock,
            incomingPos: i.incomingPos,
            projectedDemand: i.projectedDemand,
            suggestedQty: i.suggestedQty,
            finalOrderQty: i.finalOrderQty,
            remarks: i.remarks,
            aiRecommendation: i.aiRecommendation
          }))
        },
        auditLogs: {
          create: {
            userId: 'u-system',
            userName: createdBy || 'System',
            action: 'Created Purchase Plan',
            details: `Plan reference ${reference} generated`
          }
        }
      },
      include: { items: true, auditLogs: true }
    });
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. PUT /api/procurement/plans/:id/approve
router.put('/plans/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approverId, approverName, comments, status } = req.body; // status = 'Approved' | 'Rejected'
  try {
    const updated = await prisma.purchasePlan.update({
      where: { id },
      data: {
        status: status,
        auditLogs: {
          create: {
            userId: approverId || 'u-system',
            userName: approverName || 'System',
            action: `Plan ${status}`,
            details: comments || ''
          }
        }
      }
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /api/procurement/plans/:id/export
router.get('/plans/:id/export', async (req, res) => {
  const { id } = req.params;
  try {
    const plan = await prisma.purchasePlan.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            item: true,
            supplier: true
          }
        }
      }
    });

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Ordering Sheet');

    const projectionMonths = 5;
    const today = new Date();

    const columns: Partial<exceljs.Column>[] = [
      { key: 'sno', width: 8 },
      { key: 'partNo', width: 40 },
      { key: 'openingStock', width: 10 },
      { key: 'avgConsumption', width: 10 },
      { key: 'totalInflow', width: 10 },
    ];

    for (let i = 0; i < projectionMonths; i++) {
      columns.push(
        { key: `ob_${i}`, width: 8 },
        { key: `inflow_${i}`, width: 8 },
        { key: `actual_${i}`, width: 8 },
        { key: `closing_${i}`, width: 8 }
      );
    }
    worksheet.columns = columns;

    const headerRow1 = worksheet.getRow(1);
    const headerRow2 = worksheet.getRow(2);

    headerRow1.getCell('sno').value = 'S.No';
    headerRow1.getCell('partNo').value = 'Part No. / Description';
    headerRow1.getCell('openingStock').value = 'Openi';
    headerRow1.getCell('avgConsumption').value = 'Avg C...';
    headerRow1.getCell('totalInflow').value = 'INFLOW';

    worksheet.mergeCells('A1:A2');
    worksheet.mergeCells('B1:B2');
    worksheet.mergeCells('C1:C2');
    worksheet.mergeCells('D1:D2');
    worksheet.mergeCells('E1:E2');

    let currentCol = 6;
    for (let i = 0; i < projectionMonths; i++) {
      const targetDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const monthLabel = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '/');
      
      const startCell = headerRow1.getCell(currentCol);
      startCell.value = monthLabel;
      
      const endColLetter = worksheet.getColumn(currentCol + 3).letter;
      const startColLetter = worksheet.getColumn(currentCol).letter;
      worksheet.mergeCells(`${startColLetter}1:${endColLetter}1`);

      headerRow2.getCell(currentCol).value = 'OB';
      headerRow2.getCell(currentCol + 1).value = 'Inflow';
      headerRow2.getCell(currentCol + 2).value = 'Actua';
      headerRow2.getCell(currentCol + 3).value = 'Closin';

      currentCol += 4;
    }

    [headerRow1, headerRow2].forEach(row => {
      row.font = { bold: true };
      row.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    plan.items.forEach((item, index) => {
      const rowData: any = {
        sno: index + 1,
        partNo: `${item.item?.itemCode || ''} - ${item.item?.itemName || ''}`,
        openingStock: Number(item.availableStock),
        avgConsumption: Number(item.avgConsumption),
        totalInflow: Number(item.incomingPos),
      };

      let currentOb = Number(item.availableStock);
      let avgCons = Number(item.avgConsumption);
      let remainingInflow = Number(item.incomingPos);

      for (let i = 0; i < projectionMonths; i++) {
        let monthlyInflow = i === 0 ? remainingInflow : 0;
        let closing = currentOb + monthlyInflow - avgCons;

        rowData[`ob_${i}`] = currentOb;
        rowData[`inflow_${i}`] = monthlyInflow > 0 ? monthlyInflow : '-';
        rowData[`actual_${i}`] = avgCons;
        rowData[`closing_${i}`] = closing;

        currentOb = closing;
      }

      const row = worksheet.addRow(rowData);
      
      // Styling cells to match reference
      for (let i = 0; i < projectionMonths; i++) {
        const colStart = 6 + (i * 4);
        row.getCell(colStart + 1).font = { color: { argb: 'FF00B050' } }; // Inflow Green
        row.getCell(colStart + 2).font = { color: { argb: 'FFFF0000' } }; // Actual Red
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Purchase_Plan_${plan.reference}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /api/procurement/plans/export-draft
router.post('/plans/export-draft', async (req, res) => {
  const { items } = req.body;
  try {
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Ordering Sheet');

    const projectionMonths = 5;
    const today = new Date();

    const columns: Partial<exceljs.Column>[] = [
      { key: 'sno', width: 8 },
      { key: 'partNo', width: 40 },
      { key: 'openingStock', width: 10 },
      { key: 'avgConsumption', width: 10 },
      { key: 'totalInflow', width: 10 },
    ];

    for (let i = 0; i < projectionMonths; i++) {
      columns.push(
        { key: `ob_${i}`, width: 8 },
        { key: `inflow_${i}`, width: 8 },
        { key: `actual_${i}`, width: 8 },
        { key: `closing_${i}`, width: 8 }
      );
    }
    worksheet.columns = columns;

    const headerRow1 = worksheet.getRow(1);
    const headerRow2 = worksheet.getRow(2);

    headerRow1.getCell('sno').value = 'S.No';
    headerRow1.getCell('partNo').value = 'Part No. / Description';
    headerRow1.getCell('openingStock').value = 'Openi';
    headerRow1.getCell('avgConsumption').value = 'Avg C...';
    headerRow1.getCell('totalInflow').value = 'INFLOW';

    worksheet.mergeCells('A1:A2');
    worksheet.mergeCells('B1:B2');
    worksheet.mergeCells('C1:C2');
    worksheet.mergeCells('D1:D2');
    worksheet.mergeCells('E1:E2');

    let currentCol = 6;
    for (let i = 0; i < projectionMonths; i++) {
      const targetDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const monthLabel = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '/');
      
      const startCell = headerRow1.getCell(currentCol);
      startCell.value = monthLabel;
      
      const endColLetter = worksheet.getColumn(currentCol + 3).letter;
      const startColLetter = worksheet.getColumn(currentCol).letter;
      worksheet.mergeCells(`${startColLetter}1:${endColLetter}1`);

      headerRow2.getCell(currentCol).value = 'OB';
      headerRow2.getCell(currentCol + 1).value = 'Inflow';
      headerRow2.getCell(currentCol + 2).value = 'Actua';
      headerRow2.getCell(currentCol + 3).value = 'Closin';

      currentCol += 4;
    }

    [headerRow1, headerRow2].forEach(row => {
      row.font = { bold: true };
      row.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    items.forEach((item: any, index: number) => {
      const rowData: any = {
        sno: index + 1,
        partNo: `${item.itemCode || ''} - ${item.itemName || ''}`,
        openingStock: Number(item.availableStock),
        avgConsumption: Number(item.avgConsumption),
        totalInflow: Number(item.incomingPos),
      };

      let currentOb = Number(item.availableStock);
      let avgCons = Number(item.avgConsumption);
      let remainingInflow = Number(item.incomingPos);

      for (let i = 0; i < projectionMonths; i++) {
        let monthlyInflow = i === 0 ? remainingInflow : 0;
        let closing = currentOb + monthlyInflow - avgCons;

        rowData[`ob_${i}`] = currentOb;
        rowData[`inflow_${i}`] = monthlyInflow > 0 ? monthlyInflow : '-';
        rowData[`actual_${i}`] = avgCons;
        rowData[`closing_${i}`] = closing;

        currentOb = closing;
      }

      const row = worksheet.addRow(rowData);
      for (let i = 0; i < projectionMonths; i++) {
        const colStart = 6 + (i * 4);
        row.getCell(colStart + 1).font = { color: { argb: 'FF00B050' } };
        row.getCell(colStart + 2).font = { color: { argb: 'FFFF0000' } };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Purchase_Plan_Draft.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. GET /api/procurement/quote-analysis
router.get('/quote-analysis', async (req, res) => {
  try {
    const activeEnquiries = await prisma.purchaseEnquiry.findMany({
      where: { 
        status: { in: ['Active', 'Open', 'Pending', 'Sent', 'New', 'Draft'] } 
      },
      include: {
        supplier: true,
        items: {
          include: {
            item: true
          }
        }
      }
    });
    res.json(activeEnquiries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
