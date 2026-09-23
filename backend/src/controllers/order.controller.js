const { Sale, SaleItem, Product, Customer, User, sequelize, Sequelize } = require('../models');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const notificationController = require('./notification.controller');
const { uuidToNumericId } = require('../utils/idConverter');
const { Op } = Sequelize;

// Get upload directory from environment variables or use default
const uploadDir = process.env.UPLOAD_DIR || 'uploads';

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Get orders with optional filtering by status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.getOrders = async (req, res, next) => {
  try {
    const { status, limit } = req.query;
    
    // Build query options
    const queryOptions = {
      include: [
        { model: Customer, as: 'customer' },
        { model: User, as: 'createdBy', attributes: ['id', 'fullName', 'email'] },
        { 
          model: SaleItem, 
          as: 'items',
          include: [{ model: Product }],
        },
      ],
      order: [['createdAt', 'DESC']],
    };
    
    // Add status filter if provided
    if (status) {
      queryOptions.where = { ...queryOptions.where, status };
    }
    
    // Add limit if provided
    if (limit && !isNaN(parseInt(limit))) {
      queryOptions.limit = parseInt(limit);
    }
    
    const orders = await Sale.findAll(queryOptions);
    
    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get order by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    let queryCondition = {};

    // Check if ID is UUID
    const looksLikeUUID = id.length > 30 && id.includes('-');
    
    if (looksLikeUUID) {
      queryCondition = { id: id };
    } else {
      // If it's a short number, search by receiptNumber
      // Database field is 'receipt_number', mapped to 'receiptNumber' in Sequelize model
      queryCondition = { receiptNumber: id };
    }
    
    const order = await Sale.findOne({
      where: queryCondition,
      include: [
        { model: Customer, as: 'customer' },
        { model: User, as: 'createdBy', attributes: ['id', 'fullName', 'email'] },
        { 
          model: SaleItem, 
          as: 'items',
          include: [{ model: Product }],
        },
      ],
    });
    
    if (!order) {
      // If searching by numeric ID failed via receiptNumber, try fallback to numeric->UUID conversion
      // This handles cases where old numeric IDs might be mapped differently or if the user passed a numeric ID that ISN'T a receipt number
      if (!id.includes('-')) {
         try {
           const { findUuidByNumericId } = require('../utils/idConverter');
           console.log(`Order not found by receiptNumber: ${id}, attempting fallback UUID conversion`);
           const uuid = await findUuidByNumericId(id, Sale);
           
           if (uuid) {
             const fallbackOrder = await Sale.findOne({
               where: { id: uuid },
               include: [
                 { model: Customer, as: 'customer' },
                 { model: User, as: 'createdBy', attributes: ['id', 'fullName', 'email'] },
                 { 
                   model: SaleItem, 
                   as: 'items',
                   include: [{ model: Product }],
                 },
               ],
             });
             
             if (fallbackOrder) {
               const orderJson = fallbackOrder.toJSON ? fallbackOrder.toJSON() : fallbackOrder;
               if (orderJson && orderJson.transactionImage) {
                 const img = String(orderJson.transactionImage);
                 orderJson.transactionImageUrl = img.startsWith('/uploads/') ? img : img.startsWith('uploads/') ? '/' + img : `/uploads/${img}`;
               }
               return res.status(200).json({ success: true, data: orderJson });
             }
           }
         } catch (e) {
           console.warn('Fallback UUID conversion failed:', e);
         }
      }

      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }
    
    // Build transactionImageUrl if image exists
    const orderJson = order.toJSON ? order.toJSON() : order;
    if (orderJson && orderJson.transactionImage) {
      const img = String(orderJson.transactionImage);
      orderJson.transactionImageUrl = img.startsWith('/uploads/')
        ? img
        : img.startsWith('uploads/')
        ? '/' + img
        : `/uploads/${img}`;
    }

    return res.status(200).json({
      success: true,
      data: orderJson,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update order status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.updateOrderStatus = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Validate status
    const validStatuses = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid status value',
      });
    }
    
    // Find the order
    const order = await Sale.findByPk(id, { transaction });
    
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }
    
    // Update the status
    order.status = status;
    await order.save({ transaction });
    
    // Create notification for status update
    // Convert UUID to numeric ID for relatedId
    const orderIdNumeric = uuidToNumericId(order.id);
    
    // Create notification for the customer
    if (order.userId) {
      await notificationController.createSystemNotification({
        userId: order.userId,
        type: 'order_status',
        title: 'Order Status Update',
        message: `Order #${order.id} status updated to ${status}`,
        relatedId: orderIdNumeric, // Use numeric ID derived from UUID
        relatedType: 'order'
      }, transaction);
    }
    
    // Create notification for all admins (omitting userId)
    await notificationController.createSystemNotification({
      type: 'order_status_admin',
      title: 'Order Status Updated',
      message: `Order #${order.id} status updated to ${status}`,
      relatedId: orderIdNumeric, // Use numeric ID derived from UUID
      relatedType: 'order'
    }, transaction);
    
    await transaction.commit();
    
    return res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: order,
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
}

/**
 * Accept online order and create/link customer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.acceptOnlineOrder = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { customerName, customerPhone, customerEmail, customerData } = req.body;
    
    // Extract customer data from either direct fields or customerData object
    const finalCustomerName = customerName || customerData?.customerName;
    const finalCustomerPhone = customerPhone || customerData?.customerPhone;
    const finalCustomerEmail = customerEmail || customerData?.customerEmail;
    
    // Find the order
    const order = await Sale.findByPk(id, { transaction });
    
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'الطلب غير موجود',
      });
    }
    
    // Find or create customer based on phone number
    let customer;
    if (customerPhone) {
      const [foundCustomer, created] = await Customer.findOrCreate({
        where: { 
          [Op.or]: [
            { phone: customerPhone },
            { email: customerEmail && customerEmail.trim() !== '' ? customerEmail : null }
          ]
        },
        defaults: {
          name: customerName || 'عميل جديد',
          phone: customerPhone,
          email: customerEmail || null,
        },
        transaction
      });
      
      customer = foundCustomer;
      
      console.log(`العميل ${created ? 'تم إنشاؤه' : 'موجود مسبقاً'} بالمعرف: ${customer.id}`);
    } else {
      // If no phone provided, try to find by email
      if (customerEmail && customerEmail.trim() !== '') {
        const [foundCustomer, created] = await Customer.findOrCreate({
          where: { email: customerEmail },
          defaults: {
            name: customerName || 'عميل جديد',
            email: customerEmail,
          },
          transaction
        });
        
        customer = foundCustomer;
        console.log(`العميل ${created ? 'تم إنشاؤه' : 'موجود مسبقاً'} بالمعرف: ${customer.id}`);
      } else {
        // If no phone or email, create a walk-in customer
        customer = await Customer.create({
          name: customerName || 'عميل زائر',
          transaction
        });
        
        console.log(`تم إنشاء عميل زائر بالمعرف: ${customer.id}`);
      }
    }
    
    // Update the order with customer ID and change status to accepted
    order.customerId = customer.id;
    order.status = 'accepted';
    order.customerName = finalCustomerName;
    order.customerPhone = finalCustomerPhone;
    order.customerEmail = finalCustomerEmail;
    await order.save({ transaction });
    
    // Create notification for status update
    const orderIdNumeric = uuidToNumericId(order.id);
    
    // Create notification for the customer
    if (order.userId) {
      await notificationController.createSystemNotification({
        userId: order.userId,
        type: 'order_status',
        title: 'تحديث حالة الطلب',
        message: `تم قبول الطلب #${orderIdNumeric}`,
        relatedId: orderIdNumeric,
        relatedType: 'order'
      }, transaction);
    }
    
    // Create notification for all admins
    await notificationController.createSystemNotification({
      type: 'order_status_admin',
      title: 'تم قبول طلب',
      message: `تم قبول الطلب #${orderIdNumeric} وربطه بالعميل ${customer.name}`,
      relatedId: orderIdNumeric,
      relatedType: 'order'
    }, transaction);
    
    await transaction.commit();
    
    return res.status(200).json({
      success: true,
      message: 'تم قبول الطلب وربطه بالعميل بنجاح',
      data: {
        order,
        customer
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("خطأ في قبول الطلب:", error);
    next(error);
  }
};

/**
 * Create a new order with transaction image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.createOrderWithImage = async (req, res, next) => {
  const t = await sequelize.transaction();
  
  try {
    // Extract orderData if it comes as a string (JSON) or is already an object
    let orderData = {};
    let cartItems = [];
    
    // First, try to parse 'orderData' field if it exists
    if (req.body.orderData) {
      try {
        orderData = typeof req.body.orderData === 'string' 
          ? JSON.parse(req.body.orderData) 
          : req.body.orderData;
        
        // If orderData has items or cartItems, use them
        if (orderData.items || orderData.cartItems) {
          cartItems = orderData.items || orderData.cartItems;
        }
      } catch (e) {
        console.warn('Failed to parse orderData:', e.message);
      }
    }
    
    // Fallback: Check for flat fields in req.body (for multipart/form-data without JSON wrapper)
    if (!orderData) orderData = {};
    if (!orderData.customerData) {
      orderData.customerData = {
        name: req.body.customerName || req.body['customerData[name]'],
        phone: req.body.customerPhone || req.body['customerData[phone]'],
        email: req.body.customerEmail || req.body['customerData[email]'],
        address: req.body.deliveryAddress || req.body.address || req.body['customerData[address]'],
        paymentMethod: req.body.paymentMethod || req.body['customerData[paymentMethod]'],
        mobilePaymentProvider: req.body.mobilePaymentProvider || req.body['customerData[mobilePaymentProvider]']
      };
    }

    // Merge missing flat fields if needed
    const cData = orderData.customerData;
    if (!cData.name && req.body.customerName) cData.name = req.body.customerName;
    if (!cData.phone && req.body.customerPhone) cData.phone = req.body.customerPhone;
    if (!cData.paymentMethod && req.body.paymentMethod) cData.paymentMethod = req.body.paymentMethod;

    // Normalize items from flat fields if empty
    if ((!cartItems || cartItems.length === 0) && req.body.items) {
      try {
        cartItems = typeof req.body.items === 'string' 
          ? JSON.parse(req.body.items) 
          : req.body.items;
      } catch (e) {
        console.warn('Failed to parse items field:', e.message);
      }
    }
    
    // Extract totals from flat fields if missing in orderData
    const total = req.body.total || orderData.total;
    const tax = req.body.tax || orderData.tax;
    const subtotal = req.body.subtotal || orderData.subtotal;
    const deliveryFee = req.body.deliveryFee || orderData.deliveryFee;

    const { customerData } = orderData;
    
    // Final check for required fields
    if (!customerData || (!customerData.phone && !req.body.customerPhone)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'بيانات العميل أو رقم الهاتف مفقودة' });
    }

    // Explicitly ignore any client-provided ID
    if (customerData.id) {
      try {
        console.warn('Ignoring client-supplied customerData.id:', customerData.id);
      } catch (_) {}
      delete customerData.id;
    }

    // Also guard against nested id in orderData
    if (orderData.customerId) {
      try {
        console.warn('Ignoring client-supplied orderData.customerId:', orderData.customerId);
      } catch (_) {}
      delete orderData.customerId;
    }

    // Find or create customer within the same transaction using phone only
    const [customer] = await Customer.findOrCreate({
      where: { phone: String(customerData.phone || '').trim() },
      defaults: {
        name: (customerData.name || 'عميل جديد').trim(),
        email: (customerData.email || '').trim() || null,
        address: customerData.address || null,
      },
      transaction: t,
    });

    // Double-check the resolved customer actually exists in DB before referencing
    const verifiedCustomer = await Customer.findByPk(customer.id, { transaction: t, paranoid: false });
    if (!verifiedCustomer) {
      // As a fallback, create a fresh customer row and use its ID
      const fallbackCustomer = await Customer.create({
        name: (customerData.name || 'عميل جديد').trim(),
        phone: String(customerData.phone || '').trim(),
        email: (customerData.email || '').trim() || null,
        address: customerData.address || null,
      }, { transaction: t });
      console.warn('Customer verification failed; created fallback customer:', fallbackCustomer.id);
      customer.id = fallbackCustomer.id;
    }

    // Normalize items
    let items = Array.isArray(cartItems) ? cartItems : (Array.isArray(orderData.items) ? orderData.items : []);
    if (!items || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'يجب أن يحتوي الطلب على عنصر واحد على الأقل' });
    }

    // Map payment method values
    let paymentMethod = orderData.paymentMethod || customerData.paymentMethod || 'cash';
    const pmRaw = String(paymentMethod || '').trim();
    if (pmRaw === 'cashOnDelivery' || pmRaw === 'cash') paymentMethod = 'cash';
    else if (pmRaw === 'mobileMoney' || pmRaw === 'mobile_payment') paymentMethod = 'mobile_payment';
    else if (pmRaw === 'online') paymentMethod = 'online';
    else paymentMethod = 'cash';

    // Handle transaction image (supports express-fileupload and multer)
    let transactionImagePath = null;
    if (req.files && req.files.transactionImage) {
      const f = req.files.transactionImage;
      const fileExt = path.extname(f.name);
      const fileName = `transaction_${uuidv4()}${fileExt}`;
      const uploadPath = path.join(uploadDir, fileName);
      await f.mv(uploadPath);
      transactionImagePath = fileName;
    } else if (req.file) {
      try {
        const fileExt = path.extname(req.file.originalname || '');
        const fileName = `transaction_${uuidv4()}${fileExt}`;
        const destPath = path.join(uploadDir, fileName);
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.copyFileSync(req.file.path, destPath);
        } else if (req.file.buffer) {
          fs.writeFileSync(destPath, req.file.buffer);
        }
        transactionImagePath = fileName;
      } catch (multerErr) {
        console.error('Error processing multer file:', multerErr);
      }
    } else {
      const providedImage = (orderData && (orderData.transaction_image || orderData.transactionImage)) || null;
      if (providedImage && typeof providedImage === 'string') {
        transactionImagePath = path.basename(providedImage);
      }
    }

    // Require receipt image only for mobile payments
    if (paymentMethod === 'mobile_payment' && !transactionImagePath) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'صورة إيصال الدفع مطلوبة لطرق الدفع عبر الهاتف المحمول' });
    }

    // Totals and amounts
    const subtotalNum = items.reduce((sum, it) => sum + ((parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice ?? it.price) || 0)), 0);
    const taxAmountNum = Number.isFinite(parseFloat(orderData.tax)) ? parseFloat(orderData.tax) : 0;
    const discountAmountNum = Number.isFinite(parseFloat(orderData.discount)) ? parseFloat(orderData.discount) : 0;
    const totalAmountNum = Number.isFinite(parseFloat(total)) ? parseFloat(total) : (subtotalNum + taxAmountNum - discountAmountNum);

    const deliveryAddress = orderData.deliveryAddress || customerData.address || '';
    const customerName = customerData.name || '';
    const customerPhone = customerData.phone || '';
    const customerEmail = customerData.email || '';
    const paymentStatus = orderData.paymentStatus || 'pending';
    const notes = orderData.notes || '';

    // Log to confirm safe customer ID used
    try {
      console.log('Creating Sale with safe customer ID:', { customerId: customer.id, phone: customerPhone });
    } catch (_) {}

    const sale = await Sale.create({
      customerId: customer.id,
      userId: req.user?.id || null,
      subtotal: subtotalNum,
      taxAmount: taxAmountNum,
      discountAmount: discountAmountNum,
      totalAmount: totalAmountNum,
      paymentMethod,
      paymentStatus,
      status: 'pending',
      notes,
      transactionImage: transactionImagePath,
      deliveryAddress,
      customerName,
      customerPhone,
      customerEmail,
      source: 'online'
    }, { transaction: t });

    const saleItems = items.map(item => {
      // Ensure quantity is at least 1
      let quantity = parseFloat(item.quantity);
      if (isNaN(quantity) || quantity < 1) quantity = 1;
      
      const unitPrice = parseFloat(item.unitPrice ?? item.price) || 0;
      const discount = parseFloat(item.discount) || 0;
      const subtotal = quantity * unitPrice;
      
      // Ensure productId is valid
      const productId = parseInt(item.productId || item.id || item.product_id);
      if (!productId) {
        throw new Error(`Product ID missing or invalid for item: ${item.name || 'unknown'}`);
      }

      return {
        saleId: sale.id,
        productId: productId,
        quantity,
        unitPrice,
        discount,
        subtotal,
        totalPrice: parseFloat(item.totalPrice) || (subtotal - discount),
        notes: item.notes || '',
      };
    });

    await SaleItem.bulkCreate(saleItems, { transaction: t });

    const saleIdNumeric = uuidToNumericId(sale.id);
    await notificationController.createSystemNotification({
      type: 'new_order',
      title: 'New Online Order',
      message: `New online order #${sale.id} received`,
      relatedId: saleIdNumeric,
      relatedType: 'order', // Fixed: Changed from 'sale' to 'order' to match notification type logic
    }, t);

    await t.commit();
    return res.status(201).json({ success: true, data: { id: sale.id, orderNumber: sale.id, status: 'pending', message: 'تم إنشاء الطلب بنجاح' } });
  } catch (error) {
    await t.rollback();
    console.error('Error in createOrderWithImage:', error);
    
    // Extract validation errors if available
    let errorMessage = error.message;
    if (error.errors && Array.isArray(error.errors)) {
      errorMessage = error.errors.map(e => `${e.path}: ${e.message}`).join(', ');
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'حدث خطأ في الخادم أثناء إنشاء الطلب', 
      error: errorMessage 
    });
  }
};