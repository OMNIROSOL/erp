import express from 'express';
import { prisma } from './index';

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

    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);

    // Get Sales history for 8-month average demand
    const sales = await prisma.invoiceItem.findMany({
      where: {
        invoice: {
          issueDate: { gte: eightMonthsAgo }
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
      const totalSales8m = demandMap.get(item.id) || 0;
      const avgDemand = parseFloat((totalSales8m / 8).toFixed(2));
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

      const forecastRequirement = parseFloat((avgDemand * leadTimeMonths).toFixed(2));
      const recommendedQty = Math.max(0, parseFloat((forecastRequirement - availableStock).toFixed(2)));

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
    const shipments = await prisma.procurementShipment.findMany({
      include: {
        purchaseOrder: {
          include: {
            supplier: true
          }
        }
      },
      orderBy: { eta: 'asc' }
    });
    res.json(shipments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
