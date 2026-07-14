const mongoose = require('mongoose');
const User = require('../models/User');
const Procedure = require('../models/Procedure');
const Employee = require('../models/Employee');
const Client = require('../models/Client');
const Sale = require('../models/Sale');

const DEMO_PROCEDURES = [
  { name: 'Botox', description: 'Aplicação de toxina botulínica', value: 800 },
  { name: 'Preenchimento labial', description: 'Preenchimento com ácido hialurônico', value: 1200 },
  { name: 'Limpeza de pele', description: 'Limpeza profunda facial', value: 250 },
];

async function getOnboardingStatus(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('onboardingCompleted').lean();
    const userObjectId = new mongoose.Types.ObjectId(req.userId);

    const [procedureCount, saleCount] = await Promise.all([
      Procedure.countDocuments({ userId: userObjectId }),
      Sale.countDocuments({ userId: userObjectId }),
    ]);

    const hasRealData = procedureCount > 0 || saleCount > 0;
    const completed = Boolean(user?.onboardingCompleted) || hasRealData;

    res.json({
      success: true,
      data: {
        completed,
        hasRealData,
        procedureCount,
        saleCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function bootstrapOnboarding(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    if (user.onboardingCompleted) {
      return res.json({
        success: true,
        data: { skipped: true, message: 'Onboarding já concluído' },
      });
    }

    const existingProcedures = await Procedure.countDocuments({ userId: userObjectId });
    const existingSales = await Sale.countDocuments({ userId: userObjectId });

    if (existingProcedures > 0 || existingSales > 0) {
      user.onboardingCompleted = true;
      await user.save();
      return res.json({
        success: true,
        data: { skipped: true, message: 'Já existem dados reais; onboarding marcado como concluído' },
      });
    }

    const procedures = await Procedure.insertMany(
      DEMO_PROCEDURES.map((p) => ({ ...p, userId: userObjectId }))
    );

    const employee = await Employee.create({
      userId: userObjectId,
      name: 'Colaborador Demo',
      generalCommission: 10,
      procedureCommissions: [],
    });

    const client = await Client.create({
      userId: userObjectId,
      name: 'Cliente Demo',
      phone: '11999990000',
      category: 'cliente',
      isNewClient: false,
      clientGroup: 'grupo_a',
      leadSource: 'outros',
      leadSourceOther: 'onboarding',
    });

    const demoSales = [];
    for (let i = 0; i < 2; i++) {
      const procedure = procedures[i % procedures.length];
      const totalValue = procedure.value;
      const commissionValue = totalValue * 0.1;
      const paymentFeeValue = 0;
      const netValue = totalValue - commissionValue - paymentFeeValue;

      demoSales.push({
        userId: userObjectId,
        items: [{
          procedureId: procedure._id,
          procedureName: procedure.name,
          quantity: 1,
          unitValue: procedure.value,
          totalValue: procedure.value,
        }],
        totalValue,
        commissionValue,
        netValue,
        paymentMethod: 'pix',
        paymentFeePercentage: 0,
        paymentFeeValue: 0,
        discount: 0,
        employeeId: employee._id,
        employeeName: employee.name,
        clientId: client._id,
        clientName: client.name,
        clientPhone: client.phone,
        isDemo: true,
      });
    }

    await Sale.insertMany(demoSales);

    user.onboardingCompleted = true;
    await user.save();

    res.json({
      success: true,
      data: {
        procedures: procedures.map((p) => ({ id: p._id.toString(), name: p.name, value: p.value })),
        employee: { id: employee._id.toString(), name: employee.name },
        client: { id: client._id.toString(), name: client.name },
        salesCreated: demoSales.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getOnboardingStatus, bootstrapOnboarding };
